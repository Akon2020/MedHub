import 'server-only';
import { withTenant } from '@medhub/db';
import type { PatientScopeRule } from '@medhub/domain';
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
import { endDeviceSessions, loadDevice, pgSyncStore, touchDevice } from './repository';
import { applyPatientScope, loadPatientScope } from './scope';

/** Entities a user may receive on pull, by read permission. */
const READ_PERMISSION: Record<string, readonly string[]> = {
  patient: ['patient:read'],
  patient_favorite: ['patient:read'],
  break_glass: ['clinical_record:break_glass'],
  encounter: ['encounter:read'],
  queue_ticket: ['queue:read'],
  triage: ['triage:read', 'clinical_record:read'],
  appointment: ['appointment:read'],
  allergy: ['clinical_record:read'],
  medical_history: ['clinical_record:read'],
  problem: ['clinical_record:read'],
  program_enrollment: ['clinical_record:read'],
  clinical_note: ['clinical_record:read'],
  diagnosis: ['diagnosis:read', 'clinical_record:read'],
  form_response: ['clinical_record:read'],
  prescription: ['prescription:read', 'clinical_record:read'],
  medication_statement: ['clinical_record:read'],
  medication_reconciliation: ['clinical_record:read'],
  invoice: ['invoice:read'],
  invoice_line: ['invoice:read'],
  payment: ['payment:read', 'invoice:read'],
  approval_request: ['invoice:read', 'approval:decide'],
  discount_grant: ['invoice:read'],
  credit_note: ['invoice:read'],
  cash_session: ['cash_session:open', 'cash_session:review'],
  vital_sign: ['vital_sign:read', 'clinical_record:read'],
  stock_movement: ['stock:read'],
};

async function accessOf(
  ctx: RequestContext,
): Promise<{ permissions: Set<string>; scope: PatientScopeRule }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => ({
    permissions: await loadPermissions(tx, ctx.userId),
    scope: await loadPatientScope(tx, ctx.userId),
  }));
}

/** Personal rows travel back to their owner only. */
const PERSONAL = new Set(['patient_favorite', 'break_glass']);

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
  const { permissions, scope } = await accessOf(ctx);
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
      (!PERSONAL.has(change.entity) || change.data?.userId === ctx.userId),
  );
  // Sensitive records travel too, encrypted on the device and locked behind an
  // emergency access there, so that break glass works offline (P10).
  const allowed = readable;
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
