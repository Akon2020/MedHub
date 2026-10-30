import { ageInYears, patientFullName } from '@medhub/domain';
import type { LocalEntity } from '@medhub/sync/client';

export type PatientView = {
  id: string;
  mrn: string;
  name: string;
  familyName: string;
  sex: 'M' | 'F' | 'U';
  birthDate: string | null;
  birthDateEstimated: boolean;
  age: number | null;
  phone: string | null;
  syncState: 'synced' | 'pending' | 'rejected';
  createdAt: string | null;
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** HLC physical part gives the local creation instant without an extra column. */
function hlcInstant(hlc: string): string | null {
  const ms = Number(hlc.split(':')[0]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

export function toPatientView(entity: LocalEntity, now = new Date()): PatientView {
  const d = entity.data;
  const birthDate = s(d.birthDate);
  return {
    id: entity.id,
    mrn: s(d.mrn) ?? '',
    name: patientFullName({
      familyName: s(d.familyName) ?? '',
      middleName: s(d.middleName),
      givenName: s(d.givenName),
    }),
    familyName: s(d.familyName) ?? '',
    sex: d.sex === 'M' || d.sex === 'F' ? d.sex : 'U',
    birthDate,
    birthDateEstimated: d.birthDateEstimated === true,
    age: birthDate ? ageInYears(birthDate, now) : null,
    phone: s(d.phone),
    syncState: entity.rejected ? 'rejected' : entity.version === 0 ? 'pending' : 'synced',
    createdAt: hlcInstant(entity.hlc),
  };
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}
