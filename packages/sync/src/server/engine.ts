import {
  COMMANDS,
  ENTITIES,
  PATIENT_SENSITIVE_FIELDS,
  getCommand,
  stockBalance,
  type EntityName,
} from '@medhub/domain';
import type { StockMovementKind } from '@medhub/shared';
import {
  MAX_PUSH_BYTES,
  SUPPORTED_SCHEMA_VERSIONS,
  operationSchema,
  type OpResult,
  type Operation,
  type PushResponse,
} from '../protocol';
import { createState, mergeFields, type EntityState, type FieldConflict } from '../reducers';
import { verifyOperation } from '../signing';

export type ChangeEntry = {
  entity: EntityName;
  entityId: string;
  version: number;
  opId: string;
  scopeKeys: string[];
};

export type ConflictEntry = {
  entity: EntityName;
  entityId: string;
  opId: string;
  kind: 'sensitive_field';
  conflicts: FieldConflict[];
};

/** Raised by a store when the op_log unique constraint fires inside a transaction. */
export class DuplicateOperationError extends Error {
  constructor() {
    super('DUPLICATE_OPERATION');
  }
}

export interface ServerSyncTx {
  findOpResult(opId: string): Promise<OpResult | null>;
  saveOp(op: Operation, result: OpResult): Promise<void>;
  getEntity(entity: EntityName, id: string): Promise<EntityState | null>;
  insertEntity(entity: EntityName, state: EntityState): Promise<void>;
  updateEntity(entity: EntityName, state: EntityState): Promise<void>;
  appendChange(change: ChangeEntry): Promise<void>;
  createConflict(conflict: ConflictEntry): Promise<string>;
  listStockMovements(
    warehouseId: string,
    productId: string,
  ): Promise<{ kind: StockMovementKind; quantity: number }[]>;
}

export interface ServerSyncStore {
  findOpResult(opId: string): Promise<OpResult | null>;
  transaction<T>(fn: (tx: ServerSyncTx) => Promise<T>): Promise<T>;
}

export type ServerSyncContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
  permissions: ReadonlySet<string>;
  /** Base64 Ed25519 public key of the device; null only in trusted test harnesses. */
  devicePublicKey: string | null;
  serverTime: () => string;
};

class Rejection extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export async function processPush(
  store: ServerSyncStore,
  ctx: ServerSyncContext,
  request: { deviceId: string; schemaVersion: number; ops: unknown[] },
): Promise<PushResponse> {
  const results: OpResult[] = [];
  const statusById = new Map<string, OpResult['status']>();

  for (const raw of request.ops) {
    const result = await processOne(store, ctx, raw, statusById);
    statusById.set(result.opId, result.status);
    results.push(result);
  }
  return { results, serverTime: ctx.serverTime() };
}

export function pushPayloadTooLarge(bodyLength: number): boolean {
  return bodyLength > MAX_PUSH_BYTES;
}

async function processOne(
  store: ServerSyncStore,
  ctx: ServerSyncContext,
  raw: unknown,
  statusById: Map<string, OpResult['status']>,
): Promise<OpResult> {
  const parsed = operationSchema.safeParse(raw);
  const rawId =
    typeof raw === 'object' && raw !== null ? (raw as { opId?: unknown }).opId : undefined;
  if (!parsed.success) {
    return {
      opId: typeof rawId === 'string' ? rawId : '',
      status: 'rejected',
      reason: 'SYNC_PAYLOAD_INVALID',
    };
  }
  const op = parsed.data;

  if (op.tenantId !== ctx.tenantId) return reject(op, 'SYNC_TENANT_MISMATCH');
  if (op.deviceId !== ctx.deviceId) return reject(op, 'DEVICE_UNKNOWN');
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(op.schemaVersion))
    return reject(op, 'SYNC_SCHEMA_UNSUPPORTED');
  if (ctx.devicePublicKey !== null && !verifyOperation(op, ctx.devicePublicKey)) {
    return reject(op, 'SYNC_SIGNATURE_INVALID');
  }

  const known = await store.findOpResult(op.opId);
  if (known) return asDuplicate(known);

  try {
    return await store.transaction(async (tx) => {
      const again = await tx.findOpResult(op.opId);
      if (again) return asDuplicate(again);
      let result: OpResult;
      try {
        result = await applyOperation(tx, ctx, op, statusById);
      } catch (error) {
        if (error instanceof Rejection) {
          result = reject(op, error.reason);
        } else {
          throw error;
        }
      }
      await tx.saveOp(op, result);
      return result;
    });
  } catch (error) {
    if (error instanceof DuplicateOperationError) {
      const stored = await store.findOpResult(op.opId);
      if (stored) return asDuplicate(stored);
    }
    throw error;
  }
}

function reject(op: { opId: string }, reason: string): OpResult {
  return { opId: op.opId, status: 'rejected', reason };
}

function asDuplicate(stored: OpResult): OpResult {
  if (stored.status === 'rejected') return stored;
  return { ...stored, status: 'duplicate' };
}

async function applyOperation(
  tx: ServerSyncTx,
  ctx: ServerSyncContext,
  op: Operation,
  statusById: Map<string, OpResult['status']>,
): Promise<OpResult> {
  const command = getCommand(op.command);
  if (!command) throw new Rejection('SYNC_UNKNOWN_COMMAND');
  if (command.entity !== op.entity) throw new Rejection('SYNC_ENTITY_MISMATCH');
  if (command.onlineOnly) throw new Rejection('SYNC_ONLINE_ONLY');
  if (!ctx.permissions.has(command.permission)) throw new Rejection('PERMISSION_DENIED');

  for (const dep of op.dependsOn ?? []) {
    const status = statusById.get(dep) ?? (await tx.findOpResult(dep))?.status;
    if (status === 'rejected') throw new Rejection('DEPENDENCY_REJECTED');
  }

  const payloadResult = command.payloadSchema.safeParse(op.payload);
  if (!payloadResult.success) throw new Rejection('SYNC_PAYLOAD_INVALID');
  const payload = payloadResult.data as Record<string, unknown>;
  const ruleError = command.check?.(payload);
  if (ruleError) throw new Rejection(ruleError);

  const entity = command.entity;
  switch (command.kind) {
    case 'create':
      return applyCreate(tx, op, entity, payload);
    case 'update':
      return applyUpdate(tx, op, entity, payload);
    case 'append':
      return applyAppend(tx, op, entity, payload);
  }
}

async function applyCreate(
  tx: ServerSyncTx,
  op: Operation,
  entity: EntityName,
  payload: Record<string, unknown>,
): Promise<OpResult> {
  if (await tx.getEntity(entity, op.entityId)) throw new Rejection('VERSION_CONFLICT');
  const state = createState(entity, op.entityId, op, payload, 1);
  await tx.insertEntity(entity, state);
  await recordChange(tx, entity, state, op);
  return { opId: op.opId, status: 'applied', serverVersion: 1 };
}

async function applyUpdate(
  tx: ServerSyncTx,
  op: Operation,
  entity: EntityName,
  payload: Record<string, unknown>,
): Promise<OpResult> {
  const current = await tx.getEntity(entity, op.entityId);
  if (!current) throw new Rejection(entity === 'patient' ? 'PAT_NOT_FOUND' : 'NOT_FOUND');
  const sensitive = entity === 'patient' ? PATIENT_SENSITIVE_FIELDS : undefined;
  const outcome = mergeFields(entity, current, op, payload, current.version + 1, sensitive);

  if (outcome.applied.length > 0) {
    await tx.updateEntity(entity, outcome.next);
    await recordChange(tx, entity, outcome.next, op);
  }

  if (outcome.conflicts.length > 0) {
    const conflictId = await tx.createConflict({
      entity,
      entityId: op.entityId,
      opId: op.opId,
      kind: 'sensitive_field',
      conflicts: outcome.conflicts,
    });
    return {
      opId: op.opId,
      status: 'needs_review',
      serverVersion: outcome.next.version,
      conflictId,
    };
  }
  return {
    opId: op.opId,
    status: outcome.skipped.length > 0 ? 'merged' : 'applied',
    serverVersion: outcome.next.version,
  };
}

async function applyAppend(
  tx: ServerSyncTx,
  op: Operation,
  entity: EntityName,
  payload: Record<string, unknown>,
): Promise<OpResult> {
  if (await tx.getEntity(entity, op.entityId)) throw new Rejection('VERSION_CONFLICT');
  const warnings: string[] = [];
  const strategy = ENTITIES[entity].strategy;

  const state = createState(entity, op.entityId, op, { ...payload, status: 'active' }, 1);

  if (strategy === 'append_only' && typeof payload.supersedesId === 'string') {
    const target = await tx.getEntity(entity, payload.supersedesId);
    if (!target) throw new Rejection('DPI_SUPERSEDED_NOT_FOUND');
    const superseded: EntityState = {
      ...target,
      version: target.version + 1,
      data: { ...target.data, status: 'superseded' },
      opId: op.opId,
    };
    await tx.updateEntity(entity, superseded);
    await recordChange(tx, entity, superseded, op);
  }

  await tx.insertEntity(entity, state);
  await recordChange(tx, entity, state, op);

  if (strategy === 'movements') {
    const movements = await tx.listStockMovements(
      String(payload.warehouseId),
      String(payload.productId),
    );
    if (stockBalance(movements) < 0) warnings.push('PHAR_NEGATIVE_STOCK');
  }

  return {
    opId: op.opId,
    status: 'applied',
    serverVersion: 1,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function recordChange(
  tx: ServerSyncTx,
  entity: EntityName,
  state: EntityState,
  op: Operation,
): Promise<void> {
  await tx.appendChange({
    entity,
    entityId: state.id,
    version: state.version,
    opId: op.opId,
    scopeKeys: ENTITIES[entity].scopeKeys(state.data, state.id),
  });
}

export const SYNC_COMMAND_NAMES = Object.keys(COMMANDS);
