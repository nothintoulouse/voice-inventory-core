import { describe, expect, it } from 'vitest';
import { generateAliases } from '../generate';
import { enrichAliases, nullEnricher, stubEnricher } from '../enrich';

describe('generateAliases', () => {
  it('strips the size and keeps the bare name', () => {
    expect(generateAliases("Marlo's 750ml")).toContain("marlo's");
  });

  it('adds an apostrophe-free variant', () => {
    expect(generateAliases("Marlo's 750ml")).toContain('marlos');
  });

  it('adds a spoken form for numeric name parts', () => {
    expect(generateAliases('Harbor 107')).toContain('harbor one oh seven');
  });

  it('adds the leading word and the leading pair', () => {
    const aliases = generateAliases("Fowler's Mark 1.75L");
    expect(aliases).toContain("fowler's");
    expect(aliases).toContain("fowler's mark");
  });

  it('never repeats the canonical name itself', () => {
    expect(generateAliases('Bison Creek')).not.toContain('bison creek');
  });

  it('drops noise words', () => {
    expect(generateAliases('The House Chardonnay')).not.toContain('the');
  });

  it('returns no aliases it cannot justify', () => {
    expect(generateAliases('Gin')).toEqual([]);
  });
});

describe('enrichAliases', () => {
  it('batches names and merges results', async () => {
    const seen: string[][] = [];
    const spy = async (names: string[]) => {
      seen.push(names);
      return new Map(names.map((n) => [n, [`${n.toLowerCase()}-x`]]));
    };
    const out = await enrichAliases(['a', 'b', 'c', 'd', 'e'], spy, 2);
    expect(seen.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(out.size).toBe(5);
  });

  it('contains a failing batch instead of failing the import', async () => {
    let call = 0;
    const flaky = async (names: string[]) => {
      call++;
      if (call === 1) throw new Error('rate limited');
      return new Map(names.map((n) => [n, ['ok']]));
    };
    const out = await enrichAliases(['a', 'b', 'c', 'd'], flaky, 2);
    expect(out.has('a')).toBe(false);
    expect(out.get('c')).toEqual(['ok']);
  });

  it('ignores names the enricher invented that were not asked for', async () => {
    const liar = async () => new Map([['not-in-batch', ['nope']]]);
    const out = await enrichAliases(['a'], liar, 10);
    expect(out.size).toBe(0);
  });

  it('nullEnricher yields nothing and never throws', async () => {
    expect((await enrichAliases(['a', 'b'], nullEnricher)).size).toBe(0);
  });

  it('stubEnricher drops size tokens from spoken forms', async () => {
    const out = await enrichAliases(["Fowler's Mark 1.75L"], stubEnricher);
    const aliases = out.get("Fowler's Mark 1.75L") ?? [];
    expect(aliases).toContain("fowler's");
    expect(aliases.some((a) => /\d/.test(a))).toBe(false);
  });
});
