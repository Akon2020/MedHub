import type { ConflictStrategy } from '@medhub/shared';
import type { z } from 'zod';
import { checkVitalPlausibility, vitalSignRecordPayload } from './dpi/vital-signs';
import {
  patientRegisterPayload,
  patientSearchFields,
  patientUpdatePayload,
  type PatientNameParts,
} from './pat/commands';
import { blockedByDeath, patientDeathPayload } from './pat/lifecycle';
import { stockMovementRecordPayload } from './phar/stock';

export type EntityName = 'patient' | 'vital_sign' | 'stock_movement';

export type EntityDefinition = {
  name: EntityName;
  strategy: ConflictStrategy;
  /** Recomputes derived columns after any change, identically on client and server. */
  derive?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Keys used by the pull filter to decide which devices receive a change. */
  scopeKeys: (data: Record<string, unknown>, entityId: string) => string[];
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
  },
  vital_sign: {
    name: 'vital_sign',
    strategy: 'append_only',
    scopeKeys: (data) => [`patient:${String(data.patientId)}`],
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

export function getCommand(name: string): CommandDefinition | undefined {
  return (COMMANDS as Record<string, CommandDefinition>)[name];
}
