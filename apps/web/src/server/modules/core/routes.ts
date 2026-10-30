import 'server-only';
import { DEVICE_KINDS } from '@medhub/shared';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from '../../platform/session';
import {
  beginMfaSetup,
  completeEnrollment,
  confirmMfaSetup,
  currentProfile,
  disableMfa,
  login,
  regenerateRecoveryCodes,
  registerDevice,
  revokeSessions,
  securityOverview,
  startEnrollment,
  stepUp,
  type RotatedSession,
  verifyMfa,
  type SignedIn,
} from './service';

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
    const result = await login({ ...body, ...client(request) });
    if (result.status !== 'signed_in') return json(result);
    return signedIn(result);
  },
});

function client(request: Request) {
  return { ip: clientIp(request), userAgent: request.headers.get('user-agent') };
}

async function setSessionCookie(session: RotatedSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, session.cookie, sessionCookieOptions(session.expiresAt));
}

async function signedIn(result: SignedIn, extra: Record<string, unknown> = {}): Promise<Response> {
  const store = await cookies();
  store.set(SESSION_COOKIE, result.cookie, sessionCookieOptions(result.expiresAt));
  return json({ status: 'signed_in', profile: result.profile, ...extra });
}

const challengeSchema = z.object({ challenge: z.string().min(40).max(300) });
const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

export const mfaVerifyRoute = defineRoute({
  route: 'auth.mfa.verify',
  auth: false,
  schema: challengeSchema.extend(codeSchema.shape),
  handler: async ({ request, body }) =>
    signedIn(await verifyMfa({ challenge: body.challenge, code: body.code, ...client(request) })),
});

export const mfaEnrollRoute = defineRoute({
  route: 'auth.mfa.enroll',
  auth: false,
  schema: challengeSchema,
  handler: async ({ request, body }) =>
    json(await startEnrollment({ challenge: body.challenge, ...client(request) })),
});

export const mfaActivateRoute = defineRoute({
  route: 'auth.mfa.activate',
  auth: false,
  schema: challengeSchema.extend(codeSchema.shape),
  handler: async ({ request, body }) => {
    const result = await completeEnrollment({
      challenge: body.challenge,
      code: body.code,
      ...client(request),
    });
    return signedIn(result, { recoveryCodes: result.recoveryCodes });
  },
});

export const accountSecurityRoute = defineRoute({
  route: 'account.security',
  handler: async ({ ctx }) => json(await securityOverview(ctx)),
});

export const accountMfaSetupRoute = defineRoute({
  route: 'account.mfa.setup',
  handler: async ({ ctx }) => json(await beginMfaSetup(ctx)),
});

export const accountMfaConfirmRoute = defineRoute({
  route: 'account.mfa.confirm',
  schema: codeSchema,
  handler: async ({ request, body, ctx }) => {
    const result = await confirmMfaSetup(ctx, body.code, client(request));
    await setSessionCookie(result.session);
    return json({ recoveryCodes: result.recoveryCodes });
  },
});

export const stepUpRoute = defineRoute({
  route: 'auth.step_up',
  schema: codeSchema,
  handler: async ({ request, body, ctx }) => {
    await setSessionCookie(await stepUp(ctx, body.code, client(request)));
    return json({ ok: true });
  },
});

export const accountRecoveryCodesRoute = defineRoute({
  route: 'account.mfa.recovery_codes',
  schema: codeSchema,
  handler: async ({ request, body, ctx }) =>
    json({ recoveryCodes: await regenerateRecoveryCodes(ctx, body.code, client(request)) }),
});

export const accountMfaDisableRoute = defineRoute({
  route: 'account.mfa.disable',
  schema: codeSchema,
  handler: async ({ request, body, ctx }) => {
    await disableMfa(ctx, body.code, client(request));
    return json({ ok: true });
  },
});

const revokeSchema = z.union([
  z.object({ sessionId: z.uuid() }),
  z.object({ others: z.literal(true) }),
]);

export const accountRevokeSessionsRoute = defineRoute({
  route: 'account.sessions.revoke',
  schema: revokeSchema,
  handler: async ({ request, body, ctx }) =>
    json({ revoked: await revokeSessions(ctx, body, client(request)) }),
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
