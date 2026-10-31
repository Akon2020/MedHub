import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../columns';

/**
 * Platform reference tables: no tenant_id, the same for every structure,
 * written only by migrations and platform imports, read by everyone.
 */
export const currency = pgTable('currency', {
  code: text('code').primaryKey(),
  nameFr: text('name_fr').notNull(),
  nameEn: text('name_en').notNull(),
  minorUnit: integer('minor_unit').notNull(),
  symbol: text('symbol').notNull(),
});

export const unit = pgTable(
  'unit',
  {
    /** UCUM code when one exists (kg, mm[Hg], /min). */
    code: text('code').primaryKey(),
    kind: text('kind').notNull(),
    symbol: text('symbol').notNull(),
    labelFr: text('label_fr').notNull(),
    labelEn: text('label_en').notNull(),
  },
  (t) => [
    check(
      'unit_kind_check',
      sql`${t.kind} in ('mass','volume','length','temperature','pressure','rate','ratio','concentration','count','time')`,
    ),
  ],
);

/** Administrative divisions: provinces, then territories and cities, then below. */
export const adminArea = pgTable(
  'admin_area',
  {
    code: text('code').primaryKey(),
    country: text('country').notNull().default('CD'),
    level: integer('level').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    parentCode: text('parent_code'),
    source: text('source').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('admin_area_parent_idx').on(t.parentCode),
    check('admin_area_level_check', sql`${t.level} between 1 and 4`),
  ],
);

/** Configurable pick lists of a structure (docs/modules/core.md, capability 8). */
export const choiceList = pgTable(
  'choice_list',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    nameFr: text('name_fr').notNull(),
    nameEn: text('name_en'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('choice_list_code_uq').on(t.tenantId, t.code)],
);

export const choiceItem = pgTable(
  'choice_item',
  {
    ...tenantColumns(),
    listId: uuid('list_id').notNull(),
    code: text('code').notNull(),
    labelFr: text('label_fr').notNull(),
    labelEn: text('label_en'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('choice_item_code_uq').on(t.tenantId, t.listId, t.code),
    index('choice_item_list_idx').on(t.tenantId, t.listId, t.sortOrder),
  ],
);
