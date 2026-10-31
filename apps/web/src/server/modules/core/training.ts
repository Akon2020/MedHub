import 'server-only';
import { appendAudit, schema, type Tx, withSystem, withTenant } from '@medhub/db';
import { fictitiousPatients, TRAINING_PATIENT_COUNT, trainingCode } from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { and, count, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { database } from '../../platform/db';
import { openSecret, sealSecret } from '../../platform/mfa';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { insertServerPatients } from '../sync';
import { requireRecentStepUp } from './configuration';

type Client = { ip: string | null };
type Tenant = typeof schema.tenant.$inferSelect;

export type TrainingView = {
  available: boolean;
  training: {
    code: string;
    createdAt: string;
    status: string;
    users: number;
    patients: number;
  } | null;
  archived: number;
  canManage: boolean;
};

async function currentTraining(sourceId: string): Promise<Tenant | null> {
  const [row] = await withSystem(database().db, (tx) =>
    tx
      .select()
      .from(schema.tenant)
      .where(
        and(
          eq(schema.tenant.trainingSourceId, sourceId),
          eq(schema.tenant.isTraining, true),
          ne(schema.tenant.status, 'archived'),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

async function sourceTenant(ctx: RequestContext): Promise<Tenant> {
  const [row] = await withSystem(database().db, (tx) =>
    tx.select().from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId)).limit(1),
  );
  if (!row) throw new AppError('UNAUTHENTICATED', 401);
  return row;
}

export async function getTraining(ctx: RequestContext): Promise<TrainingView> {
  const tenant = await sourceTenant(ctx);
  const permissions = await withTenant(
    database().db,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    async (tx) => {
      const p = await loadPermissions(tx, ctx.userId);
      requirePermission(p, 'configuration:read');
      return p;
    },
  );
  const training = tenant.isTraining ? null : await currentTraining(tenant.id);
  const archived = await withSystem(database().db, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(schema.tenant)
      .where(
        and(eq(schema.tenant.trainingSourceId, tenant.id), eq(schema.tenant.status, 'archived')),
      );
    return row?.n ?? 0;
  });
  let counts = { users: 0, patients: 0 };
  if (training) {
    counts = await withTenant(
      database().db,
      { tenantId: training.id, userId: null },
      async (tx) => {
        const [users] = await tx.select({ n: count() }).from(schema.userAccount);
        const [patients] = await tx.select({ n: count() }).from(schema.patient);
        return { users: users?.n ?? 0, patients: patients?.n ?? 0 };
      },
    );
  }
  return {
    available: !tenant.isTraining,
    training: training
      ? {
          code: training.code,
          createdAt: training.createdAt.toISOString(),
          status: training.status,
          ...counts,
        }
      : null,
    archived,
    canManage: permissions.has('configuration:publish'),
  };
}

type Snapshot = Awaited<ReturnType<typeof readSource>>;

/** Everything a training copy needs, read once from the real structure. */
async function readSource(tx: Tx) {
  const now = new Date();
  return {
    sites: await tx.select().from(schema.site),
    departments: await tx.select().from(schema.department),
    roles: await tx.select().from(schema.role),
    grants: await tx.select().from(schema.rolePermission),
    config: await tx
      .select()
      .from(schema.configEntry)
      .where(eq(schema.configEntry.status, 'published')),
    lists: await tx.select().from(schema.choiceList),
    items: await tx.select().from(schema.choiceItem),
    users: await tx
      .select()
      .from(schema.userAccount)
      .where(eq(schema.userAccount.status, 'active')),
    assignments: await tx
      .select()
      .from(schema.userRole)
      .where(or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now))),
    recoveryCodes: await tx
      .select()
      .from(schema.mfaRecoveryCode)
      .where(isNull(schema.mfaRecoveryCode.usedAt)),
  };
}

/**
 * Writes the copy into the training structure. Identifiers are new; codes,
 * names, passwords and second factors are the same, so that everyone signs in
 * to the training base with their usual credentials and the training code.
 */
async function writeCopy(
  tx: Tx,
  source: Tenant,
  target: string,
  data: Snapshot,
  actorId: string,
): Promise<{ actor: string | null }> {
  const ids = new Map<string, string>();
  const map = (id: string | null) => (id ? (ids.get(id) ?? null) : null);
  const fresh = (id: string) => {
    const next = uuidv7();
    ids.set(id, next);
    return next;
  };

  for (const s of data.sites) {
    await tx.insert(schema.site).values({ ...s, id: fresh(s.id), tenantId: target });
  }
  for (const d of data.departments) {
    await tx.insert(schema.department).values({
      ...d,
      id: fresh(d.id),
      tenantId: target,
      siteId: map(d.siteId) ?? d.siteId,
    });
  }
  for (const r of data.roles) {
    await tx.insert(schema.role).values({ ...r, id: fresh(r.id), tenantId: target });
  }
  for (const g of data.grants) {
    const roleId = map(g.roleId);
    if (roleId) await tx.insert(schema.rolePermission).values({ ...g, tenantId: target, roleId });
  }
  for (const c of data.config) {
    await tx.insert(schema.configEntry).values({ ...c, id: uuidv7(), tenantId: target });
  }
  for (const l of data.lists) {
    await tx.insert(schema.choiceList).values({ ...l, id: fresh(l.id), tenantId: target });
  }
  for (const i of data.items) {
    const listId = map(i.listId);
    if (listId) {
      await tx.insert(schema.choiceItem).values({ ...i, id: uuidv7(), tenantId: target, listId });
    }
  }
  for (const u of data.users) {
    const mfaSecretEnc = u.mfaSecretEnc
      ? sealSecret(target, openSecret(source.id, u.mfaSecretEnc))
      : null;
    await tx.insert(schema.userAccount).values({
      ...u,
      id: fresh(u.id),
      tenantId: target,
      mfaSecretEnc,
      defaultSiteId: map(u.defaultSiteId),
      defaultDepartmentId: map(u.defaultDepartmentId),
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });
  }
  for (const a of data.assignments) {
    const userId = map(a.userId);
    const roleId = map(a.roleId);
    if (userId && roleId) {
      await tx.insert(schema.userRole).values({
        ...a,
        id: uuidv7(),
        tenantId: target,
        userId,
        roleId,
        siteId: map(a.siteId),
        departmentId: map(a.departmentId),
      });
    }
  }
  for (const code of data.recoveryCodes) {
    const userId = map(code.userId);
    if (userId) {
      await tx
        .insert(schema.mfaRecoveryCode)
        .values({ ...code, id: uuidv7(), tenantId: target, userId });
    }
  }
  return { actor: map(actorId) };
}

/** A training structure that is replaced is archived with its data; its devices wipe themselves. */
async function archiveTraining(training: Tenant): Promise<void> {
  const now = new Date();
  await withTenant(database().db, { tenantId: training.id, userId: null }, async (tx) => {
    await tx
      .update(schema.device)
      .set({ status: 'revoked', revokedReason: 'training_reset', revokedAt: now, updatedAt: now })
      .where(eq(schema.device.status, 'active'));
    await tx.update(schema.session).set({ revokedAt: now }).where(isNull(schema.session.revokedAt));
  });
  await withSystem(database().db, (tx) =>
    tx
      .update(schema.tenant)
      .set({ status: 'archived', updatedAt: now })
      .where(eq(schema.tenant.id, training.id)),
  );
}

/**
 * Creates the training structure of the current one, or replaces it ("reset"):
 * the same published configuration, roles, users and pick lists, plus
 * fictitious patients. The previous training structure is archived, never
 * deleted (clinical tables are append-only, even with invented data).
 */
export async function buildTraining(
  ctx: RequestContext,
  mode: 'create' | 'reset',
  client: Client,
): Promise<{ code: string }> {
  const source = await sourceTenant(ctx);
  if (source.isTraining) throw new AppError('TRAINING_NOT_ALLOWED', 409);
  const data = await withTenant(
    database().db,
    { tenantId: source.id, userId: ctx.userId },
    async (tx) => {
      requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:publish');
      await requireRecentStepUp(tx, ctx);
      return readSource(tx);
    },
  );
  const existing = await currentTraining(source.id);
  if (mode === 'create' && existing?.status === 'active') {
    throw new AppError('TRAINING_ALREADY_EXISTS', 409);
  }
  if (mode === 'reset' && !existing) throw new AppError('NOT_FOUND', 404);
  // A training structure left half built (status "prospect") is archived like any other.
  if (existing) await archiveTraining(existing);

  const code = trainingCode(source.code);
  const targetId = uuidv7();
  try {
    await withSystem(database().db, (tx) =>
      tx.insert(schema.tenant).values({
        id: targetId,
        code,
        legalName: source.legalName,
        displayName: source.displayName,
        type: source.type,
        status: 'prospect',
        country: source.country,
        defaultLocale: source.defaultLocale,
        defaultCurrency: source.defaultCurrency,
        timezone: source.timezone,
        contact: source.contact,
        legalMentions: source.legalMentions,
        isTraining: true,
        trainingSourceId: source.id,
      }),
    );
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if ((error as { code?: string }).code === '23505' || cause?.code === '23505') {
      throw new AppError('TRAINING_CODE_TAKEN', 409, { code });
    }
    throw error;
  }

  await withTenant(database().db, { tenantId: targetId, userId: null }, async (tx) => {
    const { actor } = await writeCopy(tx, source, targetId, data, ctx.userId);
    const patients = await insertServerPatients(
      tx,
      { tenantId: targetId, userId: actor ?? ctx.userId },
      fictitiousPatients(TRAINING_PATIENT_COUNT, new Date()),
    );
    await appendAudit(tx, {
      tenantId: targetId,
      userId: actor,
      ip: client.ip,
      action: 'training_seed',
      entity: 'tenant',
      entityId: targetId,
      diff: { source: source.code, users: data.users.length, patients },
    });
  });
  await withSystem(database().db, (tx) =>
    tx
      .update(schema.tenant)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(schema.tenant.id, targetId)),
  );
  await withTenant(database().db, { tenantId: source.id, userId: ctx.userId }, (tx) =>
    appendAudit(tx, {
      tenantId: source.id,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: mode === 'create' ? 'training_create' : 'training_reset',
      entity: 'tenant',
      entityId: targetId,
      diff: { code, archived: existing?.id ?? null },
    }),
  );
  return { code };
}
