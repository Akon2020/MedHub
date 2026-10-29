import 'server-only';
import { DEVICE_KINDS } from '@medhub/shared';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from '../../platform/session';
import { currentProfile, login, registerDevice } from './service';

const loginSchema = z.object({
  tenantCode: z.string().trim().min(4).max(20),
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const loginRoute = defineRoute({
  route: 'auth.login',
  auth: false,
  schema: loginSchema,
  handler: async ({ request, body }) => {
    const result = await login({
      ...body,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, result.cookie, sessionCookieOptions(result.expiresAt));
    return json({ profile: result.profile });
  },
});

export const logoutRoute = defineRoute({
  route: 'auth.logout',
  auth: false,
  handler: async () => {
    const store = await cookies();
    await revokeSession(store.get(SESSION_COOKIE)?.value);
    store.delete(SESSION_COOKIE);
    return json({ ok: true });
  },
});

export const meRoute = defineRoute({
  route: 'auth.me',
  handler: async ({ ctx }) => json({ profile: await currentProfile(ctx) }),
});

const deviceSchema = z.object({
  publicKey: z.string().min(40).max(100),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(DEVICE_KINDS),
  appVersion: z.string().max(40).nullish(),
});

export const registerDeviceRoute = defineRoute({
  route: 'devices.register',
  schema: deviceSchema,
  handler: async ({ request, body, ctx }) =>
    json(
      await registerDevice(ctx, {
        publicKey: body.publicKey,
        name: body.name,
        kind: body.kind,
        appVersion: body.appVersion ?? null,
        userAgent: request.headers.get('user-agent'),
      }),
      { status: 201 },
    ),
});
