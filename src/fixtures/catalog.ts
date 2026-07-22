import { generateAliases } from '@/aliases/generate';
import { enrichAliases, stubEnricher } from '@/aliases/enrich';
import type { Catalog, CatalogItem } from '@/matcher/catalog';
import type { ImportedRow } from '@/workbook/types';

/**
 * Builds a matcher catalogue from imported workbook rows: deterministic
 * aliases first, optional enrichment layered on top, canonical name always
 * available as a fallback via trigram similarity.
 *
 * Item ids are derived from the sheet address, so the catalogue — like
 * everything else here — is reproducible.
 */
export async function catalogFromRows(rows: ImportedRow[]): Promise<Catalog> {
  const enriched = await enrichAliases(
    rows.map((r) => r.name),
    stubEnricher,
  );

  const items: CatalogItem[] = rows.map((row) => {
    const aliases = new Map<string, 'approved' | 'generated'>();
    for (const alias of generateAliases(row.name)) aliases.set(alias, 'generated');
    for (const alias of enriched.get(row.name) ?? []) {
      if (!aliases.has(alias)) aliases.set(alias, 'generated');
    }
    return {
      id: `${row.sheetRef.sheet}!${row.sheetRef.row}`,
      canonicalName: row.name,
      sizeMl: row.sizeMl,
      aliases: [...aliases].map(([text, trust]) => ({ text, trust })),
    };
  });

  return {
    items,
    zones: [{ zoneId: 'back-bar', itemIds: items.map((i) => i.id) }],
  };
}
