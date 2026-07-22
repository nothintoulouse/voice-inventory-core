import { Token, isNumberWord, parseSpokenDecimal, parseSpokenInteger, tokenize } from './tokens';
// (parseSpokenInteger is also used by prefixQuality to reject incomplete digit readouts)
import { CountFlag, CountParse, CountValue, GrammarConfig, defaultGrammarConfig, parseCountExpr } from './count-expr';

export type LineFlag =
  | CountFlag
  | 'user_flag'
  | 'no_count'
  | 'no_item'
  | 'shortened_count_suffix';

export type ParsedLine = {
  raw: string;
  kind: 'count' | 'additive' | 'not_here' | 'skip' | 'new_item' | 'unparsed';
  /** Verbatim item phrase for the matcher; null when the line has no item (e.g. bare "skip"). */
  itemText: string | null;
  /** Bottle size hint in mL when spoken ("liter", "seven fifty", "1.75"). */
  sizeMlHint: number | null;
  count: CountValue | null;
  flags: LineFlag[];
  /** Deterministic parse confidence in [0,1] — grammar certainty only, NOT ASR confidence. */
  parseConfidence: number;
};

const word = (t: Token | undefined): string | null =>
  t && t.kind === 'word' ? t.text : null;

const joinWords = (tokens: Token[]): string =>
  tokens.map((t) => t.text).join(' ').trim();

/** Spoken size expressions → mL. Checked ONLY between item and count, so bare
 * integers here are safe ("seven fifty" = 750 the size, not a count). */
function extractTrailingSize(tokens: Token[]): { sizeMl: number; length: number } | null {
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];

  // "leader" is what both cloud ASRs consistently hear for "liter".
  if (['liter', 'litre', 'leader', 'leaders'].includes(word(last) ?? '')) {
    // "[one] liter" / bare "liter" → 1000
    const before = tokens[tokens.length - 2];
    if (before && ((before.kind === 'number' && before.value === 1) || word(before) === 'one')) {
      return { sizeMl: 1000, length: 2 };
    }
    return { sizeMl: 1000, length: 1 };
  }
  if (word(last) === 'handle') return { sizeMl: 1750, length: 1 };

  // Deepgram numerals splits "seven fifty" into digit pair "7 50" → 750.
  if (tokens.length >= 2) {
    const a = tokens[tokens.length - 2];
    const b = tokens[tokens.length - 1];
    if (
      a.kind === 'number' && b.kind === 'number' &&
      Number.isInteger(a.value) && a.value >= 1 && a.value <= 17 &&
      Number.isInteger(b.value) && b.value === 50
    ) {
      const ml = a.value * 100 + b.value;
      if ([750, 1750].includes(ml)) return { sizeMl: ml, length: 2 };
    }
  }

  // Trailing spoken/digit numbers that are plausible sizes: 1750, 750, 375, 1000...
  for (let start = Math.max(0, tokens.length - 4); start < tokens.length; start++) {
    const slice = tokens.slice(start);
    const dec = parseSpokenDecimal(slice);
    if (dec && dec.length === slice.length) {
      // "one point seven five" / "1.75" → 1750 (liters spoken as decimal)
      const ml = Math.round(dec.value * 1000);
      if ([375, 500, 750, 1000, 1750].includes(ml)) return { sizeMl: ml, length: slice.length };
    }
    const int = parseSpokenInteger(slice);
    if (int && int.length === slice.length) {
      if ([187, 200, 375, 500, 750, 1000, 1750].includes(int.value)) {
        return { sizeMl: int.value, length: slice.length };
      }
    }
  }
  return null;
}

/**
 * Ranks what the count suffix would leave behind as the item phrase:
 *   2 — clean: empty, ends with a plain word, or ends with a recognized size
 *       expression ("nordvale reserve seven fifty" → size 750)
 *   1 — ends with a complete number, plausible for numeric item names
 *       ("harbor one oh seven", "anthem 107")
 *   0 — broken: ends mid-decimal ("halloran one point seven") or with a dangling
 *       operator ("fowlers plus")
 */
function prefixQuality(prefix: Token[]): 0 | 1 | 2 {
  if (prefix.length === 0) return 2;
  const size = extractTrailingSize(prefix);
  const rest = size ? prefix.slice(0, prefix.length - size.length) : prefix;
  const last = rest[rest.length - 1];
  if (!last) return 2;
  if (last.kind === 'word' && ['point', 'and', 'plus', 'add'].includes(last.text)) return 0;
  if (!isNumberWord(last)) return 2;
  // Trailing number run: fine for numeric names unless it's a decimal fragment
  // or an incomplete digit readout ("harbor one oh" ← "seven" was stolen).
  let s = rest.length - 1;
  while (s > 0 && isNumberWord(rest[s - 1])) s--;
  const before = rest[s - 1];
  if (before && before.kind === 'word' && before.text === 'point') return 0;
  const run = rest.slice(s);
  const parsed = parseSpokenInteger(run);
  if (!parsed || parsed.length !== run.length) return 0;
  return 1;
}

/**
 * Finds the count expression at the END of the line. Candidates are every
 * valid suffix parse; implausible counts are rejected, then the highest
 * prefix-quality candidate wins (longest first within a quality tier). This
 * protects numeric item names ("harbor one oh seven point four" → item
 * "harbor one oh seven", count 0.4) and size expressions ("halloran one point
 * seven five point five" → item "halloran", size 1750, count 0.5).
 */
function extractCountSuffix(
  tokens: Token[],
  config: GrammarConfig,
): { parse: CountParse; start: number; shortened: boolean } | null {
  const candidates: { parse: CountParse; start: number }[] = [];
  for (let start = 0; start < tokens.length; start++) {
    const parse = parseCountExpr(tokens.slice(start), config);
    if (parse) candidates.push({ parse, start });
  }
  if (candidates.length === 0) return null;

  const plausible = candidates.filter((c) => !c.parse.flags.includes('implausible_count'));
  for (const quality of [2, 1] as const) {
    const hit = plausible.find((c) => prefixQuality(tokens.slice(0, c.start)) === quality);
    if (hit) {
      return { parse: hit.parse, start: hit.start, shortened: hit.start !== candidates[0].start };
    }
  }
  if (plausible.length > 0) {
    return { parse: plausible[0].parse, start: plausible[0].start, shortened: false };
  }
  // Nothing plausible — surface the longest parse and let flags drive review.
  return { parse: candidates[0].parse, start: candidates[0].start, shortened: false };
}

function stripUserFlag(tokens: Token[]): { tokens: Token[]; flagged: boolean } {
  const text = joinWords(tokens);
  const patterns = [/\bflag (this|it)\b/, /\bhard to pronounce\b/, /\bflag\b$/];
  for (const p of patterns) {
    if (p.test(text)) {
      const cleaned = tokenize(text.replace(p, ' ')).filter((t) => t.kind !== 'boundary');
      return { tokens: cleaned, flagged: true };
    }
  }
  return { tokens, flagged: false };
}

/** Parses one utterance (already segmented) into a structured line. */
export function parseLine(raw: string, config: GrammarConfig = defaultGrammarConfig): ParsedLine {
  let tokens: Token[] = tokenize(raw).filter((t) => t.kind !== 'boundary');
  const flags: LineFlag[] = [];
  let confidence = 1.0;

  const base: Omit<ParsedLine, 'kind' | 'itemText' | 'count'> = {
    raw,
    sizeMlHint: null,
    flags,
    parseConfidence: confidence,
  };

  if (tokens.length === 0) {
    return { ...base, kind: 'unparsed', itemText: null, count: null, parseConfidence: 0 };
  }

  // User-forced flag phrases can trail any line form.
  const stripped = stripUserFlag(tokens);
  tokens = stripped.tokens;
  if (stripped.flagged) flags.push('user_flag');

  const text = joinWords(tokens);

  // Directives.
  if (/\bnot here\b$/.test(text) || /^not here\b/.test(text)) {
    const itemTokens = tokenize(text.replace(/\bnot here\b/, ' '));
    return {
      ...base, kind: 'not_here',
      itemText: joinWords(itemTokens) || null,
      count: null,
      parseConfidence: confidence,
    };
  }
  if (/\bskip( this| it)?\b$/.test(text) || text === 'skip') {
    const itemTokens = tokenize(text.replace(/\bskip( this| it)?\b/, ' '));
    return {
      ...base, kind: 'skip',
      itemText: joinWords(itemTokens) || null,
      count: null,
      parseConfidence: confidence,
    };
  }

  // "new item <name...>" — remainder may still carry size/count.
  let kind: ParsedLine['kind'] = 'count';
  if (word(tokens[0]) === 'new' && word(tokens[1]) === 'item') {
    kind = 'new_item';
    tokens = tokens.slice(2);
  }

  // Additive operator (additive operator, docs/count-grammar.md): explicit add/append to a running
  // total, distinct from starting a new line.
  //   "plus point four fowlers"    → +0.4 to Fowler's
  //   "add a bottle of marlo's"    → +1 to Marlo's
  //   "fowlers plus point four"    → trailing form
  if (kind === 'count') {
    const w0 = word(tokens[0]);
    if (w0 === 'plus' || w0 === 'add') {
      kind = 'additive';
      tokens = tokens.slice(1);
      // "add a bottle of X" / "add a X"
      if (word(tokens[0]) === 'a' || word(tokens[0]) === 'one') {
        if (word(tokens[1]) === 'bottle' && word(tokens[2]) === 'of') {
          return {
            ...base, kind, itemText: joinWords(tokens.slice(3)) || null,
            count: { type: 'each', value: 1 },
            parseConfidence: confidence,
          };
        }
      }
      // "plus <count> <item>" — count leads in additive form.
      for (let end = tokens.length; end > 0; end--) {
        const parse = parseCountExpr(tokens.slice(0, end), config);
        if (parse) {
          flags.push(...parse.flags);
          const itemText = joinWords(tokens.slice(end)) || null;
          if (parse.flags.includes('ambiguous_compound')) confidence -= 0.25;
          return {
            ...base, kind, itemText, count: parse.count,
            flags, parseConfidence: Math.max(confidence, 0.05),
          };
        }
      }
      // Fall through: "fowlers plus point four" handled below via suffix
      // (tokens already lost the operator, so re-tokenize raw minus operator).
    } else {
      const trailing = text.match(/^(.*)\b(?:plus|add)\s+(.+)$/);
      // "fowlers plus point four" is additive; "sunspire case plus three" is a
      // case count — the operator belongs to the case expression.
      if (trailing && !/\bcases?\s*$/.test(trailing[1])) {
        const countTokens = tokenize(trailing[2]).filter((t) => t.kind !== 'boundary');
        const parse = parseCountExpr(countTokens, config);
        const itemTail = tokenize(trailing[1]).filter((t) => t.kind !== 'boundary').at(-1);
        if (parse && trailing[1].trim() !== '' && itemTail !== undefined && !isNumberWord(itemTail)) {
          flags.push(...parse.flags.filter((f) => f !== 'case_pack_needed'));
          if (parse.flags.includes('case_pack_needed')) flags.push('case_pack_needed');
          if (parse.flags.includes('ambiguous_compound')) confidence -= 0.25;
          return {
            ...base, kind: 'additive', itemText: trailing[1].trim(),
            count: parse.count, flags, parseConfidence: Math.max(confidence, 0.05),
          };
        }
      }
    }
  }

  // Standard line: <item> [size] <count-suffix>
  const suffix = extractCountSuffix(tokens, config);
  if (!suffix) {
    flags.push('no_count');
    return {
      ...base, kind: kind === 'new_item' ? 'new_item' : 'unparsed',
      itemText: joinWords(tokens) || null, count: null,
      flags, parseConfidence: 0.3,
    };
  }

  flags.push(...suffix.parse.flags);
  if (suffix.shortened) {
    flags.push('shortened_count_suffix');
    confidence -= 0.1;
  }
  if (suffix.parse.flags.includes('ambiguous_compound')) confidence -= 0.25;
  if (suffix.parse.flags.includes('implausible_count')) confidence -= 0.3;
  if (suffix.parse.flags.includes('quarters_disabled')) confidence -= 0.2;

  let itemTokens = tokens.slice(0, suffix.start);
  let sizeMlHint: number | null = null;
  const size = extractTrailingSize(itemTokens);
  if (size) {
    sizeMlHint = size.sizeMl;
    itemTokens = itemTokens.slice(0, itemTokens.length - size.length);
  }

  const itemText = joinWords(itemTokens) || null;
  if (!itemText && kind === 'count') {
    flags.push('no_item');
    confidence -= 0.4;
  }

  return {
    ...base, kind, itemText, sizeMlHint,
    count: suffix.parse.count,
    flags, parseConfidence: Math.max(Math.min(confidence, 1), 0.05),
  };
}
