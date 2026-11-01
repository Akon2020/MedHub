import type { ConflictStrategy } from '@medhub/shared';
import type { z } from 'zod';
import { checkVitalPlausibility, vitalSignRecordPayload } from './dpi/vital-signs';
import {
  patientRegisterPayload,
  patientSearchFields,
  patientSensitivityPayload,
  patientUpdatePayload,
  type PatientNameParts,
} from './pat/commands';
import { patientFavoritePayload } from './pat/favorites';
import { blockedByDeath, patientDeathPayload } from './pat/lifecycle';
import { stockMovementRecordPayload } from './phar/stock';

export type EntityName = 'patient' | 'vital_sign' | 'stock_movement' | 'patient_favorite';

export type EntityDefinition = {
  name: EntityName;
  strategy: ConflictStrategy;
  /** Recomputes derived columns after any change, identically on client and server. */
  derive?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Keys used by the pull filter to decide which devices receive a change. */
  scopeKeys: (data: Record<string, unknown>, entityId: string) => string[];
  /** The patient a row belongs to: it follows that patient's access rules and scope. */
  patientIdOf?: (data: Record<string, unknown>, entityId: string) => string | null;
};

export const ENTITIES: Record<EntityName, EntityDefinition> = {
  patient: {
    name: 'patient',
    strategy: 'field_merge',
    derive: (data) =>
      patientSearchFields(
        data as PatientNameParts & {
          phone?: string;
          mrn?: string;
          fatherName?: string;
          motherName?: string;
        },
      ),
    scopeKeys: (_data, id) => [`patient:${id}`],
    patientIdOf: (_data, id) => id,
  },
  vital_sign: {
    name: 'vital_sign',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  patient_favorite: {
    name: 'patient_favorite',
    strategy: 'union',
    // Only the user who marked it receives it: the pull filters on userId.
    scopeKeys: (data) => [`user:${String(data.userId)}`],
    patientIdOf: (data) => (typeof data.patientId === 'string' ? data.patientId : null),
  },
  stock_movement: {
    name: 'stock_movement',
    strategy: 'movements',
    scopeKeys: (data) => [`warehouse:${String(data.warehouseId)}`],
  },
};

export type CommandKind = 'create' | 'update' | 'append';

export type CommandDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  entity: EntityName;
  kind: CommandKind;
  payloadSchema: S;
  permission: string;
  onlineOnly: boolean;
  /** Business rule check shared by client (before dispatch) and server (before apply). */
  check?: (payload: z.infer<S>) => string | null;
  /** Payload keys kept in the operation log only, never merged into the entity. */
  transientFields?: readonly string[];
  /** A clinical act on a patient: refused after the patient's recorded death. */
  patientAct?: (payload: z.infer<S>) => { patientId: string; at: string };
};

function define<S extends z.ZodType>(def: CommandDefinition<S>): CommandDefinition<S> {
  return def;
}

export const COMMANDS = {
  'patient.register': define({
    name: 'patient.register',
    entity: 'patient',
    kind: 'create',
    payloadSchema: patientRegisterPayload,
    permission: 'patient:create',
    onlineOnly: false,
  }),
  'patient.update': define({
    name: 'patient.update',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientUpdatePayload,
    permission: 'patient:update',
    onlineOnly: false,
  }),
  'patient.mark_deceased': define({
    name: 'patient.mark_deceased',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientDeathPayload,
    permission: 'patient:mark_deceased',
    onlineOnly: false,
    transientFields: ['correctionReason'],
  }),
  'patient.set_sensitivity': define({
    name: 'patient.set_sensitivity',
    entity: 'patient',
    kind: 'update',
    payloadSchema: patientSensitivityPayload,
    permission: 'patient:mark_sensitive',
    onlineOnly: false,
    transientFields: ['sensitivityReason'],
  }),
  'patient.favorite': define({
    name: 'patient.favorite',
    entity: 'patient_favorite',
    kind: 'append',
    payloadSchema: patientFavoritePayload,
    permission: 'patient:read',
    onlineOnly: false,
  }),
  'vital_sign.record': define({
    name: 'vital_sign.record',
    entity: 'vital_sign',
    kind: 'append',
    payloadSchema: vitalSignRecordPayload,
    permission: 'vital_sign:create',
    onlineOnly: false,
    check: (p) => {
      const result = checkVitalPlausibility(p);
      return result.ok ? null : result.reason;
    },
    patientAct: (p) => ({ patientId: p.patientId, at: p.measuredAt }),
  }),
  'stock_movement.record': define({
    name: 'stock_movement.record',
    entity: 'stock_movement',
    kind: 'append',
    payloadSchema: stockMovementRecordPayload,
    permission: 'stock:move',
    onlineOnly: false,
  }),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandPayload<N extends CommandName> = z.input<(typeof COMMANDS)[N]['payloadSchema']>;

/** Refusal code when a clinical act targets a patient already declared dead. */
export function deathRefusal(
  command: CommandDefinition,
  payload: unknown,
  patient: Record<string, unknown> | null | undefined,
): string | null {
  if (!command.patientAct || !patient) return null;
  const act = command.patientAct(payload as never);
  return blockedByDeath(patient.deceasedAt, act.at) ? 'PAT_DECEASED' : null;
}

/** The part of a payload that is merged into the entity. */
export function mergeablePayload(
  command: CommandDefinition,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!command.transientFields?.length) return payload;
  const out = { ...payload };
  for (const key of command.transientFields) delete out[key];
  return out;
}

export function getCommand(name: string): CommandDefinition | undefined {
  return (COMMANDS as Record<string, CommandDefinition>)[name];
}
