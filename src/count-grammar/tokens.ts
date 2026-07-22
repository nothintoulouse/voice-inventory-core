export type Token =
  | { kind: 'word'; text: string }
  | { kind: 'number'; text: string; value: number }
  | { kind: 'boundary'; text: string };

const BOUNDARY_RE = /[.!?;\n]/;

/**
 * Lowercases, splits hyphens ("seven-fifty" → "seven fifty"), keeps digit
 * tokens (including decimals like "0.6" / "1.75" from smart-formatted ASR)
 * as numbers, and turns sentence punctuation into boundary tokens used by
 * the segmenter.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const raw = text.toLowerCase().replace(/[-–—/]/g, ' ');
  // Separate punctuation from words, but keep decimal points inside numbers.
  const pieces = raw.match(/\d+(?:\.\d+)?|[a-z']+|[.!?;\n]/g) ?? [];
  for (const piece of pieces) {
    if (BOUNDARY_RE.test(piece) && piece.length === 1 && !/[a-z0-9]/.test(piece)) {
      tokens.push({ kind: 'boundary', text: piece });
    } else if (/^\d/.test(piece)) {
      tokens.push({ kind: 'number', text: piece, value: Number(piece) });
    } else {
      tokens.push({ kind: 'word', text: piece });
    }
  }
  return tokens;
}

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export function isNumberWord(t: Token): boolean {
  return t.kind === 'number' ||
    (t.kind === 'word' && (t.text in UNITS || t.text in TEENS || t.text in TENS || t.text === 'hundred'));
}

export type SpokenNumber = { value: number; length: number };

/**
 * Parses a spoken integer at the start of `tokens`. Handles, in priority
 * order:
 *  - digit tokens ("750", "107")
 *  - the hospitality shorthand "<n> fifty" → n*100+50 ("seven fifty" = 750,
 *    "seventeen fifty" = 1750) and general "<unit|teen> <tens>" hundreds
 *  - digit readouts of 3+ units incl. "oh" ("one oh seven" = 107)
 *  - plain tens/units composition ("seventy five" = 75, "two" = 2)
 * Returns null if tokens don't start with a number.
 */
export function parseSpokenInteger(tokens: Token[]): SpokenNumber | null {
  const t0 = tokens[0];
  if (!t0) return null;
  if (t0.kind === 'number') {
    if (!Number.isInteger(t0.value)) return null;
    return { value: t0.value, length: 1 };
  }
  if (t0.kind !== 'word') return null;

  const w = (i: number): string | null => {
    const t = tokens[i];
    return t && t.kind === 'word' ? t.text : null;
  };

  // Digit readout: 3+ consecutive unit words ("one oh seven").
  {
    let i = 0;
    let digits = '';
    while (w(i) !== null && (w(i)! in UNITS)) {
      digits += String(UNITS[w(i)!]);
      i++;
    }
    if (i >= 3) return { value: Number(digits), length: i };
  }

  // "<unit|teen> <tens>" hundreds shorthand: seven fifty, seventeen fifty.
  const head = w(0)!;
  const headVal = head in UNITS ? UNITS[head] : head in TEENS ? TEENS[head] : null;
  if (headVal !== null && headVal > 0 && w(1) !== null && (w(1)! in TENS)) {
    const tail = TENS[w(1)!];
    // "<unit|teen> <tens> <unit>": seven seventy five → 775.
    if (w(2) !== null && (w(2)! in UNITS) && UNITS[w(2)!] > 0) {
      return { value: headVal * 100 + tail + UNITS[w(2)!], length: 3 };
    }
    return { value: headVal * 100 + tail, length: 2 };
  }

  // "<unit|teen> hundred [<tens>] [<unit>]"
  if (headVal !== null && headVal > 0 && w(1) === 'hundred') {
    let value = headVal * 100;
    let len = 2;
    if (w(2) !== null && (w(2)! in TENS)) {
      value += TENS[w(2)!];
      len = 3;
      if (w(3) !== null && (w(3)! in UNITS) && UNITS[w(3)!] > 0) {
        value += UNITS[w(3)!];
        len = 4;
      }
    } else if (w(2) !== null && (w(2)! in UNITS) && UNITS[w(2)!] > 0) {
      value += UNITS[w(2)!];
      len = 3;
    }
    return { value, length: len };
  }

  // "<tens> [<unit>]": seventy five → 75.
  if (head in TENS) {
    if (w(1) !== null && (w(1)! in UNITS) && UNITS[w(1)!] > 0) {
      return { value: TENS[head] + UNITS[w(1)!], length: 2 };
    }
    return { value: TENS[head], length: 1 };
  }

  // Single unit or teen.
  if (head in UNITS) return { value: UNITS[head], length: 1 };
  if (head in TEENS) return { value: TEENS[head], length: 1 };

  return null;
}

/**
 * Parses a spoken decimal at the start of `tokens`:
 *  - a decimal digit token ("1.75", "0.6")
 *  - "[<int>] point <digit>..." ("point five" = 0.5, "one point seven five" = 1.75)
 * Integers are NOT accepted here — use parseSpokenInteger.
 */
export function parseSpokenDecimal(tokens: Token[]): SpokenNumber | null {
  const t0 = tokens[0];
  if (!t0) return null;
  if (t0.kind === 'number' && !Number.isInteger(t0.value)) {
    return { value: t0.value, length: 1 };
  }

  let whole = 0;
  let i = 0;
  if (t0.kind === 'word' && t0.text !== 'point') {
    const int = parseSpokenInteger(tokens);
    if (!int) return null;
    whole = int.value;
    i = int.length;
  } else if (t0.kind === 'number') {
    whole = t0.value;
    i = 1;
  }

  const pt = tokens[i];
  if (!pt || pt.kind !== 'word' || pt.text !== 'point') return null;
  i++;

  let frac = '';
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'word' && t.text in UNITS) {
      frac += String(UNITS[t.text]);
      i++;
    } else if (t.kind === 'number' && Number.isInteger(t.value) && t.text.length <= 2) {
      frac += t.text;
      i++;
    } else {
      break;
    }
  }
  if (frac === '') return null;
  return { value: whole + Number(`0.${frac}`), length: i };
}
