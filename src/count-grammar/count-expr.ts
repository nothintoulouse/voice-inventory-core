import { Token, parseSpokenDecimal, parseSpokenInteger } from './tokens';

export type GrammarConfig = {
  /**
   * House rule for "one full and one point four":
   *  - 'literal': 1 + 1.4 = 2.4
   *  - 'reinterpret': "one [bottle at] point four" → 1 + 0.4 = 1.4
   *  - 'flag': parse literal but mark ambiguous for review
   */
  compoundConvention: 'literal' | 'reinterpret' | 'flag';
  /** Whether "quarter" / "three quarters" are enabled (docs/count-grammar.md § Fractions). */
  quarters: boolean;
  /** Counts above this are treated as implausible and rejected in favor of a shorter parse. */
  maxPlausibleCount: number;
};

export const defaultGrammarConfig: GrammarConfig = {
  compoundConvention: 'flag',
  quarters: true,
  maxPlausibleCount: 40,
};

export type CountFlag =
  | 'ambiguous_compound'
  | 'quarters_disabled'
  | 'implausible_count'
  | 'case_pack_needed';

export type CountValue =
  | { type: 'each'; value: number }
  | { type: 'case'; cases: number; extraEach: number };

export type CountParse = {
  count: CountValue;
  flags: CountFlag[];
};

type Simple = { value: number; length: number; flags: CountFlag[]; wholeBottleWord: boolean };

const word = (t: Token | undefined): string | null =>
  t && t.kind === 'word' ? t.text : null;

/** Parses a "simple" count at the start of tokens: keywords, fractions, decimals, integers. */
function parseSimple(tokens: Token[], config: GrammarConfig): Simple | null {
  const w0 = word(tokens[0]);

  if (w0 === 'full') return { value: 1, length: 1, flags: [], wholeBottleWord: true };
  if (w0 === 'empty') return { value: 0, length: 1, flags: [], wholeBottleWord: true };
  if (w0 === 'half') return { value: 0.5, length: 1, flags: [], wholeBottleWord: false };
  if (w0 === 'quarter' || (w0 === 'a' && word(tokens[1]) === 'quarter')) {
    const len = w0 === 'a' ? 2 : 1;
    return {
      value: 0.25, length: len, wholeBottleWord: false,
      flags: config.quarters ? [] : ['quarters_disabled'],
    };
  }
  if (w0 === 'three' && (word(tokens[1]) === 'quarters' || word(tokens[1]) === 'quarter')) {
    return {
      value: 0.75, length: 2, wholeBottleWord: false,
      flags: config.quarters ? [] : ['quarters_disabled'],
    };
  }

  // "<n> tenths": five tenths = 0.5
  {
    const int = parseSpokenInteger(tokens);
    if (int && word(tokens[int.length]) === 'tenths') {
      return { value: int.value / 10, length: int.length + 1, flags: [], wholeBottleWord: false };
    }
  }

  // Decimals: "point five", "zero point five", "one point four", "0.6"
  const dec = parseSpokenDecimal(tokens);
  if (dec) return { value: dec.value, length: dec.length, flags: [], wholeBottleWord: false };

  // Integer, optionally followed by "full": "two full" / bare "two"
  const int = parseSpokenInteger(tokens);
  if (int) {
    if (word(tokens[int.length]) === 'full') {
      return { value: int.value, length: int.length + 1, flags: [], wholeBottleWord: true };
    }
    return { value: int.value, length: int.length, flags: [], wholeBottleWord: false };
  }

  return null;
}

/**
 * Full-match parser for a count expression. Returns null unless the ENTIRE
 * token slice is a valid count expression.
 *
 * Grammar:
 *   count   := 'case'|'cases' ('plus' simple)?            (case_pack_needed)
 *            | <int> 'case'|'cases' ('plus' simple)?
 *            | simple ('and' simple)?                     (compound)
 *   simple  := 'full' | 'empty' | 'half' | quarters | fraction | decimal
 *            | int ['full']
 */
export function parseCountExpr(tokens: Token[], config: GrammarConfig): CountParse | null {
  if (tokens.length === 0) return null;

  // Case counts: "case plus three", "two cases plus three", "case".
  {
    let i = 0;
    let cases = 1;
    const lead = parseSpokenInteger(tokens);
    if (lead && (word(tokens[lead.length]) === 'case' || word(tokens[lead.length]) === 'cases')) {
      cases = lead.value;
      i = lead.length + 1;
    } else if (word(tokens[0]) === 'case' || word(tokens[0]) === 'cases') {
      i = 1;
    } else {
      i = -1;
    }
    if (i !== -1) {
      if (i === tokens.length) {
        return { count: { type: 'case', cases, extraEach: 0 }, flags: ['case_pack_needed'] };
      }
      if (word(tokens[i]) === 'plus') {
        const extra = parseSimple(tokens.slice(i + 1), config);
        if (extra && i + 1 + extra.length === tokens.length) {
          return {
            count: { type: 'case', cases, extraEach: extra.value },
            flags: ['case_pack_needed', ...extra.flags],
          };
        }
      }
      return null;
    }
  }

  const first = parseSimple(tokens, config);
  if (!first) return null;

  // Whole expression consumed → simple count.
  if (first.length === tokens.length) {
    const flags = [...first.flags];
    if (first.value > config.maxPlausibleCount) flags.push('implausible_count');
    return { count: { type: 'each', value: first.value }, flags };
  }

  // Compound: "<simple> and <simple>" — "one full and point four".
  if (word(tokens[first.length]) === 'and') {
    const rest = tokens.slice(first.length + 1);
    const second = parseSimple(rest, config);
    if (second && first.length + 1 + second.length === tokens.length) {
      const flags = [...first.flags, ...second.flags];
      let value: number;
      if (second.value < 1 || second.wholeBottleWord) {
        // "one full and point four" → unambiguous 1.4;
        // "one and two full" → unambiguous 3.
        value = first.value + second.value;
      } else {
        // "one full and one point four" — house rule (docs/count-grammar.md § Compound counts).
        switch (config.compoundConvention) {
          case 'reinterpret':
            value = first.value + (second.value - Math.trunc(second.value));
            break;
          case 'flag':
            value = first.value + second.value;
            flags.push('ambiguous_compound');
            break;
          case 'literal':
            value = first.value + second.value;
            break;
        }
      }
      if (value > config.maxPlausibleCount) flags.push('implausible_count');
      return { count: { type: 'each', value }, flags };
    }
  }

  return null;
}
