import XlsxPopulate from 'xlsx-populate';
import { SheetRef } from './types';

/**
 * Writes final counts into a copy of the user's ORIGINAL workbook bytes and
 * returns the new bytes. Only the addressed count cells are touched —
 * formulas, styles, and every other cell ride through untouched. This
 * round-trip fidelity is the whole reason xlsx-populate was chosen.
 */
export async function patchCounts(
  original: Uint8Array,
  counts: { sheetRef: SheetRef; value: number }[],
): Promise<Uint8Array> {
  const workbook = await XlsxPopulate.fromDataAsync(original);
  for (const { sheetRef, value } of counts) {
    const sheet = workbook.sheet(sheetRef.sheet);
    if (!sheet) throw new Error(`Sheet not found in workbook: ${sheetRef.sheet}`);
    sheet.cell(sheetRef.row, sheetRef.countCol).value(value);
  }
  return workbook.outputAsync('uint8array');
}
