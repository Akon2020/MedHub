import 'server-only';
import { isConfigKey } from '@medhub/domain';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  discardDraft,
  getConfiguration,
  publishDraft,
  restoreVersion,
  saveDraft,
} from './configuration';

const keySchema = z.string().refine(isConfigKey, 'CONFIG_KEY_UNKNOWN');

export const configurationRoute = defineRoute({
  route: 'config.read',
  handler: async ({ ctx }) => json(await getConfiguration(ctx)),
});

export const configDraftRoute = defineRoute({
  route: 'config.draft',
  schema: z.object({
    key: keySchema,
    value: z.unknown(),
    note: z.string().trim().max(300).nullish(),
  }),
  handler: async ({ body, ctx }) => {
    if (!isConfigKey(body.key)) return json({ ok: false }, { status: 400 });
    await saveDraft(ctx, { key: body.key, value: body.value, note: body.note ?? null });
    return json({ ok: true });
  },
});

export const configDiscardRoute = defineRoute({
  route: 'config.discard',
  schema: z.object({ key: keySchema }),
  handler: async ({ body, ctx }) => {
    if (isConfigKey(body.key)) await discardDraft(ctx, body.key);
    return json({ ok: true });
  },
});

export const configPublishRoute = defineRoute({
  route: 'config.publish',
  schema: z.object({ key: keySchema }),
  handler: async ({ request, body, ctx }) => {
    if (isConfigKey(body.key)) await publishDraft(ctx, body.key, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const configRestoreRoute = defineRoute({
  route: 'config.restore',
  schema: z.object({ key: keySchema, version: z.number().int().positive() }),
  handler: async ({ body, ctx }) => {
    if (isConfigKey(body.key)) await restoreVersion(ctx, body.key, body.version);
    return json({ ok: true });
  },
});
