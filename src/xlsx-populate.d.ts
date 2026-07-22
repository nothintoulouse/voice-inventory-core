/**
 * Minimal ambient types for xlsx-populate 1.21.0 (no bundled types),
 * covering only the surface used by src/lib/workbook/. Verified against
 * node_modules/xlsx-populate/lib/. Extend as usage grows.
 */
declare module 'xlsx-populate' {
  /** Values a cell can hold. Getter may also yield rich text; we treat it as unknown-ish. */
  export type CellValue = string | number | boolean | Date | undefined;

  export interface Cell {
    /** Get the cell value. */
    value(): CellValue;
    /** Set the cell value. */
    value(value: CellValue): Cell;
    /** Get the cell formula (without leading '='), or undefined. */
    formula(): string | undefined;
    /** Set the cell formula (without leading '='). */
    formula(formula: string): Cell;
    /** Get a single style property. */
    style(name: string): unknown;
    /** Set a single style property. */
    style(name: string, value: unknown): Cell;
    rowNumber(): number;
    columnNumber(): number;
    columnName(): string;
  }

  export interface Range {
    startCell(): Cell;
    endCell(): Cell;
  }

  export interface Sheet {
    /** Get the sheet name. */
    name(): string;
    /** Rename the sheet. */
    name(name: string): Sheet;
    /** Get a cell by address ("A1") or by row number + column name/number. */
    cell(address: string): Cell;
    cell(rowNumber: number, columnNameOrNumber: string | number): Cell;
    /** Range of cells that have ever held a value or style, or undefined if none. */
    usedRange(): Range | undefined;
  }

  export interface Workbook {
    /** Get a sheet by name or zero-based index; undefined if not found. */
    sheet(nameOrIndex: string | number): Sheet | undefined;
    sheets(): Sheet[];
    addSheet(name: string): Sheet;
    /** Generate output. Defaults to a Node Buffer; request 'uint8array' explicitly. */
    outputAsync(type: 'uint8array'): Promise<Uint8Array>;
    outputAsync(type?: string): Promise<Uint8Array | ArrayBuffer | Blob | string>;
  }

  const XlsxPopulate: {
    fromDataAsync(data: ArrayBuffer | Uint8Array): Promise<Workbook>;
    fromBlankAsync(): Promise<Workbook>;
    MIME_TYPE: string;
  };

  export default XlsxPopulate;
}
