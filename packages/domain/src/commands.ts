import type { ConflictStrategy } from '@medhub/shared';
import type { z } from 'zod';
import { checkVitalPlausibility, vitalSignRecordPayload } from './dpi/vital-signs';
import {
  patientRegisterPayload,
  patientSearchFields,
  patientUpdatePayload,
  type PatientNameParts,
} from './pat/commands';
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
      patientSearchFields(data as PatientNameParts & { phone?: string; mrn?: string }),
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
  'vital_sign.record': define({
    name: 'vital_sign.record',
    entity: 'vital_sign',
    kind: 'append',
    payloadSchema: vitalSignRecordPayload,
    permission: 'vital_sign:record',
    onlineOnly: false,
    check: (p) => {
      const result = checkVitalPlausibility(p);
      return result.ok ? null : result.reason;
    },
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
export type CommandPayload<N extends CommandName> = z.infer<(typeof COMMANDS)[N]['payloadSchema']>;

export function getCommand(name: string): CommandDefinition | undefined {
  return (COMMANDS as Record<string, CommandDefinition>)[name];
}
