/** Candidate row as fetched by match.ts — one per (item, best-matching alias). */
export type CandidateRow = {
  itemId: string;
  canonicalName: string;
  sizeMl: number | null;
  /** Best-similarity alias that produced this candidate (null = matched on canonical name). */
  aliasText: string | null;
  aliasTrust: 'approved' | 'generated' | null;
  /** pg_trgm similarity in [0,1] of the best alias/name against the spoken phrase. */
  trgmScore: number;
  exactAlias: boolean;
  inZone: boolean;
  zoneExpected: boolean;
};

export type ScoredCandidate = {
  itemId: string;
  canonicalName: string;
  sizeMl: number | null;
  matchedAlias: string | null;
  /** Product string match component in [0,1]. */
  productScore: number;
  aliasTrustScore: number;
  zonePriorScore: number;
  score: number;
};

export type MatchResult = {
  candidates: ScoredCandidate[];
  /** Top two candidates scored within AMBIGUITY_WINDOW of each other. */
  ambiguous: boolean;
};

const AMBIGUITY_WINDOW = 0.1;

/**
 * Ranks candidate rows for a spoken item phrase. Pure — SQL similarity comes
 * in via CandidateRow. Components (docs/architecture.md § Matching): exact alias > trigram score,
 * alias trust, zone prior, size-hint agreement.
 */
export function rankCandidates(
  rows: CandidateRow[],
  sizeMlHint: number | null,
  opts: { zoneHasMembers?: boolean } = {},
): MatchResult {
  // A zone with no item assignments yet gives no signal — stay neutral
  // instead of penalizing everything (memberships grow via review approvals).
  const zoneHasMembers = opts.zoneHasMembers ?? true;
  const scored: ScoredCandidate[] = rows.map((row) => {
    const productScore = row.exactAlias ? 1.0 : row.trgmScore;
    const aliasTrustScore =
      row.aliasTrust === 'approved' ? 1.0 : row.aliasTrust === 'generated' ? 0.6 : 0.8;
    const zonePriorScore = !zoneHasMembers
      ? 0.7
      : row.inZone
        ? (row.zoneExpected ? 1.0 : 0.7)
        : 0.3;

    // Size hint: agreement is a mild boost, disagreement a real penalty —
    // a spoken "liter" against a 750 candidate is strong counter-evidence.
    let sizeAdj = 0;
    if (sizeMlHint !== null && row.sizeMl !== null) {
      sizeAdj = row.sizeMl === sizeMlHint ? 0.05 : -0.15;
    }

    const score =
      0.55 * productScore + 0.15 * aliasTrustScore + 0.3 * zonePriorScore + sizeAdj;

    return {
      itemId: row.itemId,
      canonicalName: row.canonicalName,
      sizeMl: row.sizeMl,
      matchedAlias: row.aliasText,
      productScore,
      aliasTrustScore,
      zonePriorScore,
      score: Math.max(0, Math.min(1, score)),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const ambiguous =
    scored.length >= 2 && scored[0].score - scored[1].score < AMBIGUITY_WINDOW;

  return { candidates: scored.slice(0, 5), ambiguous };
}
