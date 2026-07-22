/**
 * Offline synthetic demonstration of the whole pipeline.
 *
 *   npm run demo
 *
 * No API key. No network call. No database. No real inventory data.
 * Every number printed below is reproducible on any machine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import XlsxPopulate from 'xlsx-populate';

import { deepgramProvider } from '@/asr/providers/deepgram';
import { fixtureTransport, transcribe } from '@/asr/transcribe';
import { catalogFromRows } from '@/fixtures/catalog';
import { DEMO_DEEPGRAM_RESPONSE } from '@/fixtures/transcript';
import { buildSyntheticWorkbook } from '@/fixtures/workbook';
import { reconcileTranscript } from '@/pipeline/reconcile';
import { analyzeWorkbook } from '@/workbook/analyze';
import { patchCounts } from '@/workbook/export';
import { importRows } from '@/workbook/import';
import type { ImportedRow } from '@/workbook/types';

const OUT_DIR = resolve(process.cwd(), 'demo-output');

function rule(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m\n${'─'.repeat(72)}`);
}

function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

async function main(): Promise<void> {
  rule('1. Synthetic workbook (generated in memory, invented product names)');
  const original = await buildSyntheticWorkbook();
  const analysis = await analyzeWorkbook(original);
  const mapping = analysis.proposed.find((m) => m.sheet === 'Liquor')!;
  console.log(`sheets: ${analysis.sheets.join(', ')}`);
  console.log(
    `proposed mapping for "Liquor": header row ${mapping.headerRow}, ` +
      `name=${mapping.nameCol} size=${mapping.sizeCol} category=${mapping.categoryCol} ` +
      `count=${mapping.countCol}, rows ${mapping.firstDataRow}–${mapping.lastDataRow}`,
  );

  const rows: ImportedRow[] = await importRows(original, mapping);
  console.log(`imported ${rows.length} item rows (section headers dropped)`);

  rule('2. Catalogue + spoken aliases (deterministic; LLM enrichment stubbed)');
  const catalog = await catalogFromRows(rows);
  for (const item of catalog.items.slice(0, 4)) {
    console.log(`  ${pad(item.canonicalName, 24)} → ${item.aliases.map((a) => a.text).join(', ')}`);
  }
  console.log(`  … ${catalog.items.length} items total`);

  rule('3. PROBABILISTIC boundary: ASR (mocked provider response, no network)');
  const transcript = await transcribe({
    provider: deepgramProvider,
    audio: { bytes: new Uint8Array(0), mediaType: 'audio/mp4' },
    seedTerms: catalog.items.flatMap((i) => [i.canonicalName, ...i.aliases.map((a) => a.text)]),
    transport: fixtureTransport(DEMO_DEEPGRAM_RESPONSE),
  });
  console.log(`provider: ${transcript.provider}  seed terms sent: ${transcript.seedTermCount}`);
  console.log(`words: ${transcript.words.length}`);
  console.log(`\n  "${transcript.text}"`);
  console.log(
    '\n  ↑ everything above this line is a guess made by an acoustic model.\n' +
      '    everything below this line is deterministic and unit-tested.',
  );

  rule('4. DETERMINISTIC boundary: grammar → matching → confidence');
  const lines = reconcileTranscript({
    transcript,
    catalog,
    zoneId: 'back-bar',
  });

  console.log(
    `${pad('spoken', 34)}${pad('item', 22)}${pad('count', 8)}${pad('conf', 6)}status`,
  );
  console.log('─'.repeat(72));
  for (const line of lines) {
    const count =
      line.count === null
        ? '—'
        : line.count.type === 'each'
          ? String(line.count.value)
          : `${line.count.cases}cs+${line.count.extraEach}`;
    const notes = line.reviewReasons.length > 0 ? ` (${line.reviewReasons.join(', ')})` : '';
    const status = `${line.needsReview ? 'REVIEW' : 'auto-fill'}${notes}`;
    console.log(
      pad(line.spokenText, 34) +
        pad(line.canonicalName ?? '—', 22) +
        pad(count, 8) +
        pad(line.overallConfidence.toFixed(2), 6) +
        status,
    );
  }

  const auto = lines.filter((l) => !l.needsReview);
  const review = lines.filter((l) => l.needsReview);
  console.log(
    `\n${auto.length}/${lines.length} auto-filled, ${review.length} sent to human review`,
  );

  rule('5. Determinism check');
  const again = reconcileTranscript({ transcript, catalog, zoneId: 'back-bar' });
  const identical = JSON.stringify(lines) === JSON.stringify(again);
  console.log(`re-running the deterministic half on the same transcript: ${
    identical ? 'byte-identical ✓' : 'DIVERGED ✗'
  }`);
  if (!identical) process.exitCode = 1;

  rule('6. Patch-in-place export');
  const rowByItemId = new Map(rows.map((r) => [`${r.sheetRef.sheet}!${r.sheetRef.row}`, r]));
  const totals = new Map<string, number>();
  for (const line of auto) {
    if (line.itemId === null || line.parsedCount === null) continue;
    if (line.lineKind === 'count') totals.set(line.itemId, line.parsedCount);
    else if (line.lineKind === 'additive') {
      totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.parsedCount);
    }
  }
  // Counts are stored to 3 decimal places; round away binary-float artefacts.
  for (const [id, v] of totals) totals.set(id, Number(v.toFixed(3)));

  const patches = [...totals].map(([itemId, value]) => ({
    sheetRef: rowByItemId.get(itemId)!.sheetRef,
    value,
  }));
  const patched = await patchCounts(original, patches);

  const check = await XlsxPopulate.fromDataAsync(patched);
  const sheet = check.sheet('Liquor')!;
  for (const [itemId, value] of totals) {
    const row = rowByItemId.get(itemId)!;
    const readBack = sheet.cell(row.sheetRef.row, row.sheetRef.countCol).value();
    console.log(
      `  ${pad(row.name, 24)} ${row.sheetRef.countCol}${row.sheetRef.row} = ${readBack}` +
        `${readBack === value ? ' ✓' : ` ✗ expected ${value}`}`,
    );
    if (readBack !== value) process.exitCode = 1;
  }

  const formulaSurvived = sheet.cell('F2').formula() === 'SUM(D4:D16)';
  const titleSurvived = sheet.cell('A1').value() === 'Back Bar Inventory';
  const boldSurvived = sheet.cell('A3').style('bold') === true;
  // A row nobody spoke about: its pre-existing count must be left alone.
  const untouchedCount = sheet.cell('D15').value() === undefined;
  const sectionRowIntact = sheet.cell('A11').value() === 'GIN';
  console.log(
    `\n  formula F2 intact: ${formulaSurvived ? '✓' : '✗'}` +
      `   title intact: ${titleSurvived ? '✓' : '✗'}` +
      `   bold header intact: ${boldSurvived ? '✓' : '✗'}` +
      `   uncounted row untouched: ${untouchedCount ? '✓' : '✗'}` +
      `   section row intact: ${sectionRowIntact ? '✓' : '✗'}`,
  );
  if (!formulaSurvived || !titleSurvived || !boldSurvived || !untouchedCount || !sectionRowIntact) {
    process.exitCode = 1;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, 'counted.xlsx');
  writeFileSync(outPath, patched);
  console.log(`\n  wrote ${outPath}`);
  console.log('\nDone. No network call, no credential, no real data was used.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
