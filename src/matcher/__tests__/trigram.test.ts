import { describe, expect, it } from 'vitest';
import { trigramSimilarity, trigrams } from '../trigram';

describe('trigrams', () => {
  it('pads each word with two leading blanks and one trailing blank', () => {
    expect([...trigrams('word')].sort()).toEqual(['  w', ' wo', 'ord', 'rd ', 'wor']);
  });

  it('treats non-alphanumerics as word separators', () => {
    expect(trigrams("fowler's")).toEqual(trigrams('fowler s'));
  });

  it('is case-insensitive', () => {
    expect(trigrams('Harbor')).toEqual(trigrams('harbor'));
  });

  it('returns an empty set for input with no alphanumerics', () => {
    expect(trigrams('   -- ').size).toBe(0);
  });
});

describe('trigramSimilarity', () => {
  it('scores identical strings at 1', () => {
    expect(trigramSimilarity('nordvale reserve', 'nordvale reserve')).toBe(1);
  });

  it('scores disjoint strings at 0', () => {
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('is symmetric', () => {
    const a = trigramSimilarity('thornbury dry', 'thornberry dry');
    const b = trigramSimilarity('thornberry dry', 'thornbury dry');
    expect(a).toBe(b);
  });

  it('ranks a near-miss above an unrelated name', () => {
    const near = trigramSimilarity("wenlock's", 'wenlocks');
    const far = trigramSimilarity("wenlock's", 'bison creek');
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.5);
  });

  it('scores a substring below an exact match', () => {
    expect(trigramSimilarity('fowler', "fowler's mark")).toBeLessThan(1);
    expect(trigramSimilarity('fowler', "fowler's mark")).toBeGreaterThan(0.25);
  });

  it('handles empty input without dividing by zero', () => {
    expect(trigramSimilarity('', '')).toBe(0);
    expect(trigramSimilarity('', 'harbor')).toBe(0);
  });
});
