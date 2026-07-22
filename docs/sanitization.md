# Sanitization notes

This repository is a deliberate extraction from a private working project, not
a mirror of it. Fresh git history; none of the private repository's history was
copied.

## What was extracted

The provider-neutral transcription interfaces, the count grammar, the alias
generation rules, the fuzzy matching and ranking, the confidence and
human-review decision logic, the patch-in-place workbook behaviour, and the
tests for all of it.

## What was deliberately left out

| Excluded | Why |
|---|---|
| Next.js application, routes, and UI | Not needed to understand or evaluate the engineering |
| Postgres persistence layer and connection code | Carries deployment and credential surface; the schema is described in prose in `architecture.md` instead |
| Blob storage, upload, and audio-capture code | Deployment surface; unnecessary here |
| Authentication and session handling | Deployment surface |
| Deployment, hosting, and environment configuration | Deployment surface |
| Product and business strategy documents | Not engineering |
| Any real workbook, product list, vendor, customer, or property | Business data |

## Credentials

No credential, token, connection string, or project identifier was copied. The
provider adapters read their keys from documented environment variables
(`DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`) and are never given one by anything
in this repository — the tests and the demo pass a literal placeholder and an
injected transport that never reaches the network.

## Product names

The private project uses real commercial beverage brands as illustrative
examples in comments, tests, and fixtures. **Every one of them was replaced
with an invented name** — `Marlo's`, `Nordvale Reserve`, `Fowler's Mark`,
`Wenlock's`, `Thornbury Dry`, `Harbor 107`, `Bison Creek`, `Verano Amaro`,
`Solara`, `Halden Cabernet`, `Bellamonte Prosecco`, `Ferrow Rye`, and so on.

The substitutions preserve the linguistic properties each example was chosen
for — possessive apostrophes, two-word names, numeric SKU names, phonetic
near-misses — so no test lost its point. Any resemblance to a real product is
unintended.

Generic category words (vodka, bourbon, gin, amaro, prosecco, chardonnay) were
kept, since they carry no information about anyone's inventory.

## Fixtures

No binary fixture is committed. The `.xlsx` used by the tests and the demo is
generated in memory by `src/fixtures/workbook.ts` on every run. The transcript
fixture is hand-written synthetic text with generated word timings. The
provider response fixtures are hand-constructed to match the documented
response *shape*; they contain no recorded API traffic.

## Attribution of measured results

One measurement in [evaluation.md](evaluation.md) was taken in the private
application rather than in this repository, and is labelled as such. It was
produced from synthetic text-to-speech audio against a synthetic 9-item sheet,
so it contains no real inventory data either.
