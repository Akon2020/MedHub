import { SEXES, PATIENT_SENSITIVITIES } from '@medhub/shared';
import { z } from 'zod';
import { normalizeSearchText, phoneticKey } from './search';

const nameSchema = z.string().trim().min(1).max(120);
const optionalName = z.string().trim().max(120).nullish();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{6,20}$/, 'PAT_PHONE_INVALID')
  .nullish();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_INVALID');

export const patientRegisterPayload = z.object({
  mrn: z.string().trim().min(1).max(40),
  familyName: nameSchema,
  middleName: optionalName,
  givenName: optionalName,
  sex: z.enum(SEXES),
  birthDate: dateSchema.nullish(),
  birthDateEstimated: z.boolean().default(false),
  phone: phoneSchema,
  sensitivity: z.enum(PATIENT_SENSITIVITIES).default('normal'),
});
export type PatientRegisterPayload = z.infer<typeof patientRegisterPayload>;

/** Fields a `patient.update` may change, merged field by field (last HLC wins). */
export const PATIENT_MERGEABLE_FIELDS = [
  'familyName',
  'middleName',
  'givenName',
  'sex',
  'birthDate',
  'birthDateEstimated',
  'phone',
  'sensitivity',
] as const;
export type PatientMergeableField = (typeof PATIENT_MERGEABLE_FIELDS)[number];

/**
 * A stale write on one of these fields is not silently merged: the server keeps
 * its value and raises a conflict for a human to review.
 */
export const PATIENT_SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  'birthDate',
  'sex',
  'familyName',
]);

export const patientUpdatePayload = z
  .object({
    familyName: nameSchema.optional(),
    middleName: optionalName,
    givenName: optionalName,
    sex: z.enum(SEXES).optional(),
    birthDate: dateSchema.nullish(),
    birthDateEstimated: z.boolean().optional(),
    phone: phoneSchema,
    sensitivity: z.enum(PATIENT_SENSITIVITIES).optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'PAT_UPDATE_EMPTY');
export type PatientUpdatePayload = z.infer<typeof patientUpdatePayload>;

export type PatientNameParts = {
  familyName: string;
  middleName?: string | null;
  givenName?: string | null;
};

export function patientFullName(p: PatientNameParts): string {
  return [p.familyName, p.middleName, p.givenName].filter(Boolean).join(' ');
}

export function patientSearchFields(
  p: PatientNameParts & { phone?: string | null; mrn?: string },
): {
  searchText: string;
  phoneticKey: string;
} {
  const name = patientFullName(p);
  return {
    searchText: normalizeSearchText([name, p.phone ?? '', p.mrn ?? ''].join(' ')),
    phoneticKey: phoneticKey(name),
  };
}
