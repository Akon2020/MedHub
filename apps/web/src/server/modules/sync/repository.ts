import 'server-only';
import { appendAudit, enqueue, schema, withTenant, type Db, type Tx } from '@medhub/db';
import { ENTITIES, getCommand, type EntityName, type PatientRegisterPayload } from '@medhub/domain';
import type { StockMovementKind } from '@medhub/shared';
import { formatHlc, uuidv7 } from '@medhub/shared';
import { createState, type EntityState, type OpResult, type Operation } from '@medhub/sync';
import {
  DuplicateOperationError,
  type ChangeEntry,
  type ChangeRow,
  type ConflictEntry,
  type ServerPullStore,
  type ServerSyncStore,
  type ServerSyncTx,
} from '@medhub/sync/server';
import { and, asc, eq, gt, gte, inArray, isNull, lte } from 'drizzle-orm';

type Ctx = { tenantId: string; userId: string; deviceId: string | null };

function compact(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Mapping between the domain entity state and the PostgreSQL rows, one per entity. */
const mappers = {
  patient: {
    table: schema.patient,
    toState(row: typeof schema.patient.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          mrn: row.mrn,
          familyName: row.familyName,
          middleName: row.middleName,
          givenName: row.givenName,
          sex: row.sex,
          birthDate: row.birthDate,
          birthDateEstimated: row.birthDateEstimated,
          phone: row.phone,
          sensitivity: row.sensitivity,
          searchText: row.searchText,
          phoneticKey: row.phoneticKey,
        }),
        fieldMeta: row.fieldMeta,
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.patient.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        mrn: String(d.mrn),
        familyName: String(d.familyName),
        middleName: str(d.middleName),
        givenName: str(d.givenName),
        sex: String(d.sex),
        birthDate: str(d.birthDate),
        birthDateEstimated: d.birthDateEstimated === true,
        phone: str(d.phone),
        sensitivity: str(d.sensitivity) ?? 'normal',
        searchText: String(d.searchText ?? ''),
        phoneticKey: String(d.phoneticKey ?? ''),
        fieldMeta: state.fieldMeta,
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      };
    },
  },
  vital_sign: {
    table: schema.vitalSign,
    toState(row: typeof schema.vitalSign.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          patientId: row.patientId,
          encounterId: row.encounterId,
          code: row.code,
          value: row.value,
          unit: row.unit,
          measuredAt: row.measuredAt.toISOString(),
          supersedesId: row.supersedesId,
          plausibilityOverrideReason: row.plausibilityOverrideReason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.vitalSign.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        patientId: String(d.patientId),
        encounterId: str(d.encounterId),
        code: String(d.code),
        value: Number(d.value),
        unit: String(d.unit),
        measuredAt: new Date(String(d.measuredAt)),
        measuredBy: state.createdBy || null,
        supersedesId: str(d.supersedesId),
        plausibilityOverrideReason: str(d.plausibilityOverrideReason),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
  stock_movement: {
    table: schema.stockMovement,
    toState(row: typeof schema.stockMovement.$inferSelect): EntityState {
      return {
        id: row.id,
        version: row.version,
        data: compact({
          warehouseId: row.warehouseId,
          productId: row.productId,
          lotId: row.lotId,
          kind: row.kind,
          quantity: row.quantity,
          reason: row.reason,
          status: row.status,
        }),
        fieldMeta: {},
        hlc: row.hlc ?? '',
        opId: row.opId ?? '',
        deviceId: row.deviceId ?? '',
        createdBy: row.createdBy ?? '',
      };
    },
    toRow(state: EntityState, ctx: Ctx): typeof schema.stockMovement.$inferInsert {
      const d = state.data;
      return {
        id: state.id,
        tenantId: ctx.tenantId,
        version: state.version,
        warehouseId: String(d.warehouseId),
        productId: String(d.productId),
        lotId: str(d.lotId),
        kind: String(d.kind),
        quantity: Number(d.quantity),
        reason: str(d.reason),
        status: str(d.status) ?? 'active',
        hlc: state.hlc,
        opId: state.opId || null,
        deviceId: state.deviceId || null,
        createdBy: state.createdBy || null,
      };
    },
  },
} as const;

async function getEntity(tx: Tx, entity: EntityName, id: string): Promise<EntityState | null> {
  switch (entity) {
    case 'patient': {
      const [row] = await tx
        .select()
        .from(schema.patient)
        .where(eq(schema.patient.id, id))
        .limit(1);
      return row ? mappers.patient.toState(row) : null;
    }
    case 'vital_sign': {
      const [row] = await tx
        .select()
        .from(schema.vitalSign)
        .where(eq(schema.vitalSign.id, id))
        .limit(1);
      return row ? mappers.vital_sign.toState(row) : null;
    }
    case 'stock_movement': {
      const [row] = await tx
        .select()
        .from(schema.stockMovement)
        .where(eq(schema.stockMovement.id, id))
        .limit(1);
      return row ? mappers.stock_movement.toState(row) : null;
    }
  }
}

async function getEntities(tx: Tx, entity: EntityName, ids: string[]): Promise<EntityState[]> {
  if (ids.length === 0) return [];
  switch (entity) {
    case 'patient':
      return (await tx.select().from(schema.patient).where(inArray(schema.patient.id, ids))).map(
        (r) => mappers.patient.toState(r),
      );
    case 'vital_sign':
      return (
        await tx.select().from(schema.vitalSign).where(inArray(schema.vitalSign.id, ids))
      ).map((r) => mappers.vital_sign.toState(r));
    case 'stock_movement':
      return (
        await tx.select().from(schema.stockMovement).where(inArray(schema.stockMovement.id, ids))
      ).map((r) => mappers.stock_movement.toState(r));
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === '23505' && (pg.constraint === constraint || pg.constraint === undefined);
}

const AUDIT_ACTION: Record<string, string> = {
  create: 'create',
  update: 'update',
  append: 'create',
};

function syncTx(tx: Tx, ctx: Ctx): ServerSyncTx {
  return {
    async findOpResult(opId) {
      const [row] = await tx
        .select({ result: schema.opLog.result })
        .from(schema.opLog)
        .where(eq(schema.opLog.opId, opId))
        .limit(1);
      return row ? (row.result as OpResult) : null;
    },
    async saveOp(op: Operation, result: OpResult) {
      try {
        await tx.insert(schema.opLog).values({
          opId: op.opId,
          tenantId: ctx.tenantId,
          deviceId: op.deviceId,
          userId: op.userId,
          command: op.command,
          entity: op.entity,
          entityId: op.entityId,
          payload: op.payload as Record<string, unknown>,
          hlc: op.hlc,
          clientTs: new Date(op.clientTs),
          status: result.status,
          result,
          schemaVersion: op.schemaVersion,
          signature: op.signature,
          clockSuspect: op.clockSuspect === true,
        });
      } catch (error) {
        if (isUniqueViolation(error, 'op_log_pkey')) throw new DuplicateOperationError();
        throw error;
      }
      if (result.status !== 'rejected') {
        const kind = getCommand(op.command)?.kind ?? 'update';
        const payload = op.payload as Record<string, unknown>;
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          userId: op.userId,
          deviceId: op.deviceId,
          action: AUDIT_ACTION[kind] ?? 'update',
          entity: op.entity,
          entityId: op.entityId,
          patientId:
            op.entity === 'patient'
              ? op.entityId
              : typeof payload.patientId === 'string'
                ? payload.patientId
                : null,
          diff: { command: op.command, opId: op.opId, status: result.status },
        });
      }
    },
    getEntity: (entity, id) => getEntity(tx, entity, id),
    async insertEntity(entity, state) {
      switch (entity) {
        case 'patient':
          await tx.insert(schema.patient).values(mappers.patient.toRow(state, ctx));
          // Duplicates are looked for in the background, so that a push stays short.
          await enqueue(
            tx,
            'pat.detect_duplicates',
            { patientId: state.id },
            {
              tenantId: ctx.tenantId,
            },
          );
          return;
        case 'vital_sign':
          await tx.insert(schema.vitalSign).values(mappers.vital_sign.toRow(state, ctx));
          return;
        case 'stock_movement':
          await tx.insert(schema.stockMovement).values(mappers.stock_movement.toRow(state, ctx));
          return;
      }
    },
    async updateEntity(entity, state) {
      switch (entity) {
        case 'patient': {
          const {
            id: _id,
            tenantId: _t,
            createdBy: _c,
            ...row
          } = mappers.patient.toRow(state, ctx);
          await tx.update(schema.patient).set(row).where(eq(schema.patient.id, state.id));
          return;
        }
        case 'vital_sign':
          await tx
            .update(schema.vitalSign)
            .set({
              status: String(state.data.status ?? 'active'),
              version: state.version,
              opId: state.opId,
            })
            .where(eq(schema.vitalSign.id, state.id));
          return;
        case 'stock_movement':
          throw new Error('stock_movement rows are immutable');
      }
    },
    async appendChange(change: ChangeEntry) {
      await tx.insert(schema.changeLog).values({
        tenantId: ctx.tenantId,
        entity: change.entity,
        entityId: change.entityId,
        version: change.version,
        opId: change.opId,
        scopeKeys: change.scopeKeys,
      });
    },
    async createConflict(conflict: ConflictEntry) {
      const id = uuidv7();
      await tx.insert(schema.syncConflict).values({
        id,
        tenantId: ctx.tenantId,
        entity: conflict.entity,
        entityId: conflict.entityId,
        opId: conflict.opId,
        kind: conflict.kind,
        serverValue: Object.fromEntries(conflict.conflicts.map((c) => [c.field, c.serverValue])),
        clientValue: Object.fromEntries(conflict.conflicts.map((c) => [c.field, c.clientValue])),
      });
      return id;
    },
    async listStockMovements(warehouseId, productId) {
      const rows = await tx
        .select({ kind: schema.stockMovement.kind, quantity: schema.stockMovement.quantity })
        .from(schema.stockMovement)
        .where(
          and(
            eq(schema.stockMovement.warehouseId, warehouseId),
            eq(schema.stockMovement.productId, productId),
          ),
        );
      return rows.map((r) => ({ kind: r.kind as StockMovementKind, quantity: r.quantity }));
    },
  };
}

/** PostgreSQL implementation of the sync engine ports, always inside withTenant. */
export function pgSyncStore(db: Db, ctx: Ctx): ServerSyncStore & ServerPullStore {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId, deviceId: ctx.deviceId }, fn);
  return {
    findOpResult: (opId) => run((tx) => syncTx(tx, ctx).findOpResult(opId)),
    transaction: (fn) => run((tx) => fn(syncTx(tx, ctx))),
    async listChangesAfter(afterSeq, limit) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.changeLog)
          .where(gt(schema.changeLog.seq, afterSeq))
          .orderBy(asc(schema.changeLog.seq))
          .limit(limit);
        return rows.map(toChangeRow);
      });
    },
    async listRecentChanges(fromSeq, toSeq, sinceMs) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.changeLog)
          .where(
            and(
              gt(schema.changeLog.seq, fromSeq),
              lte(schema.changeLog.seq, toSeq),
              gte(schema.changeLog.changedAt, new Date(sinceMs)),
            ),
          )
          .orderBy(asc(schema.changeLog.seq));
        return rows.map(toChangeRow);
      });
    },
    getEntities: (entity, ids) => run((tx) => getEntities(tx, entity, ids)),
  };
}

function toChangeRow(row: typeof schema.changeLog.$inferSelect): ChangeRow {
  return {
    seq: row.seq,
    entity: row.entity as EntityName,
    entityId: row.entityId,
    version: row.version,
    changedAtMs: row.changedAt.getTime(),
  };
}

export async function loadDevice(db: Db, ctx: Ctx, deviceId: string) {
  return withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.device)
      .where(eq(schema.device.id, deviceId))
      .limit(1);
    return row ?? null;
  });
}

export async function touchDevice(db: Db, ctx: Ctx, deviceId: string, synced: boolean) {
  await withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
    tx
      .update(schema.device)
      .set({ lastSeenAt: new Date(), ...(synced ? { lastSyncAt: new Date() } : {}) })
      .where(eq(schema.device.id, deviceId)),
  );
}

export async function endDeviceSessions(db: Db, ctx: Ctx, deviceId: string) {
  await withTenant(db, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
    tx
      .update(schema.session)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.session.deviceId, deviceId), isNull(schema.session.revokedAt))),
  );
}

/**
 * Patients created by the server itself (fictitious patients of a training
 * base): same row and change log entry as a synchronised registration, so that
 * devices download them with their next pull.
 */
export async function insertServerPatients(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  payloads: readonly PatientRegisterPayload[],
): Promise<number> {
  const node = 'server';
  let physical = Date.now();
  for (const payload of payloads) {
    const id = uuidv7();
    const opId = uuidv7();
    const hlc = formatHlc({ physical: physical++, counter: 0, node });
    const state = createState(
      'patient',
      id,
      { hlc, opId, deviceId: '', userId: ctx.userId, baseVersion: null },
      payload as unknown as Record<string, unknown>,
      1,
    );
    await tx
      .insert(schema.patient)
      .values(mappers.patient.toRow(state, { ...ctx, deviceId: null }));
    await tx.insert(schema.changeLog).values({
      tenantId: ctx.tenantId,
      entity: 'patient',
      entityId: id,
      version: 1,
      opId,
      scopeKeys: ENTITIES.patient.scopeKeys(state.data, id),
    });
  }
  return payloads.length;
}
