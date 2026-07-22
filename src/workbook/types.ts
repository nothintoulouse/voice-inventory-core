/** Address of one count cell in the user's original workbook. */
export type SheetRef = {
  sheet: string;
  row: number;
  countCol: string;
};

/** One inventory line extracted from the user's count sheet. */
export type ImportedRow = {
  name: string;
  sizeMl: number | null;
  category: string | null;
  existingCount: number | null;
  sheetRef: SheetRef;
};

/**
 * How to read one sheet: which columns hold what, and the data row range.
 * Columns are Excel letters ("A", "D"); rows are 1-based.
 */
export type ColumnMapping = {
  sheet: string;
  headerRow: number;
  nameCol: string;
  sizeCol: string | null;
  categoryCol: string | null;
  countCol: string;
  firstDataRow: number;
  lastDataRow: number;
};

/** Result of scanning a workbook: every sheet name plus proposed mappings. */
export type WorkbookAnalysis = {
  sheets: string[];
  proposed: ColumnMapping[];
};
