import { z } from 'zod';
import { emailSchema, optionalText, phoneSchema } from './organization';

/** Lower-case letters, digits, dot, dash and underscore; starts with a letter. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,39}$/;
export const USER_MAX_ROLES = 20;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

const userProfileFields = {
  displayName: z.string().trim().min(2).max(120),
  title: optionalText(20),
  professionalNumber: optionalText(40),
  phone: phoneSchema,
  email: emailSchema,
  locale: z.enum(['fr', 'en']).default('fr'),
  defaultSiteId: z.uuid().nullish(),
  defaultDepartmentId: z.uuid().nullish(),
  roleIds: z
    .array(z.uuid())
    .min(1)
    .max(USER_MAX_ROLES)
    .transform((ids) => [...new Set(ids)]),
};

/** Online-only creation by a structure administrator; a temporary password is generated. */
export const userCreateSchema = z.object({
  username: z.string().transform(normalizeUsername).pipe(z.string().regex(USERNAME_PATTERN)),
  ...userProfileFields,
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/** The username never changes: it appears in the audit trail and on signed documents. */
export const userUpdateSchema = z.object({
  userId: z.uuid(),
  ...userProfileFields,
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/** Role assignments to add and to end, given the current and the requested sets. */
export function roleChanges(
  current: readonly string[],
  requested: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(current);
  const after = new Set(requested);
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}
