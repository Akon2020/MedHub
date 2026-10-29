import { OP_STATUSES, type OpStatus } from '@medhub/shared';
import { z } from 'zod';

export const SYNC_SCHEMA_VERSION = 1;
/** The API accepts the current schema version and the previous one. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [SYNC_SCHEMA_VERSION];
export const MAX_PUSH_OPS = 200;
export const MAX_PUSH_BYTES = 512 * 1024;
export const DEFAULT_PULL_LIMIT = 200;
export const MAX_PULL_LIMIT = 500;
/** Look-back that catches change_log rows committed out of sequence order. */
export const PULL_LOOKBACK_SEQ = 500;
export const PULL_LOOKBACK_MS = 2 * 60 * 1000;

export const operationSchema = z.object({
  opId: z.uuid(),
  tenantId: z.uuid(),
  siteId: z.uuid().nullable(),
  deviceId: z.uuid(),
  userId: z.uuid(),
  command: z.string().min(3).max(80),
  entity: z.string().min(1).max(80),
  entityId: z.uuid(),
  baseVersion: z.number().int().nonnegative().nullable(),
  payload: z.unknown(),
  hlc: z.string().min(5).max(120),
  clientTs: z.iso.datetime(),
  schemaVersion: z.number().int().positive(),
  dependsOn: z.array(z.uuid()).max(20).optional(),
  clockSuspect: z.boolean().optional(),
  signature: z.string().max(200),
});
export type Operation = z.infer<typeof operationSchema>;
export type UnsignedOperation = Omit<Operation, 'signature'>;

export const pushRequestSchema = z.object({
  deviceId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  ops: z.array(z.unknown()).max(MAX_PUSH_OPS),
});
export type PushRequest = { deviceId: string; schemaVersion: number; ops: Operation[] };

export const opResultSchema = z.object({
  opId: z.string(),
  status: z.enum(OP_STATUSES),
  reason: z.string().optional(),
  serverVersion: z.number().int().optional(),
  assigned: z
    .object({ officialNumber: z.string().optional(), mrn: z.string().optional() })
    .optional(),
  conflictId: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});
export type OpResult = {
  opId: string;
  status: OpStatus;
  reason?: string;
  serverVersion?: number;
  assigned?: { officialNumber?: string; mrn?: string };
  conflictId?: string;
  warnings?: string[];
};

export type PushResponse = {
  results: OpResult[];
  serverTime: string;
  licenseToken?: string;
};

export type ChangeRecord = {
  seq: number;
  entity: string;
  entityId: string;
  version: number;
  data: Record<string, unknown> | null;
};

export type PullResponse = {
  changes: ChangeRecord[];
  nextCursor: number;
  hasMore: boolean;
  serverTime: string;
};

export type SyncStatusResponse = {
  serverTime: string;
  schemaVersion: number;
  supportedSchemaVersions: readonly number[];
  minClientVersion: string;
  pendingServerOps: number;
};
