import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokens';
import { GrammarConfig, defaultGrammarConfig, parseCountExpr } from '../count-expr';

const parse = (text: string, config: GrammarConfig = defaultGrammarConfig) =>
  parseCountExpr(tokenize(text), config);

const each = (text: string, config?: GrammarConfig) => {
  const p = parse(text, config);
  expect(p, `"${text}" should parse`).not.toBeNull();
  expect(p!.count.type).toBe('each');
  return { value: (p!.count as { value: number }).value, flags: p!.flags };
};

describe('simple counts (grammar table)', () => {
  it.each([
    ['full', 1.0],
    ['empty', 0.0],
    ['point five', 0.5],
    ['zero point five', 0.5],
    ['five tenths', 0.5],
    ['half', 0.5],
    ['quarter', 0.25],
    ['three quarters', 0.75],
    ['two full', 2.0],
    ['point six', 0.6],
    ['0.6', 0.6],
    ['1.4', 1.4],
    ['point three', 0.3],
    ['one point seven five', 1.75],
  ])('"%s" → %d', (text, value) => {
    expect(each(text).value, text).toBeCloseTo(value);
  });
});

describe('compound counts', () => {
  it('"one full and point four" → 1.4, unambiguous', () => {
    const r = each('one full and point four');
    expect(r.value).toBeCloseTo(1.4);
    expect(r.flags).not.toContain('ambiguous_compound');
  });

  it('"one and point four" → 1.4', () => {
    expect(each('one and point four').value).toBeCloseTo(1.4);
  });

  it('"one full and one point four" default (flag): literal 2.4 + ambiguous flag', () => {
    const r = each('one full and one point four');
    expect(r.value).toBeCloseTo(2.4);
    expect(r.flags).toContain('ambiguous_compound');
  });

  it('"one full and one point four" reinterpret convention → 1.4', () => {
    const r = each('one full and one point four', { ...defaultGrammarConfig, compoundConvention: 'reinterpret' });
    expect(r.value).toBeCloseTo(1.4);
    expect(r.flags).not.toContain('ambiguous_compound');
  });

  it('"one full and one point four" literal convention → 2.4, no flag', () => {
    const r = each('one full and one point four', { ...defaultGrammarConfig, compoundConvention: 'literal' });
    expect(r.value).toBeCloseTo(2.4);
    expect(r.flags).not.toContain('ambiguous_compound');
  });
});

describe('case counts', () => {
  it('"case plus three" → 1 case + 3 each, pack size needed', () => {
    const p = parse('case plus three')!;
    expect(p.count).toEqual({ type: 'case', cases: 1, extraEach: 3 });
    expect(p.flags).toContain('case_pack_needed');
  });

  it('"two cases plus three" → 2 cases + 3', () => {
    const p = parse('two cases plus three')!;
    expect(p.count).toEqual({ type: 'case', cases: 2, extraEach: 3 });
  });

  it('"case" alone → 1 case', () => {
    const p = parse('case')!;
    expect(p.count).toEqual({ type: 'case', cases: 1, extraEach: 0 });
  });
});

describe('config: quarters', () => {
  it('flags quarters when disabled', () => {
    const r = each('three quarters', { ...defaultGrammarConfig, quarters: false });
    expect(r.flags).toContain('quarters_disabled');
  });
});

describe('rejections', () => {
  it.each(['nordvale reserve', 'liter', 'not here', 'harbor one oh seven point'])(
    'rejects "%s"',
    (text) => {
      expect(parse(text)).toBeNull();
    },
  );

  it('flags implausible counts', () => {
    const r = each('seven fifty');
    expect(r.flags).toContain('implausible_count');
  });
});
