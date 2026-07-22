import XlsxPopulate, { Sheet } from 'xlsx-populate';
import { ColumnMapping, WorkbookAnalysis } from './types';

const HEADER_SCAN_ROWS = 10;

type MappedField = 'name' | 'size' | 'category' | 'count';

/**
 * Header-name heuristics, in assignment priority order. Each field claims
 * the leftmost matching header cell that no earlier field has taken.
 */
const FIELD_PATTERNS: { field: MappedField; re: RegExp }[] = [
  { field: 'name', re: /\b(name|item|product|description)\b/ },
  { field: 'size', re: /\b(size|ml|vol|volume)\b/ },
  { field: 'category', re: /\b(category|type|class)\b/ },
  { field: 'count', re: /\b(count|qty|quantity|on hand|inventory|total)\b/ },
];

/** 1-based column number → Excel letter ("A", "AA"). */
export function columnLetter(n: number): string {
  let name = '';
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function isFilled(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function headerText(sheet: Sheet, row: number, col: number): string | null {
  const value = sheet.cell(row, col).value();
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim().toLowerCase();
}

/**
 * Scans a workbook and proposes a column mapping per sheet, for user
 * confirmation in the import wizard. Heuristics:
 *  - header row = first row (within the first 10) with ≥2 header-looking cells
 *  - columns matched by header keywords; if no count header, the first empty
 *    column right of the name column is proposed
 *  - data rows = contiguous run of non-empty name cells after the header
 *    (category-section rows like "VODKA" are kept here; import filters them)
 * Sheets with no detectable header or data get no proposal but are still
 * listed in `sheets`.
 */
export async function analyzeWorkbook(data: Uint8Array): Promise<WorkbookAnalysis> {
  const workbook = await XlsxPopulate.fromDataAsync(data);
  const sheets = workbook.sheets().map((s) => s.name());
  const proposed: ColumnMapping[] = [];

  for (const sheet of workbook.sheets()) {
    const mapping = analyzeSheet(sheet);
    if (mapping) proposed.push(mapping);
  }

  return { sheets, proposed };
}

function analyzeSheet(sheet: Sheet): ColumnMapping | null {
  const used = sheet.usedRange();
  if (!used) return null;
  const endRow = used.endCell().rowNumber();
  const endCol = used.endCell().columnNumber();

  // Header row: first row with ≥2 cells matching any field pattern.
  let headerRow = 0;
  for (let row = 1; row <= Math.min(HEADER_SCAN_ROWS, endRow); row++) {
    let matches = 0;
    for (let col = 1; col <= endCol; col++) {
      const text = headerText(sheet, row, col);
      if (text !== null && FIELD_PATTERNS.some((p) => p.re.test(text))) matches++;
    }
    if (matches >= 2) {
      headerRow = row;
      break;
    }
  }
  if (headerRow === 0) return null;

  // Assign columns field by field; each column claimed at most once.
  const assigned = new Map<MappedField, number>();
  const taken = new Set<number>();
  for (const { field, re } of FIELD_PATTERNS) {
    for (let col = 1; col <= endCol; col++) {
      if (taken.has(col)) continue;
      const text = headerText(sheet, headerRow, col);
      if (text !== null && re.test(text)) {
        assigned.set(field, col);
        taken.add(col);
        break;
      }
    }
  }
  const nameColNum = assigned.get('name');
  if (nameColNum === undefined) return null;

  // Data range: contiguous non-empty name cells after the header row.
  // Section-header rows ("VODKA") have the name cell filled, so they stay in.
  let firstDataRow = 0;
  for (let row = headerRow + 1; row <= endRow; row++) {
    if (isFilled(sheet.cell(row, nameColNum).value())) {
      firstDataRow = row;
      break;
    }
  }
  if (firstDataRow === 0) return null;
  let lastDataRow = firstDataRow;
  while (lastDataRow + 1 <= endRow && isFilled(sheet.cell(lastDataRow + 1, nameColNum).value())) {
    lastDataRow++;
  }

  // Count column: matched header, else first empty column right of name.
  let countColNum = assigned.get('count');
  if (countColNum === undefined) {
    for (let col = nameColNum + 1; col <= endCol + 1; col++) {
      if (taken.has(col)) continue;
      if (headerText(sheet, headerRow, col) !== null) continue;
      let hasData = false;
      for (let row = firstDataRow; row <= lastDataRow; row++) {
        if (isFilled(sheet.cell(row, col).value())) {
          hasData = true;
          break;
        }
      }
      if (!hasData) {
        countColNum = col;
        break;
      }
    }
  }
  if (countColNum === undefined) return null;

  const sizeColNum = assigned.get('size');
  const categoryColNum = assigned.get('category');
  return {
    sheet: sheet.name(),
    headerRow,
    nameCol: columnLetter(nameColNum),
    sizeCol: sizeColNum !== undefined ? columnLetter(sizeColNum) : null,
    categoryCol: categoryColNum !== undefined ? columnLetter(categoryColNum) : null,
    countCol: columnLetter(countColNum),
    firstDataRow,
    lastDataRow,
  };
}
