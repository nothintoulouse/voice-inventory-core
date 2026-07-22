# Evaluation

## What this repository proves, and what it does not

This repository can demonstrate, on your machine, right now, with no network:

- that the deterministic half of the pipeline is deterministic;
- that it extracts the right structure from a realistic count narration;
- that it refuses to auto-fill lines it cannot justify;
- that it patches a real `.xlsx` without disturbing anything else in it.

It **cannot** demonstrate speech-recognition accuracy, because the tests
deliberately never call a speech API. Any accuracy claim about the
probabilistic half has to come from measurements taken elsewhere, clearly
labelled as such. The one such measurement is below.

## Reproducible here: the synthetic pipeline run

`npm run demo` transcribes a fixture response through the real Deepgram
adapter, then runs the deterministic stages end to end. Observed output:

| | |
|---|---|
| workbook rows imported | 9 (section-header rows dropped) |
| utterances segmented | 11 |
| auto-filled | 9 |
| sent to human review | 2 (`user_flag`, `duplicate_possible`) |
| re-run on identical input | byte-identical |
| workbook round trip | formula, title, bold styling, uncounted rows all intact |

Those numbers are a property of the fixture, not a benchmark. They exist to
show the *shape* of the decision — including the two lines the system correctly
declines to answer.

## Measured elsewhere: first end-to-end run (2026-07-02)

Recorded in the private application, on **synthetic audio** (macOS
text-to-speech narration of a 9-item sheet), through both cloud providers.
Reported here for honesty about where the project actually stands; **it is not
reproducible from this repository.**

- Deepgram, after grammar tuning: **8/8 lines correctly itemized; 7/8
  auto-filled, all 7 correct (87.5% auto-fill rate)**. The eighth was sent to
  review — `numerals` merged a numeric SKU name with its count
  (`one oh seven point eight` → `107.8`), the implausible-count guard fired,
  and a human got the line. Wrong answer avoided; automation missed.
- ASR latency on ~22 s of audio: Deepgram ≈0.7–2.0 s, AssemblyAI ≈7.5 s.
- AssemblyAI duplicated content mid-transcript on TTS audio. TTS is adversarial
  in ways human speech is not; whether this happens with a real voice is
  **unverified**.

### What that number is worth

Not much yet, and it should not be quoted without these caveats:

- **n = 1 recording, 8 lines.** It is an existence proof, not a rate.
- **Synthetic voice, no room noise, no accent, one speaker.** Real bar audio is
  the actual test and has not been run.
- **A 9-item catalogue.** Matching difficulty grows with catalogue size and
  with near-duplicate SKUs; nothing here says how it degrades at 200 items.
- **The grammar was tuned against this recording.** Four of the fixes it
  produced (the `leader` mishearing, the `7 50` digit pair, directive anchoring,
  backward-attaching user flags) became regression tests, which means the
  87.5% is partly in-sample.

The honest summary: the deterministic half behaves as designed and is well
covered by tests; the end-to-end accuracy claim rests on a single synthetic run
and needs real-voice, real-catalogue validation before it means anything.

## Test coverage

152 tests, all passing (`npm test`). What they cover:

| Area | Covered |
|---|---|
| Spoken number parsing | integers, hundreds shorthand, digit readouts, decimals, tenths |
| Count expressions | all keyword/fraction/decimal forms, compounds under all three house rules, case counts, rejections |
| Segmentation | punctuated and run-on transcripts, numeric-name protection, directive anchoring, additive separation |
| Line parsing | item/size/count separation, directives, `new item`, additive forms, degenerate input |
| Seed terms | cleaning, dedup, priority order, both providers' caps and overflow behaviour |
| Provider adapters | request construction, credential placement, response normalization, malformed bodies, ms→s conversion, cross-provider equivalence |
| Trigram similarity | padding, symmetry, ranking, empty input |
| Candidate generation | exact vs fuzzy, similarity floor, zone membership, ordering |
| Ranking | ambiguity window, size-hint effect, zone tie-breaking |
| Confidence | weights, thresholds, review reasons |
| Reconciliation | full transcript → scored lines, determinism, duplicate detection, `no_match` handling |
| Aliases | deterministic generation, enrichment batching and failure containment |
| Workbook | header/column detection, section-row filtering, size parsing, patch-in-place fidelity |

### Explicitly **not** covered by tests

- **Speech-recognition accuracy.** No test makes a network call. The adapters
  are tested against recorded-shape fixtures, which proves the wiring, not the
  model.
- **The `pg_trgm` port against a live Postgres.** `trigram.ts` implements the
  documented algorithm and is tested against documented behaviour; it has not
  been differential-tested against a running database.
- **LLM alias enrichment quality.** Only the batching and failure containment
  are tested; the enricher used in tests is a deterministic stub.
- **Anything in the private application**: persistence, auth, blob storage,
  upload, the review UI, deployment. None of it is in this repository.
- **Browser audio capture** — wake lock, `MediaRecorder` chunking, fragmented
  MP4 remuxing. Not extracted, not tested here.
- **Scale and performance.** No test exercises a 200+ item catalogue, long
  recordings, or concurrency.
- **Workbook variety.** One synthetic fixture. Merged cells, multiple count
  columns, `.xls`, and locked/protected sheets are untested.

## Known gaps

1. **Numeric SKU name collides with `numerals`.** `harbor 107.8` cannot be
   split by the current grammar. An item-lexicon-aware parse (try the
   catalogue's numeric names before the count) would recover it. Today the
   review queue catches it.
2. **`case_pack_needed` is reported but does not by itself force review.**
   A case count carries no numeric value, so nothing can be silently written —
   but the line still needs a human, and today it only gets one if the score
   happens to fall below threshold. Inherited from the source implementation
   and left unchanged here so this repository reflects the real code.
3. **The zone prior slightly outweighs a contradicting size hint** (0.21 vs
   0.20 of spread). In practice the ambiguity window catches the resulting
   near-tie, so the line goes to review rather than being silently wrong — but
   the weights were chosen by hand and have never been fit to data. This is
   pinned by a test that documents the real behaviour.
4. **The `sanity` component is a constant 0.5.** Prior-count plausibility needs
   session history, which this repository does not model.
5. **Alias learning from review approvals** exists in the private product but
   is unexercised — no real correction data yet.
6. **Confidence weights are hand-set.** They have never been fit to labelled
   data, because there is no labelled data yet. Treat them as a structured
   prior, not as a calibrated model.

## What would actually validate this

In order of value:

1. A real recording of a real shelf, with a human-labelled ground truth, to get
   a first honest auto-fill rate and — more importantly — a **false auto-fill
   rate**, which is the number that decides whether the tool is usable.
2. The same audio through both providers, to make the provider abstraction earn
   its keep.
3. Review-time-per-exception, since a system that flags everything is not
   automation.
4. Degradation curves against catalogue size.
