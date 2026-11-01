import 'server-only';
import { schema, type Tx } from '@medhub/db';
import { sensitivityAllowed, userSensitivityMax, type RoleAccessGrant } from '@medhub/domain';
import { AppError, type PatientSensitivity } from '@medhub/shared';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

/** Effective permission keys of a user, read inside the caller's tenant transaction. */
export async function loadPermissions(tx: Tx, userId: string): Promise<Set<string>> {
  const now = new Date();
  const rows = await tx
    .select({ key: schema.rolePermission.permissionKey })
    .from(schema.userRole)
    .innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRole.roleId))
    .where(
      and(
        eq(schema.userRole.userId, userId),
        or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
      ),
    );
  return new Set(rows.map((r) => r.key));
}

export function requirePermission(permissions: ReadonlySet<string>, key: string): void {
  if (!permissions.has(key)) throw new AppError('PERMISSION_DENIED', 403, { permission: key });
}

/** Most protected patient level the user may open (ABAC `sensitivity_max`). */
export async function loadSensitivityMax(tx: Tx, userId: string): Promise<PatientSensitivity> {
  const now = new Date();
  const rows = await tx
    .select({
      roleId: schema.rolePermission.roleId,
      key: schema.rolePermission.permissionKey,
      conditions: schema.rolePermission.conditions,
    })
    .from(schema.userRole)
    .innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRole.roleId))
    .where(
      and(
        eq(schema.userRole.userId, userId),
        or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
        inArray(schema.rolePermission.permissionKey, ['patient:read', 'patient:mark_sensitive']),
      ),
    );
  const byRole = new Map<string, RoleAccessGrant[]>();
  for (const row of rows) {
    const grants = byRole.get(row.roleId) ?? [];
    grants.push({ key: row.key, conditions: row.conditions });
    byRole.set(row.roleId, grants);
  }
  return userSensitivityMax([...byRole.values()]);
}

/** A sensitive record above the user's level stays closed (break-glass access comes with DPI). */
export function requireSensitivity(level: unknown, max: PatientSensitivity): void {
  if (!sensitivityAllowed(level, max)) throw new AppError('PAT_SENSITIVE', 403);
}
