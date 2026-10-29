import 'server-only';
import { AppError } from '@medhub/shared';
import { DEFAULT_PULL_LIMIT, MAX_PUSH_BYTES, pushRequestSchema } from '@medhub/sync';
import { z } from 'zod';
import { defineRoute, json } from '../../platform/http';
import { pull, push, status } from './service';

export const pushRoute = defineRoute({
  route: 'sync.push',
  handler: async ({ request, ctx }) => {
    const text = await request.text();
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_PUSH_BYTES) throw new AppError('SYNC_BATCH_TOO_LARGE', 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION_FAILED', 400, { reason: 'INVALID_JSON' });
    }
    const parsed = pushRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await push(ctx, parsed.data, bytes));
  },
});

const pullQuery = z.object({
  deviceId: z.uuid(),
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(DEFAULT_PULL_LIMIT),
  lookback: z.enum(['0', '1']).default('0'),
});

export const pullRoute = defineRoute({
  route: 'sync.pull',
  handler: async ({ request, ctx }) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = pullQuery.safeParse(params);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(
      await pull(ctx, {
        deviceId: parsed.data.deviceId,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        lookback: parsed.data.lookback === '1',
      }),
    );
  },
});

export const statusRoute = defineRoute({
  route: 'sync.status',
  handler: async () => json(status()),
});
