import 'server-only';
import { schema, type Tx } from '@medhub/db';
import { AppError } from '@medhub/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

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
