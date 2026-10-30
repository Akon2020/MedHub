import 'server-only';
import { appendAudit, recordSecurityEvent, schema, withTenant } from '@medhub/db';
import { AppError } from '@medhub/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from './configuration';

export type DeviceView = {
  id: string;
  deviceCode: string;
  name: string;
  kind: string;
  user: string | null;
  status: string;
  registeredAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  appVersion: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  current: boolean;
};

export async function listDevices(ctx: RequestContext): Promise<DeviceView[]> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'device:read');
    const rows = await tx
      .select({ device: schema.device, user: schema.userAccount.displayName })
      .from(schema.device)
      .leftJoin(schema.userAccount, eq(schema.userAccount.id, schema.device.userId))
      .orderBy(desc(schema.device.registeredAt));
    return rows.map(({ device: d, user }) => ({
      id: d.id,
      deviceCode: d.deviceCode,
      name: d.name,
      kind: d.kind,
      user,
      status: d.status,
      registeredAt: d.registeredAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
      appVersion: d.appVersion,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      revokedReason: d.revokedReason,
      current: d.id === ctx.deviceId,
    }));
  });
}

export type RevokeInput = {
  deviceId: string;
  status: 'revoked' | 'lost';
  reason: string;
  allowFinalPush: boolean;
};

/**
 * Retires a device ("revoked", for example replaced) or declares it lost or
 * stolen. At its next contact the server answers DEVICE_REVOKED and the device
 * wipes its local data. A retired device may first send its pending operations
 * once; a lost one never can, and its sessions end immediately.
 */
export async function revokeDevice(
  ctx: RequestContext,
  input: RevokeInput,
  client: { ip: string | null },
): Promise<void> {
  if (input.deviceId === ctx.deviceId) throw new AppError('DEVICE_IS_CURRENT', 409);
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'device:revoke');
    await requireRecentStepUp(tx, ctx);
    const [device] = await tx
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, input.deviceId))
      .limit(1);
    if (!device) throw new AppError('NOT_FOUND', 404);
    if (device.status !== 'active') throw new AppError('DEVICE_ALREADY_REVOKED', 409);
    const allowFinalPush = input.status === 'revoked' && input.allowFinalPush;
    const now = new Date();
    await tx
      .update(schema.device)
      .set({
        status: input.status,
        revokedReason: input.reason,
        revokedAt: now,
        revokedBy: ctx.userId,
        allowFinalPush,
        updatedAt: now,
      })
      .where(eq(schema.device.id, device.id));
    if (!allowFinalPush) await endDeviceSessions(tx, device.id, now);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: input.status === 'lost' ? 'device_lost' : 'device_revoke',
      entity: 'device',
      entityId: device.id,
      reason: input.reason,
      diff: { allowFinalPush },
    });
    await recordSecurityEvent(tx, {
      kind: input.status === 'lost' ? 'device_lost' : 'device_revoked',
      severity: input.status === 'lost' ? 'critical' : 'warning',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      ip: client.ip,
      detail: { deviceCode: device.deviceCode },
    });
  });
}

export async function endDeviceSessions(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  deviceId: string,
  now = new Date(),
): Promise<void> {
  await tx
    .update(schema.session)
    .set({ revokedAt: now })
    .where(and(eq(schema.session.deviceId, deviceId), isNull(schema.session.revokedAt)));
}
