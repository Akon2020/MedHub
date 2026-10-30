import { ADMIN_AREA_KINDS, type CsvTable } from '@medhub/shared';
import { z } from 'zod';
import { optionalText } from './organization';

/** Codes of lists and items: what forms, rules and reports refer to. */
export const REFERENCE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export const CHOICE_IMPORT_MAX_ROWS = 2000;

const code = z.string().trim().regex(REFERENCE_CODE_PATTERN);

export const choiceListCreateSchema = z.object({
  code,
  nameFr: z.string().trim().min(2).max(80),
  nameEn: optionalText(80),
  description: optionalText(300),
});
export type ChoiceListCreateInput = z.infer<typeof choiceListCreateSchema>;

export const choiceListUpdateSchema = z.object({
  listId: z.uuid(),
  nameFr: z.string().trim().min(2).max(80),
  nameEn: optionalText(80),
  description: optionalText(300),
  isActive: z.boolean(),
});
export type ChoiceListUpdateInput = z.infer<typeof choiceListUpdateSchema>;

export const choiceItemSchema = z.object({
  code,
  labelFr: z.string().trim().min(1).max(120),
  labelEn: optionalText(120),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
});
export type ChoiceItemInput = z.infer<typeof choiceItemSchema>;

/** An item code is never reused for another meaning: items are deactivated, not deleted. */
export const choiceItemsSaveSchema = z.object({
  listId: z.uuid(),
  items: z
    .array(choiceItemSchema)
    .max(CHOICE_IMPORT_MAX_ROWS)
    .refine((items) => new Set(items.map((i) => i.code)).size === items.length, {
      message: 'REF_ITEM_CODE_DUPLICATE',
    }),
});
export type ChoiceItemsSaveInput = z.infer<typeof choiceItemsSaveSchema>;

export type ImportError = { line: number; field: string; problem: string };

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function columnIndex(header: readonly string[], names: readonly string[]): number {
  const normalized = header.map(normalizeHeader);
  return normalized.findIndex((h) => names.includes(h));
}

/**
 * Items of a pick list from a CSV file (simulation): columns "code",
 * "libelle" (or "libelle_fr"), optional "libelle_en" and "ordre".
 */
export function parseChoiceItems(table: CsvTable): {
  items: ChoiceItemInput[];
  errors: ImportError[];
} {
  const errors: ImportError[] = [];
  const iCode = columnIndex(table.header, ['code']);
  const iFr = columnIndex(table.header, ['libelle', 'libelle_fr', 'label', 'label_fr']);
  const iEn = columnIndex(table.header, ['libelle_en', 'label_en']);
  const iOrder = columnIndex(table.header, ['ordre', 'order', 'sort_order']);
  if (iCode === -1) errors.push({ line: 1, field: 'code', problem: 'missing_column' });
  if (iFr === -1) errors.push({ line: 1, field: 'libelle', problem: 'missing_column' });
  if (errors.length > 0) return { items: [], errors };
  if (table.rows.length > CHOICE_IMPORT_MAX_ROWS) {
    return { items: [], errors: [{ line: 1, field: 'file', problem: 'too_many_rows' }] };
  }

  const items: ChoiceItemInput[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, index) => {
    const order = iOrder === -1 ? '' : (row.cells[iOrder] ?? '');
    const parsed = choiceItemSchema.safeParse({
      code: row.cells[iCode] ?? '',
      labelFr: row.cells[iFr] ?? '',
      labelEn: iEn === -1 ? null : (row.cells[iEn] ?? ''),
      sortOrder: order === '' ? (index + 1) * 10 : Number(order),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ line: row.line, field: String(issue.path[0] ?? 'row'), problem: 'invalid' });
      }
      return;
    }
    if (seen.has(parsed.data.code)) {
      errors.push({ line: row.line, field: 'code', problem: 'duplicate' });
      return;
    }
    seen.add(parsed.data.code);
    items.push(parsed.data);
  });
  return { items, errors };
}

export type AdminAreaRow = {
  code: string;
  level: number;
  kind: string;
  name: string;
  parentCode: string | null;
};

/**
 * Administrative divisions from an official file: columns "code", "niveau",
 * "type", "nom", "code_parent". A parent must exist (already loaded or earlier
 * in the file) and sit exactly one level above.
 */
export function parseAdminAreas(
  table: CsvTable,
  known: ReadonlyMap<string, number>,
): { rows: AdminAreaRow[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const columns = {
    code: columnIndex(table.header, ['code']),
    level: columnIndex(table.header, ['niveau', 'level']),
    kind: columnIndex(table.header, ['type', 'kind']),
    name: columnIndex(table.header, ['nom', 'name']),
    parent: columnIndex(table.header, ['code_parent', 'parent', 'parent_code']),
  };
  for (const [field, index] of Object.entries(columns)) {
    if (index === -1) errors.push({ line: 1, field, problem: 'missing_column' });
  }
  if (errors.length > 0) return { rows: [], errors };

  const levels = new Map(known);
  const rows: AdminAreaRow[] = [];
  for (const row of table.rows) {
    const cell = (i: number) => row.cells[i] ?? '';
    const code = cell(columns.code);
    const level = Number(cell(columns.level));
    const kind = cell(columns.kind).toLowerCase();
    const name = cell(columns.name);
    const parentCode = cell(columns.parent) || null;
    const problems: ImportError[] = [];
    if (!REFERENCE_CODE_PATTERN.test(code))
      problems.push({ line: row.line, field: 'code', problem: 'invalid' });
    if (!Number.isInteger(level) || !ADMIN_AREA_KINDS[level])
      problems.push({ line: row.line, field: 'niveau', problem: 'invalid' });
    else if (!ADMIN_AREA_KINDS[level]?.includes(kind))
      problems.push({ line: row.line, field: 'type', problem: 'invalid' });
    if (name.length < 2 || name.length > 120)
      problems.push({ line: row.line, field: 'nom', problem: 'invalid' });
    if (level > 1) {
      const parentLevel = parentCode ? levels.get(parentCode) : undefined;
      if (parentLevel === undefined)
        problems.push({ line: row.line, field: 'code_parent', problem: 'unknown' });
      else if (parentLevel !== level - 1)
        problems.push({ line: row.line, field: 'code_parent', problem: 'wrong_level' });
    }
    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    levels.set(code, level);
    rows.push({ code, level, kind, name, parentCode: level > 1 ? parentCode : null });
  }
  return { rows, errors };
}

/** What a device keeps offline: read-only catalogs of the platform and the structure. */
export type CatalogSnapshot = {
  etag: string;
  currencies: { code: string; nameFr: string; nameEn: string; minorUnit: number; symbol: string }[];
  units: { code: string; kind: string; symbol: string; labelFr: string; labelEn: string }[];
  provinces: { code: string; name: string }[];
  sites: { id: string; code: string; name: string; isActive: boolean }[];
  departments: { id: string; siteId: string; code: string; name: string; isActive: boolean }[];
  choiceLists: {
    code: string;
    nameFr: string;
    nameEn: string | null;
    items: { code: string; labelFr: string; labelEn: string | null }[];
  }[];
};
