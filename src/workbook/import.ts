import XlsxPopulate from 'xlsx-populate';
import { ColumnMapping, ImportedRow } from './types';

// "750ml" / "750 ML" / "330 mls"
const ML_RE = /(\d+(?:\.\d+)?)\s*mls?\b/i;
// "1L" / "1.75 L" / "1 Ltr" / "0.75 litre(s)"
const LITER_RE = /(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|liter|litre)s?\b/i;
// Bare "Ltr" / "Liter" with no number means one liter ("Marlo's Ltr").
const BARE_LITER_RE = /\b(?:ltr|liter|litre)\b/i;

/**
 * Numbers without units: bartenders write "750" (ml) or "1.75" (liters).
 * Anything under 50 can't plausibly be milliliters for a bottle.
 */
function numberToMl(value: number): number {
  return value >= 50 ? value : value * 1000;
}

/** Parses a bottle size in ml out of free text ("750ml", "1.75L", "Ltr"). */
export function parseSizeText(text: string): number | null {
  const ml = ML_RE.exec(text);
  if (ml) return Number(ml[1]);
  const liters = LITER_RE.exec(text);
  if (liters) return Number(liters[1]) * 1000;
  if (BARE_LITER_RE.test(text)) return 1000;
  if (/^\s*\d+(?:\.\d+)?\s*$/.test(text)) return numberToMl(Number(text));
  return null;
}

function sizeFromCell(value: unknown): number | null {
  if (typeof value === 'number') return numberToMl(value);
  if (typeof value === 'string' && value.trim() !== '') return parseSizeText(value);
  return null;
}

function countFromCell(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/**
 * Category-section rows ("VODKA", "BOURBON") sit in the name column of real
 * count sheets. They look like: an all-caps short label with no size parsed
 * and no existing count. All-caps item names escape this because they carry
 * a size ("MARLO'S 750ML") or a count.
 */
export function looksLikeSectionHeader(
  name: string,
  sizeMl: number | null,
  count: number | null,
): boolean {
  if (sizeMl !== null || count !== null) return false;
  return name.length <= 24 && /[A-Z]/.test(name) && /^[A-Z][A-Z\s&/'-]*$/.test(name);
}

/**
 * Extracts inventory rows from a workbook using a (user-confirmed) mapping.
 * Sizes come from the size column when present, else parsed out of the name
 * text. Section-header rows are dropped; names are trimmed.
 */
export async function importRows(
  data: Uint8Array,
  mapping: ColumnMapping,
): Promise<ImportedRow[]> {
  const workbook = await XlsxPopulate.fromDataAsync(data);
  const sheet = workbook.sheet(mapping.sheet);
  if (!sheet) throw new Error(`Sheet not found in workbook: ${mapping.sheet}`);

  const rows: ImportedRow[] = [];
  for (let row = mapping.firstDataRow; row <= mapping.lastDataRow; row++) {
    const rawName = sheet.cell(row, mapping.nameCol).value();
    if (typeof rawName !== 'string' && typeof rawName !== 'number') continue;
    const name = String(rawName).trim();
    if (name === '') continue;

    const sizeCellValue = mapping.sizeCol ? sheet.cell(row, mapping.sizeCol).value() : undefined;
    const sizeMl = sizeFromCell(sizeCellValue) ?? parseSizeText(name);
    const existingCount = countFromCell(sheet.cell(row, mapping.countCol).value());
    if (looksLikeSectionHeader(name, sizeMl, existingCount)) continue;

    const categoryValue = mapping.categoryCol
      ? sheet.cell(row, mapping.categoryCol).value()
      : undefined;
    const category =
      typeof categoryValue === 'string' && categoryValue.trim() !== ''
        ? categoryValue.trim()
        : null;

    rows.push({
      name,
      sizeMl,
      category,
      existingCount,
      sheetRef: { sheet: mapping.sheet, row, countCol: mapping.countCol },
    });
  }
  return rows;
}
