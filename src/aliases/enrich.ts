/**
 * LLM alias enrichment — the probabilistic assist that layers on top of the
 * deterministic alias generator.
 *
 * Two design constraints matter more than the model choice:
 *
 *  1. **It runs once per catalogue import, never in the per-count hot path.**
 *     A count session must not depend on an LLM being available, fast, or
 *     funded.
 *  2. **It degrades silently to deterministic aliases only.** Every failure
 *     mode — no credential, rate limit, malformed output — returns an empty
 *     map, and matching still works.
 *
 * The transport is injected, so this repository ships a deterministic stub
 * enricher and never makes a network call. The production implementation
 * substitutes a real model call behind the same `AliasEnricher` type.
 */

export const ENRICHMENT_BATCH_SIZE = 60;

export const ENRICHMENT_PROMPT = [
  'These are beverage inventory item names from a count sheet.',
  'For each, list up to 8 short spoken aliases someone would actually say',
  'while counting shelves quickly, plus likely speech-recognition mishearings',
  '(phonetic confusions). Lowercase, no sizes, no duplicates of the full name.',
].join(' ');

/** name → extra aliases. Must never throw; failures return fewer entries. */
export type AliasEnricher = (names: string[]) => Promise<Map<string, string[]>>;

/**
 * Splits names into batches and merges the results, swallowing failures.
 * This is the part worth unit-testing — the batching and the failure
 * containment, not the model output.
 */
export async function enrichAliases(
  names: string[],
  enricher: AliasEnricher,
  batchSize: number = ENRICHMENT_BATCH_SIZE,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    try {
      const result = await enricher(batch);
      for (const [name, aliases] of result) {
        if (batch.includes(name)) out.set(name, aliases);
      }
    } catch {
      // A failed batch costs recall, never correctness. Keep going.
      continue;
    }
  }
  return out;
}

/** An enricher that returns nothing — the honest default when no model is configured. */
export const nullEnricher: AliasEnricher = async () => new Map();

/**
 * A deterministic stand-in used by the offline demo and tests: it derives a
 * couple of plausible spoken forms without a model, so the wiring is
 * exercised end to end. It is NOT a language model and makes no claim to
 * match one's output.
 */
export const stubEnricher: AliasEnricher = async (names) => {
  const out = new Map<string, string[]>();
  for (const name of names) {
    // Drop size tokens the way a person would when saying the name out loud.
    const words = name
      .toLowerCase()
      .replace(/[^a-z0-9'’\s.]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0 && !/\d/.test(w));
    const spoken = words.join(' ');
    const aliases = new Set<string>();
    if (words.length > 1) aliases.add(words[0]);
    if (/['’]/.test(spoken)) aliases.add(spoken.replace(/['’]/g, ''));
    aliases.delete(name.toLowerCase());
    if (aliases.size > 0) out.set(name, [...aliases]);
  }
  return out;
};
