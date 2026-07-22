import {
  GrammarConfig,
  ParsedLine,
  defaultGrammarConfig,
  parseTranscript,
  tokenize,
} from '@/count-grammar';
import { Catalog, matchItemPhrase } from '@/matcher/catalog';
import type { ScoredCandidate } from '@/matcher/score';
import type { NormalizedTranscript, TranscriptWord } from '@/asr/types';
import {
  ConfidenceComponents,
  ReviewReason,
  needsReview,
  overallConfidence,
  reviewReasons,
} from './confidence';

/**
 * Assigns ASR word confidences to parsed lines by walking the transcript's
 * word stream in order and slicing proportionally to each line's token count.
 * Approximate (ASR tokenization differs slightly from ours) but stable and
 * deterministic; per-line averages are what feed the composite score.
 */
export function lineAsrConfidences(lines: ParsedLine[], words: TranscriptWord[]): number[] {
  if (words.length === 0) return lines.map(() => 0.9);
  const tokenCounts = lines.map(
    (l) => tokenize(l.raw).filter((t) => t.kind !== 'boundary').length || 1,
  );
  const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let cursor = 0;
  for (const count of tokenCounts) {
    const take = Math.max(1, Math.round((count / totalTokens) * words.length));
    const slice = words.slice(cursor, Math.min(cursor + take, words.length));
    cursor += take;
    const avg = slice.length
      ? slice.reduce((a, w) => a + w.confidence, 0) / slice.length
      : 0.9;
    out.push(avg);
  }
  return out;
}

/** Below this score a "match" is noise, not a candidate. */
const MATCH_FLOOR = 0.35;

export type ProposedCountLine = {
  spokenText: string;
  lineKind: ParsedLine['kind'];
  itemText: string | null;
  itemId: string | null;
  canonicalName: string | null;
  parsedCount: number | null;
  count: ParsedLine['count'];
  sizeMlHint: number | null;
  asrConfidence: number;
  itemConfidence: number;
  countConfidence: number;
  zoneConfidence: number;
  overallConfidence: number;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  candidates: ScoredCandidate[];
};

export type ReconcileInput = {
  transcript: NormalizedTranscript;
  catalog: Catalog;
  zoneId: string | null;
  config?: GrammarConfig;
  /** Item ids already counted in this zone by an EARLIER recording. */
  alreadyCountedItemIds?: string[];
};

/**
 * Transcript → proposed count lines.
 *
 * This is the device-agnostic, database-agnostic core: a normalized
 * transcript in, a fully-scored review queue out. It performs no I/O, so the
 * whole thing is reproducible from a fixture. Production wraps it with
 * persistence; nothing about the decisions below lives in the database.
 */
export function reconcileTranscript(input: ReconcileInput): ProposedCountLine[] {
  const config = input.config ?? defaultGrammarConfig;
  const lines = parseTranscript(input.transcript.text, config);
  const asrConfidences = lineAsrConfidences(lines, input.transcript.words);
  const alreadyCounted = new Set(input.alreadyCountedItemIds ?? []);
  const countedThisRun = new Set<string>();

  const out: ProposedCountLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const asr = asrConfidences[i];

    const match =
      line.itemText !== null
        ? matchItemPhrase(input.catalog, {
            itemText: line.itemText,
            zoneId: input.zoneId,
            sizeMlHint: line.sizeMlHint,
          })
        : { candidates: [] as ScoredCandidate[], ambiguous: false };

    const top = match.candidates[0];
    const isNewItem = line.kind === 'new_item';
    const hasMatch = top !== undefined && top.score >= MATCH_FLOOR && !isNewItem;

    const components: ConfidenceComponents = {
      asr,
      productMatch: hasMatch ? top.productScore : 0,
      aliasTrust: hasMatch ? top.aliasTrustScore : 0.5,
      zonePrior: hasMatch ? top.zonePriorScore : 0.5,
      countParse: line.parseConfidence,
      sanity: 0.5,
      ambiguous: match.ambiguous,
      userFlagged: line.flags.includes('user_flag'),
    };

    const reasons = reviewReasons({
      components,
      lineFlags: line.flags,
      hasMatch,
      isNewItem,
    });

    // Duplicate detection: the same item counted twice in the same zone would
    // otherwise be summed silently at export time.
    if (
      hasMatch &&
      line.kind === 'count' &&
      (alreadyCounted.has(top.itemId) || countedThisRun.has(top.itemId))
    ) {
      reasons.push('duplicate_possible');
    }
    if (hasMatch && (line.kind === 'count' || line.kind === 'additive')) {
      countedThisRun.add(top.itemId);
    }

    const overall = overallConfidence(components);
    const review = needsReview(overall, reasons) || reasons.includes('duplicate_possible');

    out.push({
      spokenText: line.raw,
      lineKind: line.kind,
      itemText: line.itemText,
      itemId: hasMatch ? top.itemId : null,
      canonicalName: hasMatch ? top.canonicalName : null,
      parsedCount: line.count?.type === 'each' ? line.count.value : null,
      count: line.count,
      sizeMlHint: line.sizeMlHint,
      asrConfidence: asr,
      itemConfidence: components.productMatch,
      countConfidence: line.parseConfidence,
      zoneConfidence: components.zonePrior,
      overallConfidence: overall,
      needsReview: review,
      reviewReasons: reasons,
      candidates: match.candidates,
    });
  }

  return out;
}
