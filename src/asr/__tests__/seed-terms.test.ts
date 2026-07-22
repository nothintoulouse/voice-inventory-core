import { describe, expect, it } from 'vitest';
import { prepareSeedTerms } from '../seed-terms';

describe('cleaning (both providers)', () => {
  it('trims and collapses internal whitespace', () => {
    expect(prepareSeedTerms(['  Fowler’s   Mark  '], 'assemblyai')).toEqual(['Fowler’s Mark']);
  });

  it('drops empty and whitespace-only terms', () => {
    expect(prepareSeedTerms(['', '   ', '\t', 'Marlo’s'], 'deepgram')).toEqual(['Marlo’s']);
  });

  it('dedupes case-insensitively, first occurrence wins', () => {
    expect(prepareSeedTerms(['Verano Amaro', 'verano amaro', 'VERANO AMARO'], 'assemblyai'))
      .toEqual(['Verano Amaro']);
  });

  it('treats whitespace-collapsed variants as duplicates', () => {
    expect(prepareSeedTerms(['Nordvale Reserve', ' nordvale   reserve '], 'deepgram')).toEqual(['Nordvale Reserve']);
  });

  it('preserves input (priority) order', () => {
    expect(prepareSeedTerms(['c', 'a', 'b'], 'assemblyai')).toEqual(['c', 'a', 'b']);
  });
});

describe('assemblyai caps', () => {
  it('drops terms longer than 6 words, keeps 6-word terms', () => {
    const six = 'one two three four five six';
    const seven = 'one two three four five six seven';
    expect(prepareSeedTerms([seven, six, 'Rubino'], 'assemblyai')).toEqual([six, 'Rubino']);
  });

  it('caps at 1000 terms, keeping the highest-priority (earliest) ones', () => {
    const terms = Array.from({ length: 1200 }, (_, i) => `term${i}`);
    const result = prepareSeedTerms(terms, 'assemblyai');
    expect(result).toHaveLength(1000);
    expect(result[0]).toBe('term0');
    expect(result[999]).toBe('term999');
  });

  it('applies the word filter before the term cap', () => {
    const long = 'a b c d e f g';
    const terms = [long, ...Array.from({ length: 1000 }, (_, i) => `term${i}`)];
    const result = prepareSeedTerms(terms, 'assemblyai');
    expect(result).toHaveLength(1000);
    expect(result).not.toContain(long);
    expect(result[999]).toBe('term999');
  });
});

describe('deepgram word budget', () => {
  it('counts multi-word terms against the 500-word budget', () => {
    // 250 two-word terms exhaust the budget exactly; the 251st is dropped.
    const terms = Array.from({ length: 251 }, (_, i) => `brand ${i}`);
    const result = prepareSeedTerms(terms, 'deepgram');
    expect(result).toHaveLength(250);
    expect(result[249]).toBe('brand 249');
  });

  it('takes exactly 500 single-word terms', () => {
    const terms = Array.from({ length: 600 }, (_, i) => `w${i}`);
    const result = prepareSeedTerms(terms, 'deepgram');
    expect(result).toHaveLength(500);
    expect(result[499]).toBe('w499');
  });

  it('skips a term that overflows the budget but keeps later ones that fit', () => {
    const filler = Array.from({ length: 499 }, (_, i) => `w${i}`);
    const result = prepareSeedTerms([...filler, 'two words', 'last'], 'deepgram');
    expect(result).toHaveLength(500);
    expect(result).not.toContain('two words');
    expect(result[499]).toBe('last');
  });

  it('passes small lists through untouched', () => {
    expect(prepareSeedTerms(['Aronda', 'Peverell’s'], 'deepgram'))
      .toEqual(['Aronda', 'Peverell’s']);
  });
});
