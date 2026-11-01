import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  APPOINTMENT_SCOPE_DAYS,
  DEFAULT_PATIENT_SCOPE,
  ENTITIES,
  currentFavorites,
  effectivePatientScope,
  inPatientScope,
  patientScopeRuleSchema,
  type EntityName,
  type PatientScopeRule,
  type SyncScopeRuleInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import type { ChangeRecord } from '@medhub/sync';
import { and, asc, eq, gt, gte, inArray, isNull, lte, max, or, sql } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { patientBundles } from './repository';

const ownerOf = (change: ChangeRecord): string | null =>
  ENTITIES[change.entity as EntityName]?.patientIdOf?.(change.data ?? {}, change.entityId) ?? null;

/** Rule that applies to the user for patients (docs/02-offline-sync.md section 8). */
export async function loadPatientScope(tx: Tx, userId: string): Promise<PatientScopeRule> {
  const now = new Date();
  const roles = await tx
    .select({ roleId: schema.userRole.roleId })
    .from(schema.userRole)
    .where(
      and(
        eq(schema.userRole.userId, userId),
        or(isNull(schema.userRole.validUntil), gt(schema.userRole.validUntil, now)),
      ),
    );
  const rules = await tx
    .select({ roleId: schema.syncScopeRule.roleId, rule: schema.syncScopeRule.rule })
    .from(schema.syncScopeRule)
    .where(eq(schema.syncScopeRule.entity, 'patient'));
  return effectivePatientScope(
    rules,
    roles.map((r) => r.roleId),
  );
}

/** Patients opened on a device from a server search stay in its scope. */
export async function pinPatient(
  tx: Tx,
  ctx: { tenantId: string; deviceId: string },
  patientId: string,
): Promise<void> {
  await tx
    .insert(schema.devicePatient)
    .values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      deviceId: ctx.deviceId,
      patientId,
      pinned: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.devicePatient.tenantId,
        schema.devicePatient.deviceId,
        schema.devicePatient.patientId,
      ],
      set: { pinned: true, updatedAt: new Date() },
    });
}

/**
 * Applies a scoped rule to one pull page. A change for a patient outside the
 * device's scope makes the device drop it; the rows of such a patient are not
 * sent. A patient entering the scope that the device does not hold yet comes
 * with its whole record, placed before the page's changes.
 */
export async function applyPatientScope(
  tx: Tx,
  ctx: { tenantId: string; userId: string; deviceId: string },
  changes: ChangeRecord[],
  rule: PatientScopeRule,
  now: Date,
): Promise<ChangeRecord[]> {
  if (rule.mode === 'all' || changes.length === 0) return changes;
  // Changes already turned into evictions (sensitivity) are passed on untouched.
  const live = changes.filter((c) => !c.evict);
  const owners = [...new Set(live.map(ownerOf).filter((id): id is string => id !== null))];
  if (owners.length === 0) return changes;

  const patients = await tx
    .select({
      id: schema.patient.id,
      deviceId: schema.patient.deviceId,
      updatedAt: schema.patient.updatedAt,
    })
    .from(schema.patient)
    .where(inArray(schema.patient.id, owners));
  const held = new Map(
    (
      await tx
        .select({ patientId: schema.devicePatient.patientId, pinned: schema.devicePatient.pinned })
        .from(schema.devicePatient)
        .where(
          and(
            eq(schema.devicePatient.deviceId, ctx.deviceId),
            inArray(schema.devicePatient.patientId, owners),
          ),
        )
    ).map((r) => [r.patientId, r.pinned]),
  );
  const favorites = currentFavorites(
    (
      await tx
        .select({
          id: schema.patientFavorite.id,
          patientId: schema.patientFavorite.patientId,
          active: schema.patientFavorite.active,
          at: schema.patientFavorite.at,
        })
        .from(schema.patientFavorite)
        .where(
          and(
            eq(schema.patientFavorite.userId, ctx.userId),
            inArray(schema.patientFavorite.patientId, owners),
          ),
        )
    ).map((f) => ({ ...f, at: f.at.toISOString() })),
  );
  const lastVital = new Map(
    (
      await tx
        .select({ patientId: schema.vitalSign.patientId, at: max(schema.vitalSign.createdAt) })
        .from(schema.vitalSign)
        .where(inArray(schema.vitalSign.patientId, owners))
        .groupBy(schema.vitalSign.patientId)
    ).map((r) => [r.patientId, r.at]),
  );

  const lastVisit = new Map(
    (
      await tx
        .select({ patientId: schema.encounter.patientId, at: max(schema.encounter.startedAt) })
        .from(schema.encounter)
        .where(inArray(schema.encounter.patientId, owners))
        .groupBy(schema.encounter.patientId)
    ).map((r) => [r.patientId, r.at]),
  );
  const soon = new Set(
    (
      await tx
        .selectDistinct({ patientId: schema.appointment.patientId })
        .from(schema.appointment)
        .where(
          and(
            inArray(schema.appointment.patientId, owners),
            gte(schema.appointment.startsAt, new Date(now.getTime() - 86_400_000)),
            lte(
              schema.appointment.startsAt,
              new Date(now.getTime() + APPOINTMENT_SCOPE_DAYS * 86_400_000),
            ),
            inArray(schema.appointment.status, ['booked', 'confirmed', 'arrived']),
          ),
        )
    ).map((r) => r.patientId),
  );

  const inScope = new Set<string>();
  for (const p of patients) {
    const lastActivity = [lastVital.get(p.id), lastVisit.get(p.id), p.updatedAt].reduce<Date>(
      (latest, at) => (at && at > latest ? at : latest),
      p.updatedAt,
    );
    const facts = {
      createdHere: p.deviceId === ctx.deviceId,
      favorite: favorites.has(p.id),
      pinned: held.get(p.id) === true,
      lastActivity,
      upcomingAppointment: soon.has(p.id),
    };
    if (inPatientScope(facts, rule, now)) inScope.add(p.id);
  }

  const evicted = new Set<string>();
  const kept = changes.flatMap((change): ChangeRecord[] => {
    if (change.evict) return [change];
    const owner = ownerOf(change);
    if (!owner || inScope.has(owner)) return [change];
    if (change.entity !== 'patient') return [];
    evicted.add(owner);
    return [{ ...change, data: null, evict: true }];
  });

  const entering = [...inScope].filter((id) => !held.has(id));
  const firstSeq = changes[0]?.seq ?? 0;
  const hydration: ChangeRecord[] = (await patientBundles(tx, entering, ctx.userId)).map(
    ({ entity, state }) => ({
      seq: firstSeq,
      entity,
      entityId: state.id,
      version: state.version,
      data: { ...state.data, id: state.id },
    }),
  );

  if (entering.length > 0) {
    await tx
      .insert(schema.devicePatient)
      .values(
        entering.map((patientId) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          deviceId: ctx.deviceId,
          patientId,
        })),
      )
      .onConflictDoNothing();
  }
  if (evicted.size > 0) {
    await tx
      .delete(schema.devicePatient)
      .where(
        and(
          eq(schema.devicePatient.deviceId, ctx.deviceId),
          inArray(schema.devicePatient.patientId, [...evicted]),
          sql`${schema.devicePatient.pinned} = false`,
        ),
      );
  }
  // The bundle already carries the current state of what it contains.
  const bundled = new Set(hydration.map((c) => `${c.entity}:${c.entityId}`));
  return [...hydration, ...kept.filter((c) => !bundled.has(`${c.entity}:${c.entityId}`))];
}

export type ScopeRulesView = {
  defaultRule: PatientScopeRule | null;
  roles: { roleId: string; name: string; rule: PatientScopeRule | null }[];
  builtIn: PatientScopeRule;
  canEdit: boolean;
};

const parsedRule = (value: unknown): PatientScopeRule | null => {
  const rule = patientScopeRuleSchema.safeParse(value);
  return rule.success ? rule.data : null;
};

/** Online configuration screen: the structure's default rule and the per-role rules. */
export async function listScopeRules(ctx: RequestContext): Promise<ScopeRulesView> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    const rules = await tx
      .select()
      .from(schema.syncScopeRule)
      .where(eq(schema.syncScopeRule.entity, 'patient'));
    const roles = await tx
      .select({ id: schema.role.id, name: schema.role.name })
      .from(schema.role)
      .orderBy(asc(schema.role.name));
    return {
      defaultRule: parsedRule(rules.find((r) => r.roleId === null)?.rule),
      roles: roles.map((r) => ({
        roleId: r.id,
        name: r.name,
        rule: parsedRule(rules.find((x) => x.roleId === r.id)?.rule),
      })),
      builtIn: DEFAULT_PATIENT_SCOPE,
      canEdit: permissions.has('configuration:edit'),
    };
  });
}

/**
 * Sets or removes (rule null) the default or a role's rule. Devices apply it
 * from their next pull: patients leaving the scope are dropped, those entering
 * it arrive with their record.
 */
export async function saveScopeRule(
  ctx: RequestContext,
  input: SyncScopeRuleInput,
  client: { ip: string | null },
): Promise<void> {
  await withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    if (input.roleId) {
      const [role] = await tx
        .select({ id: schema.role.id })
        .from(schema.role)
        .where(eq(schema.role.id, input.roleId))
        .limit(1);
      if (!role) throw new AppError('NOT_FOUND', 404);
    }
    const target = and(
      eq(schema.syncScopeRule.entity, 'patient'),
      input.roleId
        ? eq(schema.syncScopeRule.roleId, input.roleId)
        : isNull(schema.syncScopeRule.roleId),
    );
    const [before] = await tx.select().from(schema.syncScopeRule).where(target).limit(1);
    if (!input.rule) {
      if (before)
        await tx.delete(schema.syncScopeRule).where(eq(schema.syncScopeRule.id, before.id));
    } else if (before) {
      await tx
        .update(schema.syncScopeRule)
        .set({ rule: input.rule, updatedBy: ctx.userId, updatedAt: new Date() })
        .where(eq(schema.syncScopeRule.id, before.id));
    } else {
      await tx.insert(schema.syncScopeRule).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        roleId: input.roleId,
        entity: 'patient',
        rule: input.rule,
        updatedBy: ctx.userId,
      });
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'config_publish',
      entity: 'sync_scope_rule',
      entityId: before?.id ?? null,
      diff: { roleId: input.roleId, from: before?.rule ?? null, to: input.rule },
    });
  });
}
