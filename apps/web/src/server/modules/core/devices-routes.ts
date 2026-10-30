import 'server-only';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { listDevices, revokeDevice } from './devices';
import { refreshDeviceTokens } from './service';

export const devicesRoute = defineRoute({
  route: 'devices.list',
  handler: async ({ ctx }) => json({ devices: await listDevices(ctx) }),
});

const revokeSchema = z.object({
  deviceId: z.uuid(),
  status: z.enum(['revoked', 'lost']),
  reason: z.string().trim().min(3).max(300),
  allowFinalPush: z.boolean().default(false),
});

export const deviceRevokeRoute = defineRoute({
  route: 'devices.revoke',
  schema: revokeSchema,
  handler: async ({ request, body, ctx }) => {
    await revokeDevice(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const deviceTokensRoute = defineRoute({
  route: 'devices.tokens',
  schema: z.object({ deviceId: z.uuid() }),
  handler: async ({ body, ctx }) => json(await refreshDeviceTokens(ctx, body.deviceId)),
});
