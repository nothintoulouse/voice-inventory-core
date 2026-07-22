import { describe, expect, it } from 'vitest';
import { ConfidenceComponents, needsReview, overallConfidence, reviewReasons } from '../confidence';

const clean: ConfidenceComponents = {
  asr: 0.95,
  productMatch: 1.0,
  aliasTrust: 1.0,
  zonePrior: 1.0,
  countParse: 1.0,
  sanity: 0.5,
  ambiguous: false,
  userFlagged: false,
};

describe('overallConfidence', () => {
  it('clean exact-alias in-zone line auto-fills (≥0.90)', () => {
    expect(overallConfidence(clean)).toBeGreaterThanOrEqual(0.9);
  });

  it('ambiguity penalty drops into review band', () => {
    const overall = overallConfidence({ ...clean, productMatch: 0.7, ambiguous: true });
    expect(overall).toBeLessThan(0.75);
  });

  it('user flag forces a large drop', () => {
    expect(overallConfidence({ ...clean, userFlagged: true })).toBeLessThan(
      overallConfidence(clean) - 0.25,
    );
  });
});

describe('needsReview / reviewReasons', () => {
  it('clean line needs no review', () => {
    const reasons = reviewReasons({
      components: clean, lineFlags: [], hasMatch: true, isNewItem: false,
    });
    expect(reasons).toEqual([]);
    expect(needsReview(overallConfidence(clean), reasons)).toBe(false);
  });

  it('no match always reviews', () => {
    const reasons = reviewReasons({
      components: clean, lineFlags: [], hasMatch: false, isNewItem: false,
    });
    expect(reasons).toContain('no_match');
    expect(needsReview(0.95, reasons)).toBe(true);
  });

  it('unexpected item in zone is reported', () => {
    const reasons = reviewReasons({
      components: { ...clean, zonePrior: 0.3 },
      lineFlags: [], hasMatch: true, isNewItem: false,
    });
    expect(reasons).toContain('unexpected_item_in_zone');
  });
});
