import { createHash } from 'node:crypto';
import { canonicalJson, uuidv7 } from '@medhub/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { auditLog } from './schema';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export type AuditEntry = {
  tenantId: string;
  userId: string | null;
  deviceId?: string | null;
  ip?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  patientId?: string | null;
  reason?: string | null;
  /** Never clinical content in clear for sensitive categories. */
  diff?: Record<string, unknown> | null;
  at?: Date;
};

type HashedFields = Omit<typeof auditLog.$inferInsert, 'hash'>;

export function auditHash(prevHash: string, row: HashedFields): string {
  const material = canonicalJson({
    ...row,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
  });
  return createHash('sha256').update(prevHash).update(material).digest('hex');
}

/**
 * Appends one link to the per-structure hash chain. The advisory lock serializes
 * writers of the same structure so that `seq` and `prev_hash` stay consistent.
 */
export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${entry.tenantId}))`);
  const [last] = await tx
    .select({ seq: auditLog.seq, hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.tenantId, entry.tenantId))
    .orderBy(desc(auditLog.seq))
    .limit(1);

  const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;
  const row: HashedFields = {
    id: uuidv7(),
    tenantId: entry.tenantId,
    seq: (last?.seq ?? 0) + 1,
    at: entry.at ?? new Date(),
    userId: entry.userId,
    deviceId: entry.deviceId ?? null,
    ip: entry.ip ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    patientId: entry.patientId ?? null,
    reason: entry.reason ?? null,
    diff: entry.diff ?? null,
    prevHash,
  };
  await tx.insert(auditLog).values({ ...row, hash: auditHash(prevHash, row) });
}

export type ChainCheck = { ok: true; checked: number } | { ok: false; brokenAtSeq: number };

/** Recomputes the chain of the current structure; a mismatch means tampering. */
export async function verifyAuditChain(tx: Tx, tenantId: string): Promise<ChainCheck> {
  const rows = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(auditLog.seq);
  let prev = AUDIT_GENESIS_HASH;
  for (const row of rows) {
    const { hash, ...fields } = row;
    if (fields.prevHash !== prev || auditHash(prev, fields) !== hash) {
      return { ok: false, brokenAtSeq: row.seq };
    }
    prev = hash;
  }
  return { ok: true, checked: rows.length };
}
