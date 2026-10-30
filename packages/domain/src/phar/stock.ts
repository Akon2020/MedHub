import { STOCK_INBOUND_KINDS, STOCK_MOVEMENT_KINDS, type StockMovementKind } from '@medhub/shared';
import { z } from 'zod';

export const stockMovementRecordPayload = z.object({
  warehouseId: z.uuid(),
  productId: z.uuid(),
  lotId: z.uuid().nullish(),
  kind: z.enum(STOCK_MOVEMENT_KINDS),
  quantity: z.number().int().positive(),
  reason: z.string().trim().max(500).nullish(),
});
export type StockMovementRecordPayload = z.infer<typeof stockMovementRecordPayload>;

export function signedQuantity(kind: StockMovementKind, quantity: number): number {
  return STOCK_INBOUND_KINDS.has(kind) ? quantity : -quantity;
}

/** The balance is never stored as a mutable field: it is always this sum. */
export function stockBalance(
  movements: readonly { kind: StockMovementKind; quantity: number }[],
): number {
  return movements.reduce((acc, m) => acc + signedQuantity(m.kind, m.quantity), 0);
}
