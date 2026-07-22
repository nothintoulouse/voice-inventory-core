import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../score';

describe('rankCandidates', () => {
  const base = {
    sizeMl: 750,
    aliasText: 'fowlers',
    aliasTrust: 'approved' as const,
    trgmScore: 0.9,
    exactAlias: true,
    inZone: true,
    zoneExpected: true,
  };

  it('flags ambiguity when two Fowlers SKUs are close (review category: ambiguous product)', () => {
    const result = rankCandidates(
      [
        { ...base, itemId: 'a', canonicalName: "Fowler's Mark 750mL" },
        { ...base, itemId: 'b', canonicalName: "Fowler's Mark 46 750mL", exactAlias: false, trgmScore: 0.85 },
      ],
      null,
    );
    expect(result.ambiguous).toBe(true);
    expect(result.candidates[0].itemId).toBe('a');
  });

  it('size hint disagreement separates same-name different-size items', () => {
    const result = rankCandidates(
      [
        { ...base, itemId: 'liter', canonicalName: "Marlo's 1L", sizeMl: 1000, exactAlias: false, trgmScore: 0.9 },
        { ...base, itemId: '750', canonicalName: "Marlo's 750mL", sizeMl: 750, exactAlias: false, trgmScore: 0.9 },
      ],
      1000,
    );
    expect(result.candidates[0].itemId).toBe('liter');
    expect(result.ambiguous).toBe(false);
  });

  it('zone membership breaks near-ties toward the expected item', () => {
    const result = rankCandidates(
      [
        { ...base, itemId: 'out', canonicalName: 'Out of zone', inZone: false, zoneExpected: false, exactAlias: false, trgmScore: 0.8 },
        { ...base, itemId: 'in', canonicalName: 'In zone', exactAlias: false, trgmScore: 0.8 },
      ],
      null,
    );
    expect(result.candidates[0].itemId).toBe('in');
  });
});
