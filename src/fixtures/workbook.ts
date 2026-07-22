import XlsxPopulate from 'xlsx-populate';

/**
 * The one synthetic workbook used by both the test suite and the offline demo.
 *
 * It is generated in memory, every time, from this file — no binary fixture is
 * committed and no real inventory sheet was ever copied into this repository.
 * All product names are invented.
 *
 * It is deliberately *messy*, because real count sheets are:
 *  - a title row above the header, so the header is not row 1
 *  - bold styling that must survive a round trip
 *  - all-caps category section rows sitting in the item-name column
 *  - sizes sometimes in their own column, sometimes only inside the name text
 *  - a formula outside the count column that must not be disturbed
 *  - a second sheet with no count column at all
 */
export async function buildSyntheticWorkbook(): Promise<Uint8Array> {
  const workbook = await XlsxPopulate.fromBlankAsync();

  const liquor = workbook.sheet(0)!.name('Liquor');
  liquor.cell('A1').value('Back Bar Inventory');
  liquor.cell('A3').value('Item').style('bold', true);
  liquor.cell('B3').value('Size');
  liquor.cell('C3').value('Category');
  liquor.cell('D3').value('On Hand').style('bold', true);

  liquor.cell('A4').value('VODKA');
  liquor.cell('A5').value("  Marlo's 750ml ");
  liquor.cell('C5').value('Vodka');
  liquor.cell('D5').value(2);
  liquor.cell('A6').value('Nordvale Reserve');
  liquor.cell('B6').value('1L');
  liquor.cell('C6').value('Vodka');

  liquor.cell('A7').value('BOURBON');
  liquor.cell('A8').value("Fowler's Mark 1.75L");
  liquor.cell('C8').value('Bourbon');
  liquor.cell('D8').value(1.5);
  liquor.cell('A9').value('Bison Creek');
  liquor.cell('B9').value(750);
  liquor.cell('C9').value('Bourbon');
  liquor.cell('A10').value('Harbor 107');
  liquor.cell('B10').value(750);
  liquor.cell('C10').value('Bourbon');

  liquor.cell('A11').value('GIN');
  liquor.cell('A12').value("Wenlock's");
  liquor.cell('B12').value(750);
  liquor.cell('C12').value('Gin');
  liquor.cell('A13').value('Thornbury Dry');
  liquor.cell('B13').value('1L');
  liquor.cell('C13').value('Gin');

  liquor.cell('A14').value('AMARO');
  liquor.cell('A15').value('Verano Amaro');
  liquor.cell('B15').value(750);
  liquor.cell('C15').value('Amaro');
  liquor.cell('A16').value('Solara');
  liquor.cell('B16').value(750);
  liquor.cell('C16').value('Amaro');

  liquor.cell('F2').formula('SUM(D4:D16)');

  const wine = workbook.addSheet('Wine');
  wine.cell('A1').value('Product Name');
  wine.cell('B1').value('Vol (ml)');
  wine.cell('C1').value('Type');
  wine.cell('A2').value('Halden Cabernet');
  wine.cell('B2').value(750);
  wine.cell('C2').value('Red');
  wine.cell('A3').value('Bellamonte Prosecco');
  wine.cell('B3').value(750);
  wine.cell('C3').value('Sparkling');
  wine.cell('A4').value('House Chardonnay Ltr');
  wine.cell('C4').value('White');

  return workbook.outputAsync('uint8array');
}
