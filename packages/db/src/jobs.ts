import { uuidv7 } from '@medhub/shared';
import type { Tx } from './client';
import { job } from './schema';

export type EnqueueOptions = {
  runAt?: Date;
  tenantId?: string | null;
  maxAttempts?: number;
};

/**
 * Background work is a row in `job`, picked up by the cron worker every minute
 * (no permanent process on cPanel). Payloads carry identifiers, never health data.
 */
export async function enqueue(
  tx: Tx,
  type: string,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
): Promise<string> {
  const id = uuidv7();
  await tx.insert(job).values({
    id,
    type,
    payload,
    tenantId: options.tenantId ?? null,
    runAt: options.runAt ?? new Date(),
    maxAttempts: options.maxAttempts ?? 5,
  });
  return id;
}

/** Retry delays after a failure: 1 min, 5 min, 30 min, 2 h, 12 h. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

export function retryDelay(attempts: number): number {
  return (
    RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)] ?? 43_200_000
  );
}
