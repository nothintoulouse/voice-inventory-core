# voice-inventory-core

## Status

This is a frozen showcase, not a maintained library.

- **Snapshot, not a live sync.** Extracted and sanitized from a private production codebase on 2026-07-21 (see [docs/sanitization.md](docs/sanitization.md)) and never touched since. It reflects that codebase as it existed on that date only.
- **Not the canonical source.** The private product this was extracted from is the actively developed, canonical codebase. This public repo is a one-time, one-directional demonstration snapshot — nothing here flows back into it, and it is not kept in sync going forward.
- **Not maintained as a library.** No ongoing releases, no issue triage, no compatibility guarantees across commits. Treat anything here as a point-in-time reference, not a dependency to build on.
- **Licensing.** PolyForm Noncommercial 1.0.0 — see [License](#license) below for the full terms.

---

**Speech is probabilistic. Inventory counts are not.** This is the part of a
voice-driven inventory system that sits on the deterministic side of that line:
a spoken count grammar, provider-neutral transcription interfaces, fuzzy item
matching, confidence scoring, human-review decision logic, and patch-in-place
`.xlsx` export — all of it pure, testable, and reproducible with no API key and
no network.

Extracted and sanitized from a private working project. See
[docs/sanitization.md](docs/sanitization.md).

---

## Run it

```bash
npm install && npm run demo
```

No API key. No network call. No database. No real inventory data. The synthetic
workbook is generated in memory on every run; the ASR response is a fixture.

<details open>
<summary>What you get</summary>

```
1. Synthetic workbook (generated in memory, invented product names)
────────────────────────────────────────────────────────────────────────
sheets: Liquor, Wine
proposed mapping for "Liquor": header row 3, name=A size=B category=C count=D, rows 4–16
imported 9 item rows (section headers dropped)

3. PROBABILISTIC boundary: ASR (mocked provider response, no network)
────────────────────────────────────────────────────────────────────────
provider: deepgram  seed terms sent: 21
words: 49

  "Marlo's seven fifty point six. Nordvale Reserve one leader full. Thornbury
   Dry point three. Wenlock's half. Fowler's Mark one full and point four.
   Harbor one oh seven point four. Solara not here. Verano Amaro half, flag
   this. Plus point two Fowler's. Bison Creek case plus three. Wenlock's
   point two."

  ↑ everything above this line is a guess made by an acoustic model.
    everything below this line is deterministic and unit-tested.

4. DETERMINISTIC boundary: grammar → matching → confidence
────────────────────────────────────────────────────────────────────────
spoken                            item                  count   conf  status
────────────────────────────────────────────────────────────────────────
marlo's seven fifty point six     Marlo's 750ml         0.6     0.87  auto-fill
nordvale reserve one leader full  Nordvale Reserve      1       0.90  auto-fill
thornbury dry point three         Thornbury Dry         0.3     0.91  auto-fill
wenlock's half                    Wenlock's             0.5     0.91  auto-fill
fowler's mark one full and point …Fowler's Mark 1.75L   1.4     0.88  auto-fill
harbor one oh seven point four    Harbor 107            0.4     0.86  auto-fill
solara not here                   Solara                —       0.91  auto-fill
verano amaro half flag this       Verano Amaro          0.5     0.59  REVIEW (user_flag)
plus point two fowler's           Fowler's Mark 1.75L   0.2     0.88  auto-fill
bison creek case plus three       Bison Creek           1cs+3   0.91  auto-fill (case_pack_needed)
wenlock's point two               Wenlock's             0.2     0.91  REVIEW (duplicate_possible)

9/11 auto-filled, 2 sent to human review

5. Determinism check
────────────────────────────────────────────────────────────────────────
re-running the deterministic half on the same transcript: byte-identical ✓

6. Patch-in-place export
────────────────────────────────────────────────────────────────────────
  Marlo's 750ml            D5 = 0.6 ✓
  Nordvale Reserve         D6 = 1 ✓
  Thornbury Dry            D13 = 0.3 ✓
  Wenlock's                D12 = 0.5 ✓
  Fowler's Mark 1.75L      D8 = 1.6 ✓
  Harbor 107               D10 = 0.4 ✓

  formula F2 intact: ✓   title intact: ✓   bold header intact: ✓
  uncounted row untouched: ✓   section row intact: ✓
```

</details>

```bash
npm test        # 152 tests
npm run build   # tsc --noEmit
```

---

## The engineering argument

A person walks the bar and narrates: *"Marlo's seven fifty, point six.
Nordvale Reserve, one liter, full. Harbor one oh seven, point four."* An
acoustic model turns that into text, and it is **wrong some of the time** — it
hears "leader" for "liter", it renders "seven fifty" as `7 50`, it merges a SKU
name into its count.

The numbers it produces end up in a spreadsheet that someone reconciles against
money. "Probably 1.4" is not an answer.

So the system draws a hard boundary:

```
┌────────────────── PROBABILISTIC ──────────────────┐
│ acoustic model, biased toward this property's     │
│ vocabulary via per-request seed terms             │
└───────────────────────┬───────────────────────────┘
                        │  NormalizedTranscript
                        │  ← the only thing that crosses
┌───────────────────────┴───────────────────────────┐
│ DETERMINISTIC — no model, no I/O, no clock        │
│  segment → parse → match → score → decide → patch │
└───────────────────────────────────────────────────┘
```

Everything below the boundary is a pure function of its input. That is why the
demo prints the same numbers on your machine as on mine, and why 152 tests can
actually pin the behaviour down.

The transcript is treated as an untrusted input. The grammar does not try to
believe it — it extracts structure where structure exists, **quantifies its own
uncertainty**, and hands the rest to a person. Three of the eleven lines in the
demo carry a review reason; two of them stop.

### Three problems worth looking at

**Numeric SKU names.** `harbor one oh seven point four` can parse as item
`harbor` + count `107.4`, or item `harbor one oh seven` + count `0.4`. The
parser enumerates every valid count suffix, discards implausible counts, then
ranks survivors by how much the leftover prefix *looks like an item name* — and
docks its own confidence when it had to make that choice.
→ [docs/count-grammar.md](docs/count-grammar.md)

**Refusing to guess.** `bison creek case plus three` cannot become a number:
pack size is a property of the SKU, not the utterance. The parser emits
`{ type: 'case', cases: 1, extraEach: 3 }` and a `case_pack_needed` flag rather
than inventing a multiplier. `one full and one point four` is genuinely
ambiguous English; the default house rule flags it instead of picking.

**Legible uncertainty.** Confidence is six weighted components, not one number,
so a reviewer is told *"the count is fine, the product is ambiguous"* rather
than *"the model wasn't sure"*.
→ [docs/architecture.md](docs/architecture.md)

### And one product decision that drove the design

The count sheet belongs to someone else. It has their formulas, their
formatting, their layout. So counts are written into a copy of the **original
uploaded bytes** — only the addressed cells change, everything else rides
through untouched. A tool that hands back a clean export instead of their sheet
with numbers in it has not done the job.

---

## What's here

```
src/
  asr/          provider-neutral interfaces, seed-term caps,
                Deepgram + AssemblyAI adapters, mock provider
  count-grammar/ tokenizer, count expressions, segmenter, line parser
  matcher/      pg_trgm-compatible trigram similarity, candidate
                generation, weighted ranking
  aliases/      deterministic alias generation, LLM-enrichment interface
  pipeline/     composite confidence, review decisions, reconciliation
  workbook/     column-mapping detection, import, patch-in-place export
  fixtures/     synthetic workbook, transcript, provider responses
  demo/         the one-command demonstration
```

The provider adapters split into a pure `buildRequest` and a pure `normalize`
with the HTTP call injected — which is exactly why they can be tested without
credentials. Credentials come from `DEEPGRAM_API_KEY` / `ASSEMBLYAI_API_KEY`;
nothing in this repository ever supplies one.

---

## Honest scope

**Tested here** (152 tests, all passing): spoken number parsing, the full count
grammar, segmentation of run-on speech, provider request construction and
response normalization including AssemblyAI's millisecond timings, seed-term
caps for both providers, trigram similarity, candidate generation and ranking,
confidence weights and review thresholds, end-to-end reconciliation and its
determinism, alias generation and enrichment failure containment, workbook
column detection and patch-in-place fidelity.

**Not tested here, and not claimed:**

- **Speech-recognition accuracy.** No test makes a network call. The adapters
  are verified against recorded-*shape* fixtures — that proves the wiring, not
  the model.
- The `pg_trgm` port against a live Postgres (implemented and tested against
  the documented algorithm; not differential-tested).
- LLM alias-enrichment quality — only batching and failure containment are
  tested, against a deterministic stub.
- Persistence, auth, upload, review UI, browser audio capture, deployment.
  None of it is in this repository.
- Scale, performance, workbook variety beyond the single synthetic fixture.

**The one accuracy number that exists** — 8/8 lines itemized, 7/8 auto-filled
and all correct — was measured in the private application on **synthetic
text-to-speech audio against a 9-item sheet**, n = 1 recording, with the grammar
partly tuned against that same recording. It is an existence proof, not a rate,
and it is **not reproducible from this repository**. Full caveats, plus six
known gaps, in [docs/evaluation.md](docs/evaluation.md).

---

## AI assistance and ownership

Brayden Toulouse defined the problem, the constraints, and the acceptance
criteria; identified the real-audio failures that became the grammar's hardest
rules; and reviewed, tested, and verified the results. AI coding agents wrote
most of the implementation and tests under that direction.

No machine-learning research is claimed — no model was trained or fine-tuned;
the ASR providers are consumed as services. Nothing here is claimed as
production-hardened. Full statement: [docs/ai-assistance.md](docs/ai-assistance.md).

---

## Docs

- [Architecture](docs/architecture.md) — stages, weights, thresholds, and the production SQL for reference
- [Count grammar](docs/count-grammar.md) — the full spoken grammar and its edge cases
- [Evaluation](docs/evaluation.md) — what is measured, what is not, known gaps
- [Sanitization](docs/sanitization.md) — what was extracted and what was deliberately left out
- [AI assistance](docs/ai-assistance.md) — ownership statement

## License

**[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)** — source-available, not open source.

Read it, run it, fork it, learn from it, and use it for research, study, teaching, or any other noncommercial purpose. **Commercial use is not granted.** This is a working extraction of a system I may commercialize, so those rights are reserved; if you want a commercial license, ask me.

All source here is original to this project. Runtime and development dependencies are MIT / Apache-2.0 / ISC / BSD / MPL-2.0 and impose no conflicting obligations.
