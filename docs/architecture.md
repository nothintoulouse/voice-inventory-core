# Architecture

## The one design decision that matters

Speech recognition is probabilistic. Inventory counts are not — a bottle count
that is "probably 1.4" is worthless, because the number lands in a spreadsheet
that someone reconciles against money.

So the system draws a hard line:

```
        ┌──────────────────────── PROBABILISTIC ─────────────────────────┐
audio → │  acoustic model (Deepgram / AssemblyAI / on-device)            │
        │  vocabulary seeding biases it toward the property's SKUs       │
        └────────────────────────────────────────────────────────────────┘
                                    │
                    NormalizedTranscript  ← the only thing that crosses
                                    │
        ┌───────────────────────── DETERMINISTIC ────────────────────────┐
        │  segment      transcript → count utterances                    │
        │  parse        utterance  → { item, size hint, count, flags }   │
        │  match        item phrase → ranked catalogue candidates        │
        │  score        components  → composite confidence               │
        │  decide       confidence + flags → auto-fill or human review   │
        │  patch        approved counts → cells in the original workbook │
        └────────────────────────────────────────────────────────────────┘
```

Nothing below the line calls a model, an API, a database, or a clock. Every
stage is a pure function of its input, which is why the whole back half can be
unit-tested and why `npm run demo` reproduces the same numbers on any machine.

The transcript is treated as an *untrusted input*. The grammar's job is not to
believe it; it is to extract structure where structure exists, quantify its own
uncertainty, and hand everything else to a person.

## Stages

### 1. Vocabulary seeding (`src/asr/seed-terms.ts`)

Bar inventory is a worst case for general ASR: hundreds of proper nouns, many
of them foreign, several near-homophones on the same shelf. Both providers
accept a per-request vocabulary bias, with different limits and different
failure modes:

| Provider | Mechanism | Limit | Behaviour on overflow |
|---|---|---|---|
| AssemblyAI | `keyterms_prompt` (JSON body) | ≤1,000 terms, ≤6 words each | terms silently dropped |
| Deepgram | repeated `keyterm` query params | ≤500 tokens per request | request rejected |

`prepareSeedTerms` normalizes, de-duplicates case-insensitively, and applies
the provider's cap. Terms arrive pre-sorted by alias priority (zone-scoped
first), so a cap always truncates the least useful end of the list. Deepgram's
budget is spent greedily by word count: an oversized phrase is skipped, not
treated as a hard stop, so one long term cannot starve the rest.

### 2. Provider adapters (`src/asr/providers/`)

Each adapter is split into a pure `buildRequest` and a pure `normalize`, with
the HTTP call injected. That split is the reason the adapters can be tested at
all without credentials — the tests assert on the *request description* and on
recorded-shape response bodies.

Two normalization details are load-bearing and both are covered by tests:

- **AssemblyAI reports word timings in milliseconds**, Deepgram in seconds.
  A quiet unit mismatch here shows up three stages later as nonsense confidence
  attribution.
- **Deepgram's `punctuated_word`** carries the smart-formatted token; the raw
  `word` does not. Per-word confidence is only present on the Deepgram path,
  so a documented default (0.9) fills in elsewhere rather than an invented one.

`NormalizedTranscript` is the sole interface downstream. An on-device client
that submits its own transcript JSON enters the pipeline at exactly the same
point as cloud ASR — that is the device-agnostic boundary.

### 3. Segmentation (`src/count-grammar/segment.ts`)

Punctuation from smart-formatted ASR is the primary signal. Run-on speech is
the hard case: the segmenter places a cut after a *complete* count expression
only when the next token starts a new item phrase.

A bare integer never terminates a line. This single rule is what protects
numeric item names — `harbor one oh seven point four` must segment as one line
(item `harbor one oh seven`, count `0.4`), not two.

### 4. Count grammar (`src/count-grammar/`)

See [count-grammar.md](count-grammar.md) for the full grammar. It is pure
TypeScript with no I/O and no model call, and it emits both a value and a set
of flags describing what it was unsure about.

### 5. Matching (`src/matcher/`)

Candidate generation takes the spoken item phrase and, for each catalogue item,
keeps the best of:

1. exact alias hit (score 1.0),
2. trigram similarity against the best alias,
3. trigram similarity against the canonical name.

Ranking is a weighted sum over four independent signals:

```
score = 0.55 × productScore     (exact alias, else trigram similarity)
      + 0.15 × aliasTrustScore  (approved 1.0 / generated 0.6 / canonical 0.8)
      + 0.30 × zonePriorScore   (in zone & expected 1.0 / in zone 0.7 / out 0.3)
      + sizeAdj                 (size hint agrees +0.05, disagrees −0.15)
```

If the top two candidates land within 0.1 of each other the result is marked
ambiguous, which is a review reason regardless of the absolute score. Two SKUs
of the same brand in different sizes are the canonical case.

A zone with no members yet contributes a neutral 0.7 rather than penalizing
everything — zone membership grows from review approvals, so an empty zone
must not poison matching on day one.

**In production this runs inside Postgres** with `pg_trgm` and a GIN index.
This repository ships a faithful, dependency-free port of `pg_trgm`'s
similarity (`src/matcher/trigram.ts`) plus an in-memory candidate generator, so
the matcher is demonstrable and testable without a database. The production
query is reproduced below for reference; it is not executed anywhere here.

<details>
<summary>Production candidate-generation SQL (reference only)</summary>

```sql
WITH alias_hits AS (
  SELECT i.id AS item_id, a.alias_text, a.trust_level AS alias_trust,
         similarity(a.alias_text, $itemText) AS trgm_score,
         lower(a.alias_text) = lower($itemText) AS exact_alias,
         ROW_NUMBER() OVER (
           PARTITION BY i.id
           ORDER BY (lower(a.alias_text) = lower($itemText)) DESC,
                    similarity(a.alias_text, $itemText) DESC
         ) AS rn
  FROM inventory_item i
  JOIN item_alias a ON a.item_id = i.id
  WHERE i.property_id = $propertyId AND i.active
    AND (lower(a.alias_text) = lower($itemText)
         OR similarity(a.alias_text, $itemText) > 0.25)
),
name_hits AS (
  SELECT i.id AS item_id, NULL::text, NULL::text,
         similarity(i.canonical_name, $itemText), false
  FROM inventory_item i
  WHERE i.property_id = $propertyId AND i.active
    AND similarity(i.canonical_name, $itemText) > 0.25
)
SELECT ... FROM alias_hits WHERE rn = 1
UNION ALL SELECT ... FROM name_hits WHERE item_id NOT IN (...)
LEFT JOIN zone_item_membership ...
ORDER BY exact_alias DESC, trgm_score DESC
LIMIT 25;
```

</details>

### 6. Aliases (`src/aliases/`)

`generateAliases` is deterministic: strip sizes, drop noise words, keep the
leading word and leading pair, add apostrophe-free variants, and expand numeric
name parts into spoken digits (`Harbor 107` → `harbor one oh seven`). These
rules alone make exact matching work for most of a catalogue.

LLM enrichment (spoken nicknames, plausible mishearings) layers on top, under
two hard constraints:

1. it runs **once per catalogue import**, never in the per-count path — a count
   session must not depend on a model being available, fast, or funded;
2. it **degrades silently** — every failure returns fewer aliases, never an
   error, and matching still works.

This repository ships the interface, the batching, the failure containment, and
a deterministic stub enricher. It makes no model calls.

### 7. Confidence (`src/pipeline/confidence.ts`)

```
overall = 0.20 × asr           (mean per-word ASR confidence for the line)
        + 0.25 × productMatch  (top candidate's product score)
        + 0.15 × aliasTrust    (how much the matched alias is trusted)
        + 0.15 × zonePrior     (does this item belong on this shelf)
        + 0.15 × countParse    (grammar's certainty about the number)
        + 0.10 × sanity        (prior-count plausibility; neutral 0.5 today)
        − 0.15 if ambiguous
        − 0.30 if the speaker flagged the line out loud
```

Threshold: **below 0.75 the line requires human review.** `no_match` and
`user_flag` force review regardless of score.

Six components rather than one number is a deliberate choice: when a line goes
to review, the reason is legible ("the count is fine, the product is
ambiguous") instead of "the model wasn't sure".

### 8. Patch-in-place export (`src/workbook/export.ts`)

Counts are written into a copy of the **original uploaded workbook bytes**.
Only the addressed count cells are touched; formulas, styles, merged cells,
section rows, and every other value ride through untouched.

This is a product requirement disguised as a technical one. The count sheet
usually belongs to someone else — it has their formulas, their conditional
formatting, their layout — and a tool that returns a "clean export" instead of
their sheet with numbers in it has not actually done the job.

## What is *not* in this repository

The private product also contains a Next.js application, Postgres persistence,
blob storage, a recording UI with wake-lock/chunking survival logic, a review
queue UI, auth, and deployment configuration. None of that is needed to
understand or evaluate the engineering above, so none of it was extracted. See
[sanitization.md](sanitization.md).
