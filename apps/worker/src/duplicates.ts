import { appendAudit, schema, withTenant, type Db, type Tx } from '@medhub/db';
import { duplicateScore, resolveConfig, type DuplicateSubject } from '@medhub/domain';
import { uuidv7 } from '@medhub/shared';
import { and, eq, isNull, like, ne, or, sql } from 'drizzle-orm';

type PatientRow = typeof schema.patient.$inferSelect;

/** Neighbours worth scoring: same phonetic name start, or same phone ending. */
const NEIGHBOUR_LIMIT = 200;

function subject(p: PatientRow): DuplicateSubject {
  const extra = p.extra as { motherName?: unknown; fatherName?: unknown };
  return {
    familyName: p.familyName,
    middleName: p.middleName,
    givenName: p.givenName,
    sex: p.sex,
    birthDate: p.birthDate,
    birthDateEstimated: p.birthDateEstimated,
    phone: p.phone,
    motherName: typeof extra.motherName === 'string' ? extra.motherName : null,
    fatherName: typeof extra.fatherName === 'string' ? extra.fatherName : null,
  };
}

async function candidateThreshold(tx: Tx): Promise<number> {
  const rows = await tx
    .select({ key: schema.configEntry.key, value: schema.configEntry.value })
    .from(schema.configEntry)
    .where(eq(schema.configEntry.status, 'published'));
  return resolveConfig(Object.fromEntries(rows.map((r) => [r.key, r.value])))[
    'patient.duplicate_candidate_score'
  ];
}

/**
 * Scores a newly synchronised patient against its neighbours and records every
 * pair above the structure's threshold in the duplicates queue (scenario P3).
 * Idempotent: a pair already known keeps its first record and decision.
 */
export async function detectDuplicates(
  db: Db,
  tenantId: string,
  patientId: string,
): Promise<number> {
  return withTenant(db, { tenantId, userId: null }, async (tx) => {
    const [patient] = await tx
      .select()
      .from(schema.patient)
      .where(eq(schema.patient.id, patientId))
      .limit(1);
    if (!patient || patient.mergedIntoId || patient.deletedAt) return 0;
    const threshold = await candidateThreshold(tx);
    const firstKey = patient.phoneticKey.split(' ')[0] ?? '';
    const phoneTail = (patient.phone ?? '').replace(/\D/g, '').slice(-9);
    const neighbours = await tx
      .select()
      .from(schema.patient)
      .where(
        and(
          ne(schema.patient.id, patient.id),
          isNull(schema.patient.mergedIntoId),
          isNull(schema.patient.deletedAt),
          or(
            firstKey ? like(schema.patient.phoneticKey, `${firstKey}%`) : sql`false`,
            phoneTail.length === 9
              ? sql`right(regexp_replace(coalesce(${schema.patient.phone}, ''), '[^0-9]', '', 'g'), 9) = ${phoneTail}`
              : sql`false`,
          ),
        ),
      )
      .limit(NEIGHBOUR_LIMIT);

    let found = 0;
    for (const other of neighbours) {
      const { score, reasons } = duplicateScore(subject(patient), subject(other));
      if (score < threshold) continue;
      const [a, b] = patient.id < other.id ? [patient.id, other.id] : [other.id, patient.id];
      const inserted = await tx
        .insert(schema.duplicateCandidate)
        .values({ id: uuidv7(), tenantId, patientAId: a, patientBId: b, score, reasons })
        .onConflictDoNothing()
        .returning({ id: schema.duplicateCandidate.id });
      if (inserted.length === 0) continue;
      found += 1;
      await appendAudit(tx, {
        tenantId,
        userId: null,
        action: 'duplicate_detected',
        entity: 'duplicate_candidate',
        entityId: inserted[0]?.id ?? null,
        diff: { score, reasons },
      });
    }
    return found;
  });
}
