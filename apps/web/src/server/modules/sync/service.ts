import 'server-only';
import { withTenant } from '@medhub/db';
import {
  ENTITIES,
  sensitivityAllowed,
  type EntityName,
  type PatientScopeRule,
} from '@medhub/domain';
import { AppError, type PatientSensitivity } from '@medhub/shared';
import {
  MAX_PUSH_BYTES,
  SUPPORTED_SCHEMA_VERSIONS,
  SYNC_SCHEMA_VERSION,
  type ChangeRecord,
  type PullResponse,
  type PushResponse,
  type SyncStatusResponse,
} from '@medhub/sync';
import { processPull, processPush } from '@medhub/sync/server';
import { database } from '../../platform/db';
import { loadPermissions, loadSensitivityMax } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import {
  endDeviceSessions,
  loadDevice,
  patientSensitivities,
  pgSyncStore,
  touchDevice,
} from './repository';
import { applyPatientScope, loadPatientScope } from './scope';

/** Entities a user may receive on pull, by read permission. */
const READ_PERMISSION: Record<string, readonly string[]> = {
  patient: ['patient:read'],
  patient_favorite: ['patient:read'],
  encounter: ['encounter:read'],
  queue_ticket: ['queue:read'],
  vital_sign: ['vital_sign:read', 'clinical_record:read'],
  stock_movement: ['stock:read'],
};

async function accessOf(ctx: RequestContext): Promise<{
  permissions: Set<string>;
  sensitivityMax: PatientSensitivity;
  scope: PatientScopeRule;
}> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => ({
    permissions: await loadPermissions(tx, ctx.userId),
    sensitivityMax: await loadSensitivityMax(tx, ctx.userId),
    scope: await loadPatientScope(tx, ctx.userId),
  }));
}

const ownerOf = (change: ChangeRecord): string | null =>
  ENTITIES[change.entity as EntityName]?.patientIdOf?.(change.data ?? {}, change.entityId) ?? null;

/**
 * A patient above the user's level never reaches the device: a change to such
 * a record tells the device to drop it (it may hold an older copy, from before
 * the record was marked), and the rows attached to it are not sent.
 */
async function applySensitivity(
  ctx: RequestContext & { deviceId: string },
  changes: ChangeRecord[],
  max: PatientSensitivity,
): Promise<ChangeRecord[]> {
  if (max === 'restricted') return changes;
  const owners = changes
    .filter((c) => c.entity !== 'patient')
    .map(ownerOf)
    .filter((id): id is string => id !== null);
  const levels = await patientSensitivities(database().db, ctx, [...new Set(owners)]);
  return changes.flatMap((change): ChangeRecord[] => {
    if (change.entity === 'patient') {
      if (!change.data || sensitivityAllowed(change.data.sensitivity, max)) return [change];
      return [{ ...change, data: null, evict: true }];
    }
    const owner = ownerOf(change);
    const level = owner ? levels.get(owner) : undefined;
    return level === undefined || sensitivityAllowed(level, max) ? [change] : [];
  });
}

/**
 * A retired device may send its pending operations once (final push) when the
 * administrator allowed it; any other contact gets DEVICE_REVOKED, ends the
 * device sessions and makes the client wipe its local data.
 */
async function activeDevice(ctx: RequestContext, deviceId: string, purpose: 'push' | 'pull') {
  const device = await loadDevice(database().db, ctx, deviceId);
  if (!device || device.userId !== ctx.userId) throw new AppError('DEVICE_UNKNOWN', 403);
  if (device.status === 'active') return device;
  if (purpose === 'push' && device.status === 'revoked' && device.allowFinalPush) return device;
  await endDeviceSessions(database().db, ctx, device.id);
  throw new AppError('DEVICE_REVOKED', 403);
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
  const device = await activeDevice(ctx, request.deviceId, 'push');
  const { permissions } = await accessOf(ctx);
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
  const device = await activeDevice(ctx, input.deviceId, 'pull');
  const { permissions, sensitivityMax, scope } = await accessOf(ctx);
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
  const readable = response.changes.filter(
    (change) =>
      (READ_PERMISSION[change.entity] ?? []).some((key) => permissions.has(key)) &&
      // Favourites are personal: only their owner receives them.
      (change.entity !== 'patient_favorite' || change.data?.userId === ctx.userId),
  );
  const allowed = await applySensitivity({ ...ctx, deviceId: device.id }, readable, sensitivityMax);
  response.changes = await withTenant(
    database().db,
    { tenantId: ctx.tenantId, userId: ctx.userId, deviceId: device.id },
    (tx) =>
      applyPatientScope(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId, deviceId: device.id },
        allowed,
        scope,
        new Date(now),
      ),
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
