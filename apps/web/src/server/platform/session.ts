import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { schema, withTenant, type Tx } from '@medhub/db';
import { isUuid, uuidv7 } from '@medhub/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { database } from './db';
import { env } from './env';

export const SESSION_COOKIE = 'medhub_session';

export type SessionRecord = {
  sessionId: string;
  tenantId: string;
  userId: string;
  deviceId: string | null;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mac(value: string): string {
  return createHmac('sha256', env().MEDHUB_SESSION_SECRET).update(value).digest('base64url');
}

/**
 * Cookie value: `<tenantId>.<token>.<mac>`. The tenant id only scopes the lookup;
 * access is granted solely if the hashed token exists in that structure under RLS.
 */
export function encodeSessionCookie(tenantId: string, token: string): string {
  const value = `${tenantId}.${token}`;
  return `${value}.${mac(value)}`;
}

export function decodeSessionCookie(
  raw: string | undefined,
): { tenantId: string; token: string } | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [tenantId, token, signature] = parts as [string, string, string];
  if (!isUuid(tenantId) || token.length < 40) return null;
  const expected = Buffer.from(mac(`${tenantId}.${token}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { tenantId, token };
}

export async function createSession(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    deviceId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ cookie: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env().MEDHUB_SESSION_ABSOLUTE_DAYS * 86_400_000);
  await tx.insert(schema.session).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId ?? null,
    tokenHash: hashToken(token),
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { cookie: encodeSessionCookie(input.tenantId, token), expiresAt };
}

export async function lookupSession(raw: string | undefined): Promise<SessionRecord | null> {
  const decoded = decodeSessionCookie(raw);
  if (!decoded) return null;
  const idleMs = env().MEDHUB_SESSION_IDLE_HOURS * 3_600_000;
  return withTenant(database().db, { tenantId: decoded.tenantId, userId: null }, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select()
      .from(schema.session)
      .where(
        and(
          eq(schema.session.tokenHash, hashToken(decoded.token)),
          isNull(schema.session.revokedAt),
          gt(schema.session.expiresAt, now),
          gt(schema.session.lastSeenAt, new Date(now.getTime() - idleMs)),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await tx.update(schema.session).set({ lastSeenAt: now }).where(eq(schema.session.id, row.id));
    }
    return {
      sessionId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      deviceId: row.deviceId,
    };
  });
}

export async function revokeSession(raw: string | undefined): Promise<void> {
  const decoded = decodeSessionCookie(raw);
  if (!decoded) return;
  await withTenant(database().db, { tenantId: decoded.tenantId, userId: null }, (tx) =>
    tx
      .update(schema.session)
      .set({ revokedAt: new Date() })
      .where(eq(schema.session.tokenHash, hashToken(decoded.token))),
  );
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
