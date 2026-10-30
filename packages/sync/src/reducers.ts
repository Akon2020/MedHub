import { ENTITIES, type EntityName } from '@medhub/domain';
import { compareHlc } from '@medhub/shared';

export type FieldMeta = Record<string, { hlc: string; v: number }>;

/**
 * Entity state shared by the server store and the client store. `version` is the
 * server version (0 on the client until the server has acknowledged the entity).
 */
export type EntityState = {
  id: string;
  version: number;
  data: Record<string, unknown>;
  fieldMeta: FieldMeta;
  hlc: string;
  opId: string;
  deviceId: string;
  createdBy: string;
};

export type FieldConflict = { field: string; serverValue: unknown; clientValue: unknown };

export type MergeOutcome = {
  next: EntityState;
  applied: string[];
  skipped: string[];
  conflicts: FieldConflict[];
};

type OpLike = {
  opId: string;
  hlc: string;
  deviceId: string;
  userId: string;
  baseVersion: number | null;
};

export function deriveData(
  entity: EntityName,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const derive = ENTITIES[entity].derive;
  return derive ? { ...data, ...derive(data) } : data;
}

export function createState(
  entity: EntityName,
  entityId: string,
  op: OpLike,
  payload: Record<string, unknown>,
  version: number,
): EntityState {
  const data = deriveData(entity, stripUndefined(payload));
  const fieldMeta: FieldMeta = {};
  for (const key of Object.keys(payload)) fieldMeta[key] = { hlc: op.hlc, v: version };
  return {
    id: entityId,
    version,
    data,
    fieldMeta,
    hlc: op.hlc,
    opId: op.opId,
    deviceId: op.deviceId,
    createdBy: op.userId,
  };
}

/**
 * Field-level last-writer-wins by HLC. When `sensitiveFields` is given, a write
 * based on a stale version to a field that changed since that version keeps the
 * current value and is reported as a conflict instead of being merged.
 */
export function mergeFields(
  entity: EntityName,
  current: EntityState,
  op: OpLike,
  payload: Record<string, unknown>,
  nextVersion: number,
  sensitiveFields?: ReadonlySet<string>,
): MergeOutcome {
  const data = { ...current.data };
  const fieldMeta: FieldMeta = { ...current.fieldMeta };
  const applied: string[] = [];
  const skipped: string[] = [];
  const conflicts: FieldConflict[] = [];

  for (const [field, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const meta = fieldMeta[field];
    const stale = op.baseVersion !== null && meta !== undefined && meta.v > op.baseVersion;
    if (sensitiveFields?.has(field) && stale && !sameValue(data[field], value)) {
      conflicts.push({ field, serverValue: data[field] ?? null, clientValue: value });
      continue;
    }
    if (meta === undefined || compareHlc(op.hlc, meta.hlc) > 0) {
      data[field] = value;
      fieldMeta[field] = { hlc: op.hlc, v: nextVersion };
      applied.push(field);
    } else {
      skipped.push(field);
    }
  }

  const changed = applied.length > 0;
  return {
    next: {
      ...current,
      data: changed ? deriveData(entity, data) : data,
      fieldMeta,
      version: changed ? nextVersion : current.version,
      hlc: changed && (!current.hlc || compareHlc(op.hlc, current.hlc) > 0) ? op.hlc : current.hlc,
      opId: changed ? op.opId : current.opId,
    },
    applied,
    skipped,
    conflicts,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}
