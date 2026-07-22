import { LineFlag } from '@/count-grammar';

export type ConfidenceComponents = {
  asr: number;
  productMatch: number;
  aliasTrust: number;
  zonePrior: number;
  countParse: number;
  /** Prior-count sanity — neutral 0.5 until history exists (see docs/architecture.md). */
  sanity: number;
  ambiguous: boolean;
  userFlagged: boolean;
};

export type ReviewReason =
  | 'ambiguous_product'
  | 'weak_asr'
  | 'count_parse_uncertain'
  | 'unexpected_item_in_zone'
  | 'user_flag'
  | 'no_match'
  | 'ambiguous_compound'
  | 'case_pack_needed'
  | 'new_item'
  | 'duplicate_possible';

/** Composite weights (docs/architecture.md § Confidence). Tune from real sessions. */
export function overallConfidence(c: ConfidenceComponents): number {
  const base =
    0.20 * c.asr +
    0.25 * c.productMatch +
    0.15 * c.aliasTrust +
    0.15 * c.zonePrior +
    0.15 * c.countParse +
    0.10 * c.sanity;
  const penalty = (c.ambiguous ? 0.15 : 0) + (c.userFlagged ? 0.3 : 0);
  return Math.max(0, Math.min(1, base - penalty));
}

/** Thresholds (docs/architecture.md § Confidence): <0.75 requires review; <0.55 is unresolved. */
export function needsReview(overall: number, reasons: ReviewReason[]): boolean {
  if (reasons.includes('user_flag') || reasons.includes('no_match')) return true;
  return overall < 0.75;
}

export function reviewReasons(opts: {
  components: ConfidenceComponents;
  lineFlags: LineFlag[];
  hasMatch: boolean;
  isNewItem: boolean;
}): ReviewReason[] {
  const { components, lineFlags, hasMatch, isNewItem } = opts;
  const reasons: ReviewReason[] = [];
  if (!hasMatch && !isNewItem) reasons.push('no_match');
  if (isNewItem) reasons.push('new_item');
  if (components.ambiguous) reasons.push('ambiguous_product');
  if (components.asr < 0.6) reasons.push('weak_asr');
  if (components.countParse < 0.7) reasons.push('count_parse_uncertain');
  if (hasMatch && components.zonePrior < 0.5) reasons.push('unexpected_item_in_zone');
  if (components.userFlagged) reasons.push('user_flag');
  if (lineFlags.includes('ambiguous_compound')) reasons.push('ambiguous_compound');
  if (lineFlags.includes('case_pack_needed')) reasons.push('case_pack_needed');
  return reasons;
}
