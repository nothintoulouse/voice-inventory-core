import { beforeAll, describe, expect, it } from 'vitest';
import XlsxPopulate from 'xlsx-populate';
import { analyzeWorkbook, columnLetter } from '../analyze';
import { importRows, looksLikeSectionHeader, parseSizeText } from '../import';
import { patchCounts } from '../export';
import { ColumnMapping } from '../types';
import { buildSyntheticWorkbook } from '@/fixtures/workbook';

let fixture: Uint8Array;
let liquorMapping: ColumnMapping;
let wineMapping: ColumnMapping;

beforeAll(async () => {
  fixture = await buildSyntheticWorkbook();
  const analysis = await analyzeWorkbook(fixture);
  liquorMapping = analysis.proposed.find((m) => m.sheet === 'Liquor')!;
  wineMapping = analysis.proposed.find((m) => m.sheet === 'Wine')!;
});

describe('analyzeWorkbook', () => {
  it('lists every sheet', async () => {
    const analysis = await analyzeWorkbook(fixture);
    expect(analysis.sheets).toEqual(['Liquor', 'Wine']);
    expect(analysis.proposed).toHaveLength(2);
  });

  it('finds the header row below a title row and maps columns by name', () => {
    expect(liquorMapping).toEqual({
      sheet: 'Liquor',
      headerRow: 3,
      nameCol: 'A',
      sizeCol: 'B',
      categoryCol: 'C',
      countCol: 'D',
      firstDataRow: 4,
      lastDataRow: 16,
    });
  });

  it('proposes the first empty column right of name when no count header exists', () => {
    expect(wineMapping).toEqual({
      sheet: 'Wine',
      headerRow: 1,
      nameCol: 'A',
      sizeCol: 'B',
      categoryCol: 'C',
      countCol: 'D',
      firstDataRow: 2,
      lastDataRow: 4,
    });
  });
});

describe('parseSizeText', () => {
  it('parses common bottle-size spellings', () => {
    expect(parseSizeText("Marlo's 750ml")).toBe(750);
    expect(parseSizeText('Nordvale Reserve 1L')).toBe(1000);
    expect(parseSizeText("Fowler's Mark 1.75L")).toBe(1750);
    expect(parseSizeText('House Chardonnay Ltr')).toBe(1000);
    expect(parseSizeText('Bison Creek')).toBeNull();
  });
});

describe('looksLikeSectionHeader', () => {
  it('flags all-caps section rows with no size and no count', () => {
    expect(looksLikeSectionHeader('VODKA', null, null)).toBe(true);
    expect(looksLikeSectionHeader('BOURBON', null, null)).toBe(true);
    expect(looksLikeSectionHeader('Nordvale Reserve', null, null)).toBe(false);
    expect(looksLikeSectionHeader("MARLO'S", 750, null)).toBe(false);
    expect(looksLikeSectionHeader('GIN', null, 3)).toBe(false);
  });
});

describe('importRows', () => {
  it('extracts liquor rows, parsing sizes from name text and skipping section rows', async () => {
    const rows = await importRows(fixture, liquorMapping);
    expect(rows.map((r) => r.name)).toEqual([
      "Marlo's 750ml",
      'Nordvale Reserve',
      "Fowler's Mark 1.75L",
      'Bison Creek',
      'Harbor 107',
      "Wenlock's",
      'Thornbury Dry',
      'Verano Amaro',
      'Solara',
    ]);
    expect(rows.map((r) => r.sizeMl)).toEqual([750, 1000, 1750, 750, 750, 750, 1000, 750, 750]);
    expect(rows.map((r) => r.category)).toEqual([
      'Vodka', 'Vodka', 'Bourbon', 'Bourbon', 'Bourbon', 'Gin', 'Gin', 'Amaro', 'Amaro',
    ]);
    expect(rows.map((r) => r.existingCount)).toEqual([
      2, null, 1.5, null, null, null, null, null, null,
    ]);
    expect(rows[1].sheetRef).toEqual({ sheet: 'Liquor', row: 6, countCol: 'D' });
  });

  it('extracts wine rows with sizes from the size column or name', async () => {
    const rows = await importRows(fixture, wineMapping);
    expect(rows.map((r) => r.name)).toEqual([
      'Halden Cabernet',
      'Bellamonte Prosecco',
      'House Chardonnay Ltr',
    ]);
    expect(rows.map((r) => r.sizeMl)).toEqual([750, 750, 1000]);
    expect(rows.map((r) => r.existingCount)).toEqual([null, null, null]);
    expect(rows[2].sheetRef).toEqual({ sheet: 'Wine', row: 4, countCol: 'D' });
  });
});

describe('patchCounts', () => {
  it('writes counts into the original workbook and touches nothing else', async () => {
    const patched = await patchCounts(fixture, [
      { sheetRef: { sheet: 'Liquor', row: 6, countCol: 'D' }, value: 3.4 },
      { sheetRef: { sheet: 'Liquor', row: 9, countCol: 'D' }, value: 0.5 },
      { sheetRef: { sheet: 'Wine', row: 2, countCol: 'D' }, value: 6 },
    ]);

    const workbook = await XlsxPopulate.fromDataAsync(patched);
    const liquor = workbook.sheet('Liquor')!;
    const wine = workbook.sheet('Wine')!;

    // Patched cells.
    expect(liquor.cell('D6').value()).toBe(3.4);
    expect(liquor.cell('D9').value()).toBe(0.5);
    expect(wine.cell('D2').value()).toBe(6);

    // Formula cell outside the count column survives verbatim.
    expect(liquor.cell('F2').formula()).toBe('SUM(D4:D16)');

    // Header styling and text survive.
    expect(liquor.cell('A3').value()).toBe('Item');
    expect(liquor.cell('A3').style('bold')).toBe(true);
    expect(liquor.cell('D3').style('bold')).toBe(true);

    // Untouched values survive: title, existing counts, section rows, sizes.
    expect(liquor.cell('A1').value()).toBe('Back Bar Inventory');
    expect(liquor.cell('D5').value()).toBe(2);
    expect(liquor.cell('D8').value()).toBe(1.5);
    expect(liquor.cell('A4').value()).toBe('VODKA');
    expect(liquor.cell('A11').value()).toBe('GIN');
    expect(liquor.cell('B6').value()).toBe('1L');
    expect(wine.cell('B3').value()).toBe(750);
    expect(wine.cell('C4').value()).toBe('White');
  });

  it('throws on an unknown sheet', async () => {
    await expect(
      patchCounts(fixture, [{ sheetRef: { sheet: 'Beer', row: 2, countCol: 'D' }, value: 1 }]),
    ).rejects.toThrow('Beer');
  });
});

describe('columnLetter', () => {
  it('converts column numbers to letters', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(52)).toBe('AZ');
  });
});
