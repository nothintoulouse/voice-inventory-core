import { CandidateRow, MatchResult, rankCandidates } from './score';
import { trigramSimilarity } from './trigram';

export type AliasTrust = 'approved' | 'generated';

export type CatalogAlias = {
  text: string;
  trust: AliasTrust;
};

export type CatalogItem = {
  id: string;
  canonicalName: string;
  sizeMl: number | null;
  aliases: CatalogAlias[];
};

/** Which items a given fuzzy zone is expected to contain. */
export type ZoneMembership = {
  zoneId: string;
  itemIds: string[];
  /** Items present but not "expected" here (e.g. strays) score lower. */
  unexpectedItemIds?: string[];
};

export type Catalog = {
  items: CatalogItem[];
  zones: ZoneMembership[];
};

/** Below this trigram similarity a row is not even a candidate (mirrors the SQL `> 0.25`). */
const SIMILARITY_FLOOR = 0.25;
const MAX_CANDIDATE_ROWS = 25;

/**
 * In-memory candidate generation. This is a direct translation of the
 * production SQL (reproduced in docs/architecture.md): for each item take the
 * best of exact-alias / trigram-alias / trigram-canonical-name, attach zone
 * membership, then hand the rows to the pure ranker.
 *
 * Same inputs → same rows → same ranking, on any machine, with no database.
 */
export function generateCandidates(
  catalog: Catalog,
  opts: { itemText: string; zoneId: string | null },
): CandidateRow[] {
  const zone = opts.zoneId ? catalog.zones.find((z) => z.zoneId === opts.zoneId) : undefined;
  const spoken = opts.itemText.toLowerCase();

  const rows: CandidateRow[] = [];
  for (const item of catalog.items) {
    let best: { aliasText: string | null; trust: AliasTrust | null; score: number; exact: boolean } = {
      aliasText: null,
      trust: null,
      score: trigramSimilarity(item.canonicalName, opts.itemText),
      exact: false,
    };

    for (const alias of item.aliases) {
      const exact = alias.text.toLowerCase() === spoken;
      const score = exact ? 1 : trigramSimilarity(alias.text, opts.itemText);
      // Exact alias always wins; otherwise highest similarity wins.
      const better = exact ? !best.exact : !best.exact && score > best.score;
      if (better) best = { aliasText: alias.text, trust: alias.trust, score, exact };
    }

    if (!best.exact && best.score <= SIMILARITY_FLOOR) continue;

    rows.push({
      itemId: item.id,
      canonicalName: item.canonicalName,
      sizeMl: item.sizeMl,
      aliasText: best.aliasText,
      aliasTrust: best.trust,
      trgmScore: best.exact ? 1 : best.score,
      exactAlias: best.exact,
      inZone: zone ? zone.itemIds.includes(item.id) : false,
      zoneExpected: zone ? !(zone.unexpectedItemIds ?? []).includes(item.id) : false,
    });
  }

  rows.sort((a, b) => Number(b.exactAlias) - Number(a.exactAlias) || b.trgmScore - a.trgmScore);
  return rows.slice(0, MAX_CANDIDATE_ROWS);
}

/** Candidate generation + ranking: the database-free equivalent of `matchItemPhrase`. */
export function matchItemPhrase(
  catalog: Catalog,
  opts: { itemText: string; zoneId: string | null; sizeMlHint: number | null },
): MatchResult {
  const rows = generateCandidates(catalog, opts);
  const zone = opts.zoneId ? catalog.zones.find((z) => z.zoneId === opts.zoneId) : undefined;
  const zoneHasMembers = (zone?.itemIds.length ?? 0) > 0;
  return rankCandidates(rows, opts.sizeMlHint, { zoneHasMembers });
}
