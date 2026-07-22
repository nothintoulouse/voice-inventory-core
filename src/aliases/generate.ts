/** Deterministic spoken-alias generation from a sheet item name. LLM
 * enrichment (mishearings, nicknames) layers on top at import time; these
 * rules alone make exact/fuzzy matching workable. */

const SIZE_RE = /\b(\d+(\.\d+)?\s*(ml|l|ltr|liter|litre|oz|pk|pack|ct)|750|375|1750|1000)\b\.?/gi;
const NOISE_WORDS = new Set([
  'the', 'of', 'and', '&', 'with', 'label', 'brand',
]);

const NUM_WORDS: Record<string, string> = {
  '0': 'oh', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};

/** "107" → "one oh seven" — numeric name parts get spoken forms. */
function spokenDigits(num: string): string {
  return num.split('').map((d) => NUM_WORDS[d] ?? d).join(' ');
}

export function generateAliases(name: string): string[] {
  const aliases = new Set<string>();
  const add = (s: string) => {
    const cleaned = s.replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleaned.length >= 2 && cleaned !== name.toLowerCase()) aliases.add(cleaned);
  };

  const noSize = name.replace(SIZE_RE, ' ').replace(/[()]/g, ' ');
  add(noSize);

  const words = noSize
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w.toLowerCase()));

  if (words.length >= 1 && words[0].length >= 4) add(words[0]);
  if (words.length >= 2) add(`${words[0]} ${words[1]}`);
  // Possessive/apostrophe variants: "Marlo's" ↔ "Marlos"
  if (/['’]/.test(noSize)) add(noSize.replace(/['’]/g, ''));

  // Spoken number variants for numeric name parts: "Harbor 107" → "harbor one oh seven"
  const numMatch = noSize.match(/\b(\d{2,4})\b/);
  if (numMatch) {
    add(noSize.replace(numMatch[1], spokenDigits(numMatch[1])));
    const head = words.filter((w) => !/\d/.test(w));
    if (head.length >= 1) add(`${head[0]} ${spokenDigits(numMatch[1])}`);
  }

  return [...aliases];
}
