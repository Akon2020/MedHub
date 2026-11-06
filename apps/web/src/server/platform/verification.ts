import 'server-only';
import { schema, withPlatformScope } from '@medhub/db';
import { VERIFICATION_PATTERN } from '@medhub/domain';
import { eq } from 'drizzle-orm';
import { database } from './db';
import { enforceRateLimit, RATE_LIMITS } from './security';

export type PrescriptionCheck =
  { found: false } | { found: true; status: string; issuedOn: string; structure: string };

/**
 * Public check of a printed prescription (docs/07-ui-ux.md section 9): the
 * code under the QR confirms that the document exists, its date, its status
 * and the structure that issued it. No patient, drug or prescriber is shown.
 */
export async function verifyPrescription(
  code: string,
  ip: string | null,
): Promise<PrescriptionCheck> {
  const normalized = code.trim().toUpperCase();
  if (!VERIFICATION_PATTERN.test(normalized)) return { found: false };
  await enforceRateLimit(RATE_LIMITS.verifyByIp, ip ?? 'unknown', { ip });
  const [row] = await withPlatformScope(
    database().db,
    { actorId: null, reason: 'prescription_verification' },
    (tx) =>
      tx
        .select({
          status: schema.prescription.status,
          prescribedAt: schema.prescription.prescribedAt,
          structure: schema.tenant.displayName,
        })
        .from(schema.prescription)
        .innerJoin(schema.tenant, eq(schema.tenant.id, schema.prescription.tenantId))
        .where(eq(schema.prescription.verificationCode, normalized))
        .limit(1),
  );
  if (!row) return { found: false };
  return {
    found: true,
    status: row.status,
    issuedOn: row.prescribedAt.toISOString().slice(0, 10),
    structure: row.structure,
  };
}
