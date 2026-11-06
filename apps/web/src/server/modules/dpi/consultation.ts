import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import { parseDiagnosisCatalog, type DiagnosisCatalogItem } from '@medhub/domain';
import { AppError, parseCsv, uuidv7 } from '@medhub/shared';
import { verifyOperation, type Operation } from '@medhub/sync';
import { asc, eq } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

export async function activeDiagnoses(tx: Tx): Promise<DiagnosisCatalogItem[]> {
  const rows = await tx
    .select({
      code: schema.diagnosisCatalogItem.code,
      label: schema.diagnosisCatalogItem.label,
      codeSystem: schema.diagnosisCatalogItem.codeSystem,
    })
    .from(schema.diagnosisCatalogItem)
    .where(eq(schema.diagnosisCatalogItem.isActive, true))
    .orderBy(asc(schema.diagnosisCatalogItem.code));
  return rows.map((r) => ({ ...r, codeSystem: r.codeSystem === 'local' ? 'local' : 'ICD10' }));
}

/**
 * Imports the structure's diagnosis list (CSV: code, label, optional system).
 * Without `apply` it only checks; with it, valid rows are added or renamed.
 */
export async function importDiagnoses(
  ctx: RequestContext,
  input: { csv: string; apply: boolean },
  client: { ip: string | null },
): Promise<{ items: number; errors: { line: number; message: string }[]; total: number }> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    const { items, errors } = parseDiagnosisCatalog(parseCsv(input.csv));
    if (input.apply) {
      await requireRecentStepUp(tx, ctx);
      if (errors.length > 0)
        throw new AppError('VALIDATION_FAILED', 400, { errors: errors.length });
      for (const item of items) {
        await tx
          .insert(schema.diagnosisCatalogItem)
          .values({ id: uuidv7(), tenantId: ctx.tenantId, ...item })
          .onConflictDoUpdate({
            target: [
              schema.diagnosisCatalogItem.tenantId,
              schema.diagnosisCatalogItem.codeSystem,
              schema.diagnosisCatalogItem.code,
            ],
            set: { label: item.label, isActive: true, updatedAt: new Date() },
          });
      }
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'import',
        entity: 'diagnosis_catalog_item',
        entityId: null,
        diff: { rows: items.length },
      });
    }
    return {
      items: items.length,
      errors,
      total: (await activeDiagnoses(tx)).length,
    };
  });
}

/**
 * Proof of a signed note: the stored operation verifies with the public key of
 * the device that sent it, and its payload is the note's content.
 */
export async function verifyNoteSignature(tx: Tx, noteId: string): Promise<boolean> {
  const [note] = await tx
    .select()
    .from(schema.clinicalNote)
    .where(eq(schema.clinicalNote.id, noteId))
    .limit(1);
  if (!note?.signedOperation) return false;
  const op = note.signedOperation as unknown as Operation;
  const [device] = await tx
    .select({ publicKey: schema.device.publicKey })
    .from(schema.device)
    .where(eq(schema.device.id, op.deviceId))
    .limit(1);
  if (!device?.publicKey) return false;
  const payload = op.payload as { sections?: unknown };
  return (
    op.entityId === note.id &&
    JSON.stringify(payload.sections ?? null) === JSON.stringify(note.sections) &&
    verifyOperation(op, device.publicKey)
  );
}
