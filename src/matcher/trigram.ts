/**
 * A faithful, dependency-free port of PostgreSQL `pg_trgm`'s trigram
 * similarity.
 *
 * Production runs this inside Postgres (GIN index on `alias_text`), which is
 * why the scoring layer takes similarity as an input rather than computing it.
 * This module exists so the matcher can be exercised, tested and demonstrated
 * without a database — and so the port can be checked against documented
 * `pg_trgm` behaviour rather than being an invented metric.
 *
 * Algorithm (per pg_trgm docs):
 *  - lowercase; treat every non-alphanumeric character as a word separator
 *  - each word contributes the trigrams of "  word " (two leading blanks,
 *    one trailing blank)
 *  - similarity(a, b) = |T(a) ∩ T(b)| / |T(a) ∪ T(b)|  (sets, not multisets)
 */

/** Distinct trigrams of a string, exactly as `show_trgm()` would report them. */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 0);
  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/** Trigram similarity in [0,1]. Mirrors `similarity(a, b)` in pg_trgm. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  if (union === 0) return 0;
  return shared / union;
}
