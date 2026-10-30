import 'server-only';
import { withTenant } from '@medhub/db';
import { AppError } from '@medhub/shared';
import {
  MAX_PUSH_BYTES,
  SUPPORTED_SCHEMA_VERSIONS,
  SYNC_SCHEMA_VERSION,
  type PullResponse,
  type PushResponse,
  type SyncStatusResponse,
} from '@medhub/sync';
import { processPull, processPush } from '@medhub/sync/server';
import { database } from '../../platform/db';
import { loadPermissions } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { loadDevice, pgSyncStore, touchDevice } from './repository';

/** Entities a user may receive on pull, by read permission. */
const READ_PERMISSION: Record<string, readonly string[]> = {
  patient: ['patient:read'],
  vital_sign: ['vital_sign:read', 'clinical_record:read'],
  stock_movement: ['stock:read'],
};

async function permissionsOf(ctx: RequestContext): Promise<Set<string>> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
    loadPermissions(tx, ctx.userId),
  );
}

async function activeDevice(ctx: RequestContext, deviceId: string) {
  const device = await loadDevice(database().db, ctx, deviceId);
  if (!device || device.userId !== ctx.userId) throw new AppError('DEVICE_UNKNOWN', 403);
  if (device.status !== 'active') throw new AppError('DEVICE_REVOKED', 403);
  return device;
}

export async function push(
  ctx: RequestContext,
  request: { deviceId: string; schemaVersion: number; ops: unknown[] },
  bodyBytes: number,
): Promise<PushResponse> {
  if (bodyBytes > MAX_PUSH_BYTES) throw new AppError('SYNC_BATCH_TOO_LARGE', 413);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(request.schemaVersion)) {
    throw new AppError('SYNC_SCHEMA_UNSUPPORTED', 426);
  }
  const device = await activeDevice(ctx, request.deviceId);
  const permissions = await permissionsOf(ctx);
  const store = pgSyncStore(database().db, { ...ctx, deviceId: device.id });
  const response = await processPush(
    store,
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: device.id,
      permissions,
      devicePublicKey: device.publicKey,
      serverTime: () => new Date().toISOString(),
    },
    request,
  );
  await touchDevice(database().db, ctx, device.id, true);
  return response;
}

export async function pull(
  ctx: RequestContext,
  input: { deviceId: string; cursor: number; limit: number; lookback: boolean },
): Promise<PullResponse> {
  const device = await activeDevice(ctx, input.deviceId);
  const permissions = await permissionsOf(ctx);
  const store = pgSyncStore(database().db, { ...ctx, deviceId: device.id });
  const now = Date.now();
  const response = await processPull(store, {
    cursor: input.cursor,
    limit: input.limit,
    lookback: input.lookback,
    nowMs: now,
    serverTime: new Date(now).toISOString(),
  });
  // A change the user may not read still advances the cursor, but its data is never sent.
  response.changes = response.changes.filter((change) =>
    (READ_PERMISSION[change.entity] ?? []).some((key) => permissions.has(key)),
  );
  await touchDevice(database().db, ctx, device.id, true);
  return response;
}

export function status(): SyncStatusResponse {
  return {
    serverTime: new Date().toISOString(),
    schemaVersion: SYNC_SCHEMA_VERSION,
    supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
    minClientVersion: '0.1.0',
    pendingServerOps: 0,
  };
}
