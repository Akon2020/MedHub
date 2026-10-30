import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { appendOnlyColumns } from '../columns';

/** Ledger of stock movements; the balance is always computed from these rows. */
export const stockMovement = pgTable(
  'stock_movement',
  {
    ...appendOnlyColumns(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id'),
    kind: text('kind').notNull(),
    quantity: integer('quantity').notNull(),
    unitCost: bigint('unit_cost', { mode: 'number' }),
    unitCostCurrency: text('unit_cost_currency'),
    refTable: text('ref_table'),
    refId: uuid('ref_id'),
    reason: text('reason'),
    approvedBy: uuid('approved_by'),
  },
  (t) => [
    index('stock_movement_product_idx').on(t.tenantId, t.warehouseId, t.productId),
    check('stock_movement_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'stock_movement_kind_check',
      sql`${t.kind} in ('receipt','dispense','sale','transfer_out','transfer_in','return_supplier','return_patient','adjustment_plus','adjustment_minus','destruction','consumption','count_correction')`,
    ),
  ],
);
