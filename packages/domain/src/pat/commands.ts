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
const shortText = (max: number) => z.string().trim().max(max).nullish();

/** Generic civil statuses; a structure needing others uses a pick list in `extra`. */
export const MARITAL_STATUSES = [
  'single',
  'married',
  'cohabiting',
  'divorced',
  'separated',
  'widowed',
] as const;

/** Same address shape as the structure and its sites (docs/04-modele-donnees.md). */
export const patientAddressSchema = z
  .object({
    province: shortText(60),
    city: shortText(60),
    commune: shortText(60),
    quarter: shortText(60),
    street: shortText(120),
  })
  .nullish();

/** The person to call: a single structured value, merged as a whole. */
export const patientContactSchema = z
  .object({
    name: shortText(120),
    relation: shortText(60),
    phone: phoneSchema,
  })
  .nullish();

/** Fields completed after the quick registration (docs/modules/pat.md, capability 3). */
const demographicFields = {
  address: patientAddressSchema,
  occupation: shortText(80),
  maritalStatus: z.enum(MARITAL_STATUSES).nullish(),
  nationality: shortText(60),
  language: shortText(40),
  fatherName: shortText(120),
  motherName: shortText(120),
  contact: patientContactSchema,
};

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
  ...demographicFields,
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
  'address',
  'occupation',
  'maritalStatus',
  'nationality',
  'language',
  'fatherName',
  'motherName',
  'contact',
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
    ...demographicFields,
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
  p: PatientNameParts & {
    phone?: string | null;
    mrn?: string;
    fatherName?: string | null;
    motherName?: string | null;
  },
): {
  searchText: string;
  phoneticKey: string;
} {
  const name = patientFullName(p);
  // Parents' names are searchable (docs/modules/pat.md, capability 6), not part of the key.
  const parents = [p.fatherName ?? '', p.motherName ?? ''].join(' ');
  return {
    searchText: normalizeSearchText([name, p.phone ?? '', p.mrn ?? '', parents].join(' ')),
    phoneticKey: phoneticKey(name),
  };
}
