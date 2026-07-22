import { beforeAll, describe, expect, it } from 'vitest';
import { deepgramProvider } from '@/asr/providers/deepgram';
import { fixtureTransport, transcribe } from '@/asr/transcribe';
import { catalogFromRows } from '@/fixtures/catalog';
import { DEMO_DEEPGRAM_RESPONSE } from '@/fixtures/transcript';
import { buildSyntheticWorkbook } from '@/fixtures/workbook';
import type { Catalog } from '@/matcher/catalog';
import { analyzeWorkbook } from '@/workbook/analyze';
import { importRows } from '@/workbook/import';
import type { NormalizedTranscript } from '@/asr/types';
import { ProposedCountLine, lineAsrConfidences, reconcileTranscript } from '../reconcile';

let catalog: Catalog;
let transcript: NormalizedTranscript;
let lines: ProposedCountLine[];

beforeAll(async () => {
  const workbook = await buildSyntheticWorkbook();
  const analysis = await analyzeWorkbook(workbook);
  const mapping = analysis.proposed.find((m) => m.sheet === 'Liquor')!;
  catalog = await catalogFromRows(await importRows(workbook, mapping));
  transcript = await transcribe({
    provider: deepgramProvider,
    audio: { bytes: new Uint8Array(0), mediaType: 'audio/mp4' },
    seedTerms: [],
    transport: fixtureTransport(DEMO_DEEPGRAM_RESPONSE),
  });
  lines = reconcileTranscript({ transcript, catalog, zoneId: 'back-bar' });
});

const byItem = (name: string) => lines.filter((l) => l.canonicalName === name);

describe('lineAsrConfidences', () => {
  it('falls back to a neutral 0.9 when the transcript has no word detail', () => {
    const out = lineAsrConfidences(
      [{ raw: 'a b', kind: 'count' } as never, { raw: 'c', kind: 'count' } as never],
      [],
    );
    expect(out).toEqual([0.9, 0.9]);
  });

  it('gives each line the mean confidence of its slice of the word stream', () => {
    const out = lineAsrConfidences(
      [{ raw: 'a b' } as never, { raw: 'c d' } as never],
      [
        { text: 'a', start: 0, end: 1, confidence: 0.5 },
        { text: 'b', start: 1, end: 2, confidence: 0.5 },
        { text: 'c', start: 2, end: 3, confidence: 1 },
        { text: 'd', start: 3, end: 4, confidence: 1 },
      ],
    );
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(1);
  });
});

describe('reconcileTranscript (end to end, no I/O)', () => {
  it('produces one proposed line per spoken utterance', () => {
    expect(lines).toHaveLength(11);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const again = reconcileTranscript({ transcript, catalog, zoneId: 'back-bar' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(lines));
  });

  it('resolves a spoken size expression to the right catalogue row', () => {
    const line = lines[0];
    expect(line.itemText).toBe("marlo's");
    expect(line.sizeMlHint).toBe(750);
    expect(line.canonicalName).toBe("Marlo's 750ml");
    expect(line.parsedCount).toBeCloseTo(0.6);
  });

  it('survives the "leader" mishearing of "liter"', () => {
    const line = lines[1];
    expect(line.sizeMlHint).toBe(1000);
    expect(line.canonicalName).toBe('Nordvale Reserve');
    expect(line.parsedCount).toBeCloseTo(1);
  });

  it('keeps a numeric item name out of the count', () => {
    const line = lines[5];
    expect(line.itemText).toBe('harbor one oh seven');
    expect(line.canonicalName).toBe('Harbor 107');
    expect(line.parsedCount).toBeCloseTo(0.4);
  });

  it('routes a directive line to not_here with no count', () => {
    const line = lines[6];
    expect(line.lineKind).toBe('not_here');
    expect(line.parsedCount).toBeNull();
  });

  it('forces review on a user-flagged line', () => {
    const line = lines[7];
    expect(line.reviewReasons).toContain('user_flag');
    expect(line.needsReview).toBe(true);
  });

  it('treats an additive line as an increment, not a new count', () => {
    const line = lines[8];
    expect(line.lineKind).toBe('additive');
    expect(line.canonicalName).toBe("Fowler's Mark 1.75L");
    expect(line.parsedCount).toBeCloseTo(0.2);
    expect(line.reviewReasons).not.toContain('duplicate_possible');
  });

  it('surfaces case counts as needing a pack size and refuses to invent one', () => {
    const line = lines[9];
    expect(line.count).toEqual({ type: 'case', cases: 1, extraEach: 3 });
    expect(line.parsedCount).toBeNull();
    expect(line.reviewReasons).toContain('case_pack_needed');
  });

  it('flags a second count of the same item in the same zone', () => {
    const line = lines[10];
    expect(line.canonicalName).toBe("Wenlock's");
    expect(line.reviewReasons).toContain('duplicate_possible');
    expect(line.needsReview).toBe(true);
  });

  it('flags a repeat of an item counted by an earlier recording', () => {
    const first = byItem("Marlo's 750ml")[0];
    const rerun = reconcileTranscript({
      transcript,
      catalog,
      zoneId: 'back-bar',
      alreadyCountedItemIds: [first.itemId!],
    });
    expect(rerun[0].reviewReasons).toContain('duplicate_possible');
  });

  it('keeps every confidence component inside [0,1]', () => {
    for (const line of lines) {
      for (const v of [
        line.asrConfidence,
        line.itemConfidence,
        line.countConfidence,
        line.zoneConfidence,
        line.overallConfidence,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sends nothing to review that it also auto-fills', () => {
    for (const line of lines) {
      if (line.needsReview) continue;
      expect(line.reviewReasons).not.toContain('no_match');
      expect(line.reviewReasons).not.toContain('user_flag');
    }
  });

  it('never auto-fills a line it could not match to an item', () => {
    const orphan = reconcileTranscript({
      transcript: { ...transcript, text: 'zzzz qqqq point five.' },
      catalog,
      zoneId: 'back-bar',
    });
    expect(orphan[0].itemId).toBeNull();
    expect(orphan[0].needsReview).toBe(true);
    expect(orphan[0].reviewReasons).toContain('no_match');
  });
});
