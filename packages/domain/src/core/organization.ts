import { z } from 'zod';

/** Time zones of the DRC: west (Kinshasa) and east (Lubumbashi). */
export const SITE_TIMEZONES = ['Africa/Kinshasa', 'Africa/Lubumbashi'] as const;
export const DEPARTMENT_KINDS = [
  'clinical',
  'technical',
  'administrative',
  'pharmacy',
  'laboratory',
  'cashier',
] as const;
export const ORGANIZATION_CURRENCIES = ['USD', 'CDF'] as const;
export const ORGANIZATION_LOCALES = ['fr', 'en'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

export const addressSchema = z.object({
  province: optionalText(60),
  city: optionalText(60),
  commune: optionalText(60),
  quarter: optionalText(60),
  street: optionalText(120),
});
export type Address = z.infer<typeof addressSchema>;

/** Phone numbers are kept as typed, but only digits, spaces and a leading + are allowed. */
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^\+?[\d ]*$/, 'ORG_PHONE_INVALID')
  .transform((v) => (v === '' ? null : v))
  .nullish();

const emailSchema = z
  .union([z.email().max(120), z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullish();

/**
 * What a structure administrator may change on their own structure. The code,
 * type, status and training flag belong to the platform (SADM).
 */
export const tenantProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(200),
  defaultLocale: z.enum(ORGANIZATION_LOCALES),
  defaultCurrency: z.enum(ORGANIZATION_CURRENCIES),
  timezone: z.enum(SITE_TIMEZONES),
  contact: z.object({
    phone: phoneSchema,
    email: emailSchema,
    address: addressSchema,
  }),
  legalMentions: optionalText(2000),
});
export type TenantProfileInput = z.infer<typeof tenantProfileSchema>;

/** Three capital letters, used in document numbers: immutable once created. */
export const siteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'ORG_SITE_CODE_INVALID');

export const siteFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: addressSchema,
  timezone: z.enum(SITE_TIMEZONES),
  phone: phoneSchema,
});
export const siteCreateSchema = siteFieldsSchema.extend({ code: siteCodeSchema });
export const siteUpdateSchema = siteFieldsSchema.partial().extend({
  id: z.uuid(),
  isActive: z.boolean().optional(),
});
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;

export const departmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'ORG_DEPARTMENT_CODE_INVALID');

export const departmentFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(DEPARTMENT_KINDS),
  costCenterCode: optionalText(30),
});
export const departmentCreateSchema = departmentFieldsSchema.extend({
  siteId: z.uuid(),
  code: departmentCodeSchema,
});
export const departmentUpdateSchema = departmentFieldsSchema.partial().extend({
  id: z.uuid(),
  isActive: z.boolean().optional(),
});
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

/**
 * A structure always keeps at least one active site: users, numbering and
 * devices hang off it. Returns true when deactivating `siteId` is allowed.
 */
export function canDeactivateSite(
  sites: readonly { id: string; isActive: boolean }[],
  siteId: string,
): boolean {
  return sites.some((s) => s.isActive && s.id !== siteId);
}

/** Fields that actually changed, for the audit diff (values only for non-personal data). */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
): (keyof T)[] {
  return (Object.keys(patch) as (keyof T)[]).filter(
    (k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(before[k]),
  );
}
