import {
  duplicateScore,
  patientFullName,
  type DuplicateReason,
  type DuplicateSubject,
} from '@medhub/domain';
import type { EncryptedClientStore } from '@medhub/local-db';
import { toPatientView, type PatientView } from './patient-helpers';

export type SimilarPatient = { patient: PatientView; score: number; reasons: DuplicateReason[] };

const s = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * Patients already on this device that look like the one being registered,
 * scored with the same rule as the server (docs/modules/pat.md). Runs offline
 * on the encrypted local index.
 */
export async function findSimilar(
  store: EncryptedClientStore,
  subject: DuplicateSubject,
  threshold: number,
  limit = 5,
): Promise<SimilarPatient[]> {
  const queries = [patientFullName(subject), subject.familyName, subject.phone ?? ''].filter(
    (q) => q.trim().length >= 2,
  );
  const seen = new Map<string, SimilarPatient>();
  for (const query of queries) {
    for (const entity of await store.searchPatients(query, 30)) {
      if (seen.has(entity.id)) continue;
      const d = entity.data;
      const { score, reasons } = duplicateScore(subject, {
        familyName: s(d.familyName) ?? '',
        middleName: s(d.middleName),
        givenName: s(d.givenName),
        sex: s(d.sex) ?? 'U',
        birthDate: s(d.birthDate),
        birthDateEstimated: d.birthDateEstimated === true,
        phone: s(d.phone),
      });
      if (score >= threshold)
        seen.set(entity.id, { patient: toPatientView(entity), score, reasons });
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
