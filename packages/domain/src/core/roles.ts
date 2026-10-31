import {
  ALL_PERMISSION_KEYS,
  PERMISSION_SCOPES_ALL,
  PRIVILEGED_PERMISSIONS,
  ROLE_TEMPLATES,
  scopesFor,
} from '@medhub/shared';
import { z } from 'zod';
import { optionalText } from './organization';

/** Role codes: lower-case words joined by underscores, as in the templates. */
export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

const KNOWN_KEYS = new Set(ALL_PERMISSION_KEYS);

const grantSchema = z
  .object({
    key: z.string().refine((k) => KNOWN_KEYS.has(k), 'ROLE_PERMISSION_UNKNOWN'),
    scope: z.enum(PERMISSION_SCOPES_ALL).default('tenant'),
  })
  .refine((g) => scopesFor(g.key).includes(g.scope), {
    message: 'ROLE_SCOPE_NOT_ALLOWED',
    path: ['scope'],
  });
export type RoleGrant = z.infer<typeof grantSchema>;

const grantsSchema = z
  .array(grantSchema)
  .max(ALL_PERMISSION_KEYS.length)
  .refine((grants) => new Set(grants.map((g) => g.key)).size === grants.length, {
    message: 'ROLE_PERMISSION_DUPLICATE',
  });

export const roleCreateSchema = z.object({
  code: z.string().trim().toLowerCase().pipe(z.string().regex(ROLE_CODE_PATTERN)),
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  requiresMfa: z.boolean().default(false),
  /** Duplication: the new role starts with the permissions of this one. */
  copyFromRoleId: z.uuid().nullish(),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object({
  roleId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  requiresMfa: z.boolean(),
  grants: grantsSchema,
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

/**
 * A role is privileged when its template says so or when it grants an
 * administrative permission; privileged roles always require the second factor.
 */
export function isPrivilegedRole(templateCode: string | null, keys: Iterable<string>): boolean {
  const template = ROLE_TEMPLATES.find((t) => t.code === templateCode);
  if (template?.isPrivileged) return true;
  for (const key of keys) if (PRIVILEGED_PERMISSIONS.has(key)) return true;
  return false;
}

/** Changes between two sets of grants, for the audit trail and the screen. */
export function grantChanges(
  before: readonly RoleGrant[],
  after: readonly RoleGrant[],
): { added: string[]; removed: string[]; rescoped: string[] } {
  const old = new Map(before.map((g) => [g.key, g.scope]));
  const next = new Map(after.map((g) => [g.key, g.scope]));
  return {
    added: [...next.keys()].filter((k) => !old.has(k)).sort(),
    removed: [...old.keys()].filter((k) => !next.has(k)).sort(),
    rescoped: [...next.entries()]
      .filter(([k, scope]) => old.has(k) && old.get(k) !== scope)
      .map(([k]) => k)
      .sort(),
  };
}

/** Permissions of the platform template a role was copied from, if any. */
export function templateGrants(templateCode: string | null): RoleGrant[] | null {
  const template = ROLE_TEMPLATES.find((t) => t.code === templateCode);
  if (!template) return null;
  return [...new Set(template.permissions)].map((key) => ({ key, scope: 'tenant' as const }));
}
