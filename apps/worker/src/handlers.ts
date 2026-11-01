import {
  purgeRateLimits,
  schema,
  verifyAuditChain,
  withSystem,
  withTenant,
  type Db,
} from '@medhub/db';
import { detectDuplicates } from './duplicates';

export type JobContext = {
  db: Db;
  tenantId: string | null;
  payload: Record<string, unknown>;
  log: (message: string) => void;
};

export type JobHandler = (ctx: JobContext) => Promise<void>;

/**
 * Registry of background jobs. Modules add their handlers here as they are
 * built (SMS, reminders, expiry alerts, backups...). Unknown types fail the job.
 */
export const HANDLERS: Record<string, JobHandler> = {
  'system.ping': async ({ log }) => {
    log('ping');
  },

  /** Daily integrity check of every structure's audit hash chain. */
  'audit.verify_chains': async ({ db, log }) => {
    const tenants = await withSystem(db, (tx) =>
      tx.select({ id: schema.tenant.id }).from(schema.tenant),
    );
    const broken: string[] = [];
    for (const { id } of tenants) {
      const result = await withTenant(db, { tenantId: id, userId: null }, (tx) =>
        verifyAuditChain(tx, id),
      );
      if (!result.ok) broken.push(id);
    }
    if (broken.length > 0) {
      throw new Error(`AUDIT_CHAIN_BROKEN:${broken.length}`);
    }
    log(`audit chains verified for ${tenants.length} structures`);
  },

  /** Enqueued by each synchronised patient registration (docs/modules/pat.md). */
  'pat.detect_duplicates': async ({ db, tenantId, payload, log }) => {
    const patientId = typeof payload.patientId === 'string' ? payload.patientId : null;
    if (!tenantId || !patientId) throw new Error('PAYLOAD_INVALID');
    const found = await detectDuplicates(db, tenantId, patientId);
    log(`${found} duplicate candidates recorded`);
  },

  'security.purge_rate_limits': async ({ db, log }) => {
    const removed = await withSystem(db, (tx) => purgeRateLimits(tx));
    log(`${removed} stale rate limit windows removed`);
  },
};

/** Recurring jobs created on first run; editable afterwards in `job_schedule`. */
export const DEFAULT_SCHEDULES: { type: string; cron: string }[] = [
  { type: 'audit.verify_chains', cron: '30 1 * * *' },
  { type: 'security.purge_rate_limits', cron: '15 * * * *' },
];
