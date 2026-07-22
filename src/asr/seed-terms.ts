import type { SeedingProviderId } from './types';

// AssemblyAI keyterms_prompt: ≤1,000 terms, ≤6 words per term.
// https://www.assemblyai.com/docs/pre-recorded-audio/keyterms-prompting
const ASSEMBLYAI_MAX_TERMS = 1000;
const ASSEMBLYAI_MAX_WORDS_PER_TERM = 6;

// Deepgram keyterm: ≤500 tokens per request; we budget conservatively with
// one whitespace-separated word ≈ one token.
// https://developers.deepgram.com/docs/keyterm
const DEEPGRAM_TOKEN_BUDGET = 500;

const wordCount = (term: string): number => term.split(' ').length;

/**
 * Cleans and caps vocabulary seed terms for a provider. Trims and collapses
 * whitespace, drops empties, dedupes case-insensitively (first occurrence
 * wins). Input arrives pre-sorted by alias priority, so caps always keep the
 * front of the list.
 */
export function prepareSeedTerms(terms: string[], provider: SeedingProviderId): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of terms) {
    const term = raw.trim().replace(/\s+/g, ' ');
    if (term === '') continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(term);
  }

  if (provider === 'assemblyai') {
    return cleaned
      .filter((term) => wordCount(term) <= ASSEMBLYAI_MAX_WORDS_PER_TERM)
      .slice(0, ASSEMBLYAI_MAX_TERMS);
  }

  // Deepgram: greedy by priority — take each term that still fits the
  // remaining word budget (an oversized term is skipped, not a hard stop).
  const taken: string[] = [];
  let budget = DEEPGRAM_TOKEN_BUDGET;
  for (const term of cleaned) {
    const words = wordCount(term);
    if (words > budget) continue;
    budget -= words;
    taken.push(term);
  }
  return taken;
}
