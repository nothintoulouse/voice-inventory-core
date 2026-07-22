import { Token, isNumberWord, tokenize } from './tokens';
import { GrammarConfig, defaultGrammarConfig, parseCountExpr } from './count-expr';

const word = (t: Token | undefined): string | null =>
  t && t.kind === 'word' ? t.text : null;

/** Words that continue a count expression across what would otherwise be a cut.
 * 'plus' is deliberately absent: a completed count followed by "plus ..." is an
 * additive line starting (additive operator, docs/count-grammar.md) — case-count "plus" is consumed
 * by longest-match inside longestCompleteCountEnd before this set is consulted. */
const CONTINUATION = new Set(['and', 'full', 'tenths', 'point', 'quarters', 'quarter', 'cases', 'case']);

/** Terminal directive words that end a line by themselves. */
const DIRECTIVE_TAIL = /\b(not here|skip( this| it)?|flag (this|it)|hard to pronounce)\b/;

/**
 * Splits a transcript into count-line utterances.
 *
 * Primary signal: ASR sentence punctuation. Fallback for run-on speech: a cut
 * is placed after a COMPLETE count expression when the next token starts a new
 * item phrase. Bare integers don't terminate a line mid-stream (protects item
 * names like "old no seven" / "harbor one oh seven") — a count must end with a
 * fraction, decimal, keyword (full/empty/half/quarters/tenths), or directive.
 */
export function segmentTranscript(
  text: string,
  config: GrammarConfig = defaultGrammarConfig,
): string[] {
  const lines: string[] = [];

  // Pass 1: punctuation boundaries.
  const roughSegments: Token[][] = [];
  let current: Token[] = [];
  for (const t of tokenize(text)) {
    if (t.kind === 'boundary') {
      if (current.length) roughSegments.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length) roughSegments.push(current);

  // Pass 2: split run-on segments after complete count expressions.
  for (const seg of roughSegments) {
    let lineStart = 0;
    let i = 0;
    while (i < seg.length) {
      const cutAfterDirective = matchDirectiveEnd(seg, i);
      if (cutAfterDirective !== null) {
        lines.push(join(seg.slice(lineStart, cutAfterDirective)));
        lineStart = cutAfterDirective;
        i = cutAfterDirective;
        continue;
      }

      const end = longestCompleteCountEnd(seg, i, config);
      if (end !== null && end > i) {
        const next = seg[end];
        const nextWord = word(next);
        const continues = next !== undefined && (
          (nextWord !== null && CONTINUATION.has(nextWord)) || isNumberWord(next)
        );
        // An additive line leads with its count ("plus point two fowlers") —
        // the item FOLLOWS the count, so don't cut right after it.
        const additiveLead =
          (word(seg[lineStart]) === 'plus' || word(seg[lineStart]) === 'add') &&
          i === lineStart + 1;
        // "flag this" / "hard to pronounce" attach BACKWARD to this line —
        // don't cut between a count and its user-flag.
        const flagFollows = startsUserFlag(seg, end);
        if (!continues && !additiveLead && !flagFollows && lineTerminatesConvincingly(seg, i, end)) {
          if (end >= seg.length || startsNewItemPhrase(seg, end)) {
            lines.push(join(seg.slice(lineStart, end)));
            lineStart = end;
            i = end;
            continue;
          }
        }
        i = end;
        continue;
      }
      i++;
    }
    if (lineStart < seg.length) lines.push(join(seg.slice(lineStart)));
  }

  return lines.map((l) => l.trim()).filter((l) => l.length > 0);
}

function join(tokens: Token[]): string {
  return tokens.map((t) => t.text).join(' ');
}

/** Longest end index such that seg[start..end) parses as a complete count expression. */
function longestCompleteCountEnd(seg: Token[], start: number, config: GrammarConfig): number | null {
  let best: number | null = null;
  for (let end = start + 1; end <= seg.length; end++) {
    if (parseCountExpr(seg.slice(start, end), config)) best = end;
  }
  return best;
}

/** Counts that justify a mid-stream cut must not be bare integers. */
function lineTerminatesConvincingly(seg: Token[], start: number, end: number): boolean {
  const slice = seg.slice(start, end);
  const last = slice[slice.length - 1];
  const lastWord = word(last);
  if (lastWord !== null &&
      ['full', 'empty', 'half', 'quarter', 'quarters', 'tenths'].includes(lastWord)) {
    return true;
  }
  // Spoken fraction ("point five") — the expression contains 'point'.
  if (slice.some((t) => word(t) === 'point')) return true;
  // Decimal digit token ("0.4", "1.3").
  if (last && last.kind === 'number' && !Number.isInteger(last.value)) return true;
  // Case expressions ("case plus three") end convincingly too.
  if (slice.some((t) => word(t) === 'case' || word(t) === 'cases')) return true;
  return false;
}

/** After a cut, the next tokens should look like the start of an item phrase (a non-number word). */
function startsNewItemPhrase(seg: Token[], idx: number): boolean {
  const t = seg[idx];
  if (!t) return false;
  if (t.kind !== 'word') return false;
  return !isNumberWord(t) && !CONTINUATION.has(t.text);
}

const USER_FLAG_START = /^(flag (this|it)|hard to pronounce)/;

function startsUserFlag(seg: Token[], idx: number): boolean {
  return USER_FLAG_START.test(join(seg.slice(idx, idx + 3)));
}

function matchDirectiveEnd(seg: Token[], from: number): number | null {
  // The directive must START at `from` — matching any window that merely ends
  // with one would swallow the preceding line ("…7.8 solara not here" as one).
  for (let end = Math.min(seg.length, from + 4); end > from; end--) {
    const phrase = join(seg.slice(from, end));
    const m = phrase.match(DIRECTIVE_TAIL);
    if (m && m.index === 0 && m[0] === phrase) return end;
  }
  return null;
}
