import { describe, expect, it } from 'vitest';
import { parseLine } from '../parse';
import { parseTranscript } from '../index';

const eachValue = (line: ReturnType<typeof parseLine>) => {
  expect(line.count?.type).toBe('each');
  return (line.count as { value: number }).value;
};

describe('parseLine: spoken example lines', () => {
  it("marlo's liter point six", () => {
    const l = parseLine("marlo's liter point six");
    expect(l.kind).toBe('count');
    expect(l.itemText).toBe("marlo's");
    expect(l.sizeMlHint).toBe(1000);
    expect(eachValue(l)).toBeCloseTo(0.6);
  });

  it('nordvale reserve seven fifty full', () => {
    const l = parseLine('nordvale reserve seven fifty full');
    expect(l.itemText).toBe('nordvale reserve');
    expect(l.sizeMlHint).toBe(750);
    expect(eachValue(l)).toBeCloseTo(1.0);
  });

  it('thornbury dry point three', () => {
    const l = parseLine('thornbury dry point three');
    expect(l.itemText).toBe('thornbury dry');
    expect(l.sizeMlHint).toBeNull();
    expect(eachValue(l)).toBeCloseTo(0.3);
  });

  it("wenlock's half", () => {
    const l = parseLine("wenlock's half");
    expect(l.itemText).toBe("wenlock's");
    expect(eachValue(l)).toBeCloseTo(0.5);
  });

  it('halloran liter one full and point four', () => {
    const l = parseLine('halloran liter one full and point four');
    expect(l.itemText).toBe('halloran');
    expect(l.sizeMlHint).toBe(1000);
    expect(eachValue(l)).toBeCloseTo(1.4);
    expect(l.flags).not.toContain('ambiguous_compound');
  });

  it('solara not here', () => {
    const l = parseLine('solara not here');
    expect(l.kind).toBe('not_here');
    expect(l.itemText).toBe('solara');
  });

  it("fowler's point four flag this → user_flag", () => {
    const l = parseLine("fowler's point four flag this");
    expect(l.itemText).toBe("fowler's");
    expect(eachValue(l)).toBeCloseTo(0.4);
    expect(l.flags).toContain('user_flag');
  });
});

describe('parseLine: additive grammar', () => {
  it("plus point four fowler's → additive +0.4", () => {
    const l = parseLine("plus point four fowler's");
    expect(l.kind).toBe('additive');
    expect(l.itemText).toBe("fowler's");
    expect(eachValue(l)).toBeCloseTo(0.4);
  });

  it("add a bottle of marlo's → additive +1", () => {
    const l = parseLine("add a bottle of marlo's");
    expect(l.kind).toBe('additive');
    expect(l.itemText).toBe("marlo's");
    expect(eachValue(l)).toBeCloseTo(1);
  });

  it('fowlers plus point four → trailing additive', () => {
    const l = parseLine('fowlers plus point four');
    expect(l.kind).toBe('additive');
    expect(l.itemText).toBe('fowlers');
    expect(eachValue(l)).toBeCloseTo(0.4);
  });

  it('add two full nordvale reserve → additive +2', () => {
    const l = parseLine('add two full nordvale reserve');
    expect(l.kind).toBe('additive');
    expect(l.itemText).toBe('nordvale reserve');
    expect(eachValue(l)).toBeCloseTo(2);
  });

  it('is NOT confused with case counts ("case plus three" stays a count)', () => {
    const l = parseLine('sunspire case plus three');
    expect(l.kind).toBe('count');
    expect(l.itemText).toBe('sunspire');
    expect(l.count).toEqual({ type: 'case', cases: 1, extraEach: 3 });
  });
});

describe('parseLine: numeric item names and size/count ambiguity', () => {
  it('harbor one oh seven point four → item keeps "one oh seven"', () => {
    const l = parseLine('harbor one oh seven point four');
    expect(l.itemText).toBe('harbor one oh seven');
    expect(eachValue(l)).toBeCloseTo(0.4);
  });

  it('anthem 107 point four → item "anthem 107"', () => {
    const l = parseLine('anthem 107 point four');
    expect(l.itemText).toBe('anthem 107');
    expect(eachValue(l)).toBeCloseTo(0.4);
  });

  it('halloran one point seven five point five → 1.75L size, 0.5 count', () => {
    const l = parseLine('halloran one point seven five point five');
    expect(l.itemText).toBe('halloran');
    expect(l.sizeMlHint).toBe(1750);
    expect(eachValue(l)).toBeCloseTo(0.5);
  });

  it('halloran 1.75 0.5 (smart-formatted ASR) → same result', () => {
    const l = parseLine('halloran 1.75 0.5');
    expect(l.itemText).toBe('halloran');
    expect(l.sizeMlHint).toBe(1750);
    expect(eachValue(l)).toBeCloseTo(0.5);
  });

  it('seventeen fifty size: "halloran seventeen fifty half" → 1750 mL, 0.5', () => {
    const l = parseLine('halloran seventeen fifty half');
    expect(l.itemText).toBe('halloran');
    expect(l.sizeMlHint).toBe(1750);
    expect(eachValue(l)).toBeCloseTo(0.5);
  });
});

describe('parseLine: directives and degenerate input', () => {
  it('skip alone', () => {
    const l = parseLine('skip');
    expect(l.kind).toBe('skip');
    expect(l.itemText).toBeNull();
  });

  it('new item prefix', () => {
    const l = parseLine('new item verdant abbey point eight');
    expect(l.kind).toBe('new_item');
    expect(l.itemText).toBe('verdant abbey');
    expect(eachValue(l)).toBeCloseTo(0.8);
  });

  it('no count found → unparsed with low confidence', () => {
    const l = parseLine('nordvale reserve');
    expect(l.kind).toBe('unparsed');
    expect(l.flags).toContain('no_count');
    expect(l.parseConfidence).toBeLessThan(0.5);
  });

  it('bare count with no item → flagged', () => {
    const l = parseLine('point five');
    expect(l.flags).toContain('no_item');
  });
});

describe('parseTranscript: segmentation end-to-end', () => {
  it('splits punctuated transcript (worked example)', () => {
    const lines = parseTranscript(
      "Marlo's liter point six. Nordvale Reserve seven fifty full. Thornbury Dry point three. " +
      "Wenlock's half. Halloran liter one full and point four. Fowler's point four, flag this. Solara not here.",
    );
    expect(lines.map((l) => l.kind)).toEqual([
      'count', 'count', 'count', 'count', 'count', 'count', 'not_here',
    ]);
    expect(lines[5].flags).toContain('user_flag');
  });

  it('splits run-on unpunctuated transcript', () => {
    const lines = parseTranscript(
      "marlo's liter point six nordvale reserve seven fifty full wenlock's half",
    );
    expect(lines).toHaveLength(3);
    expect(lines[0].itemText).toBe("marlo's");
    expect(lines[1].itemText).toBe('nordvale reserve');
    expect(lines[1].sizeMlHint).toBe(750);
    expect(lines[2].itemText).toBe("wenlock's");
  });

  it('does not split inside numeric item names', () => {
    const lines = parseTranscript('harbor one oh seven point four ferrow rye point six');
    expect(lines).toHaveLength(2);
    expect(lines[0].itemText).toBe('harbor one oh seven');
    expect(lines[1].itemText).toBe('ferrow rye');
  });

  it('keeps additive lines separate in run-on speech', () => {
    const lines = parseTranscript("fowlers point four plus point two fowlers");
    expect(lines).toHaveLength(2);
    expect(lines[0].kind).toBe('count');
    expect(lines[1].kind).toBe('additive');
    expect(lines[1].itemText).toBe('fowlers');
  });
});

describe('patterns observed in the first end-to-end synthetic run', () => {
  it('"marlos leader 0.6" → liter mishearing handled', () => {
    const l = parseLine('marlos leader 0.6');
    expect(l.itemText).toBe('marlos');
    expect(l.sizeMlHint).toBe(1000);
    expect(eachValue(l)).toBeCloseTo(0.6);
  });

  it('"nordvail reserve 7 50 full" → digit-pair size 750', () => {
    const l = parseLine('nordvail reserve 7 50 full');
    expect(l.itemText).toBe('nordvail reserve');
    expect(l.sizeMlHint).toBe(750);
    expect(eachValue(l)).toBeCloseTo(1.0);
  });

  it('directive does not swallow the preceding line', () => {
    const lines = parseTranscript('harbor 1 0 7.8 solara not here');
    expect(lines).toHaveLength(2);
    expect(lines[1].kind).toBe('not_here');
    expect(lines[1].itemText).toBe('solara');
  });
});
