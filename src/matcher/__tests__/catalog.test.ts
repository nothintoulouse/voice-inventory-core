import { describe, expect, it } from 'vitest';
import { Catalog, generateCandidates, matchItemPhrase } from '../catalog';

const catalog: Catalog = {
  items: [
    {
      id: 'fowlers-750',
      canonicalName: "Fowler's Mark 750mL",
      sizeMl: 750,
      aliases: [
        { text: "fowler's mark", trust: 'approved' },
        { text: 'fowlers', trust: 'generated' },
      ],
    },
    {
      id: 'fowlers-1750',
      canonicalName: "Fowler's Mark 1.75L",
      sizeMl: 1750,
      aliases: [{ text: "fowler's mark", trust: 'approved' }],
    },
    {
      id: 'harbor-107',
      canonicalName: 'Harbor 107',
      sizeMl: 750,
      aliases: [{ text: 'harbor one oh seven', trust: 'generated' }],
    },
    {
      id: 'bison-creek',
      canonicalName: 'Bison Creek',
      sizeMl: 750,
      aliases: [],
    },
  ],
  zones: [{ zoneId: 'back-bar', itemIds: ['fowlers-750', 'harbor-107', 'bison-creek'] }],
};

describe('generateCandidates', () => {
  it('marks an exact alias hit and scores it 1', () => {
    const rows = generateCandidates(catalog, { itemText: 'harbor one oh seven', zoneId: null });
    const hit = rows.find((r) => r.itemId === 'harbor-107')!;
    expect(hit.exactAlias).toBe(true);
    expect(hit.trgmScore).toBe(1);
    expect(hit.aliasTrust).toBe('generated');
  });

  it('falls back to canonical-name similarity when no alias is close', () => {
    const rows = generateCandidates(catalog, { itemText: 'bison creek', zoneId: null });
    const hit = rows.find((r) => r.itemId === 'bison-creek')!;
    expect(hit.aliasText).toBeNull();
    expect(hit.trgmScore).toBe(1);
  });

  it('drops items below the similarity floor', () => {
    const rows = generateCandidates(catalog, { itemText: 'zzzz qqqq', zoneId: null });
    expect(rows).toEqual([]);
  });

  it('reports zone membership', () => {
    const rows = generateCandidates(catalog, { itemText: "fowler's mark", zoneId: 'back-bar' });
    expect(rows.find((r) => r.itemId === 'fowlers-750')!.inZone).toBe(true);
    expect(rows.find((r) => r.itemId === 'fowlers-1750')!.inZone).toBe(false);
  });

  it('returns exact-alias rows before fuzzy rows', () => {
    const rows = generateCandidates(catalog, { itemText: "fowler's mark", zoneId: null });
    expect(rows[0].exactAlias).toBe(true);
  });
});

describe('matchItemPhrase', () => {
  it('uses the zone prior to break a tie between identical aliases', () => {
    const result = matchItemPhrase(catalog, {
      itemText: "fowler's mark",
      zoneId: 'back-bar',
      sizeMlHint: null,
    });
    expect(result.candidates[0].itemId).toBe('fowlers-750');
  });

  it('a contradicting size hint does not overturn the zone prior, but does force review', () => {
    // Zone prior spread (0.30 × [1.0 → 0.3] = 0.21) narrowly exceeds the size
    // spread (+0.05 → −0.15 = 0.20), so the in-zone 750 stays on top — but the
    // gap collapses to ~0.01 and the ambiguity window catches it. Documenting
    // the real behaviour rather than the behaviour one might assume.
    const result = matchItemPhrase(catalog, {
      itemText: "fowler's mark",
      zoneId: 'back-bar',
      sizeMlHint: 1750,
    });
    expect(result.candidates.map((c) => c.itemId)).toContain('fowlers-1750');
    expect(result.candidates[0].score - result.candidates[1].score).toBeLessThan(0.05);
    expect(result.ambiguous).toBe(true);
  });

  it('flags ambiguity when the top two are within the window', () => {
    const result = matchItemPhrase(catalog, {
      itemText: "fowler's mark",
      zoneId: null,
      sizeMlHint: null,
    });
    expect(result.ambiguous).toBe(true);
  });

  it('returns no candidates for an unmatchable phrase', () => {
    const result = matchItemPhrase(catalog, {
      itemText: 'qqqq zzzz',
      zoneId: 'back-bar',
      sizeMlHint: null,
    });
    expect(result.candidates).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });
});
