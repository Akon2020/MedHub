import 'server-only';
import { appendAudit, schema, withTenant, type Tx } from '@medhub/db';
import {
  changedFields,
  type AppointmentTypeInput,
  type QueueInput,
  type ResourceKind,
  type ScheduleExceptionInput,
  type ScheduleInput,
} from '@medhub/domain';
import { AppError, uuidv7 } from '@medhub/shared';
import { asc, eq, gte } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from '../core';

type Client = { ip: string | null };

export type RdvConfig = {
  queues: (typeof schema.queue.$inferSelect)[];
  appointmentTypes: (typeof schema.appointmentType.$inferSelect)[];
  schedules: (typeof schema.scheduleTemplate.$inferSelect)[];
  exceptions: (typeof schema.scheduleException.$inferSelect)[];
  practitioners: { id: string; displayName: string; title: string | null }[];
  sites: { id: string; name: string }[];
  departments: { id: string; siteId: string; name: string }[];
  canEdit: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

/** Same guard as every configuration change: permission, recent second factor. */
async function withEditor<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    requirePermission(await loadPermissions(tx, ctx.userId), 'configuration:edit');
    await requireRecentStepUp(tx, ctx);
    return fn(tx);
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getRdvConfig(ctx: RequestContext): Promise<RdvConfig> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, 'configuration:read');
    return {
      queues: await tx.select().from(schema.queue).orderBy(asc(schema.queue.name)),
      appointmentTypes: await tx
        .select()
        .from(schema.appointmentType)
        .orderBy(asc(schema.appointmentType.name)),
      schedules: await tx
        .select()
        .from(schema.scheduleTemplate)
        .orderBy(asc(schema.scheduleTemplate.weekday), asc(schema.scheduleTemplate.startTime)),
      exceptions: await tx
        .select()
        .from(schema.scheduleException)
        .where(gte(schema.scheduleException.date, today()))
        .orderBy(asc(schema.scheduleException.date)),
      practitioners: await tx
        .select({
          id: schema.userAccount.id,
          displayName: schema.userAccount.displayName,
          title: schema.userAccount.title,
        })
        .from(schema.userAccount)
        .where(eq(schema.userAccount.status, 'active'))
        .orderBy(asc(schema.userAccount.displayName)),
      sites: await tx
        .select({ id: schema.site.id, name: schema.site.name })
        .from(schema.site)
        .where(eq(schema.site.isActive, true)),
      departments: await tx
        .select({
          id: schema.department.id,
          siteId: schema.department.siteId,
          name: schema.department.name,
        })
        .from(schema.department)
        .where(eq(schema.department.isActive, true))
        .orderBy(asc(schema.department.name)),
      canEdit: permissions.has('configuration:edit'),
    };
  });
}

/** Creates or updates a queue; a queue is deactivated, never deleted (tickets refer to it). */
export async function saveQueue(
  ctx: RequestContext,
  input: QueueInput,
  client: Client,
): Promise<{ id: string }> {
  try {
    return await withEditor(ctx, async (tx) => {
      const [site] = await tx
        .select({ id: schema.site.id })
        .from(schema.site)
        .where(eq(schema.site.id, input.siteId));
      if (!site) throw new AppError('NOT_FOUND', 404);
      const values = {
        code: input.code,
        name: input.name,
        ticketPrefix: input.ticketPrefix,
        siteId: input.siteId,
        departmentId: input.departmentId ?? null,
        isActive: input.isActive,
      };
      let id = input.id ?? null;
      let fields: string[] = Object.keys(values);
      if (id) {
        const [before] = await tx.select().from(schema.queue).where(eq(schema.queue.id, id));
        if (!before) throw new AppError('NOT_FOUND', 404);
        fields = changedFields(before, values);
        if (fields.length === 0) return { id };
        await tx
          .update(schema.queue)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.queue.id, id));
      } else {
        id = uuidv7();
        await tx.insert(schema.queue).values({ id, tenantId: ctx.tenantId, ...values });
      }
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: input.id ? 'update' : 'create',
        entity: 'queue',
        entityId: id,
        diff: { fields },
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('RDV_CODE_TAKEN', 409);
    throw error;
  }
}

export async function saveAppointmentType(
  ctx: RequestContext,
  input: AppointmentTypeInput,
  client: Client,
): Promise<{ id: string }> {
  try {
    return await withEditor(ctx, async (tx) => {
      const values = {
        code: input.code,
        name: input.name,
        durationMin: input.durationMin,
        color: input.color,
        departmentId: input.departmentId ?? null,
        isActive: input.isActive,
      };
      let id = input.id ?? null;
      let fields: string[] = Object.keys(values);
      if (id) {
        const [before] = await tx
          .select()
          .from(schema.appointmentType)
          .where(eq(schema.appointmentType.id, id));
        if (!before) throw new AppError('NOT_FOUND', 404);
        fields = changedFields(before, values);
        if (fields.length === 0) return { id };
        await tx
          .update(schema.appointmentType)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.appointmentType.id, id));
      } else {
        id = uuidv7();
        await tx.insert(schema.appointmentType).values({ id, tenantId: ctx.tenantId, ...values });
      }
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: input.id ? 'update' : 'create',
        entity: 'appointment_type',
        entityId: id,
        diff: { fields },
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('RDV_CODE_TAKEN', 409);
    throw error;
  }
}

async function requireResource(tx: Tx, kind: ResourceKind, id: string): Promise<void> {
  const table =
    kind === 'practitioner' ? schema.userAccount : kind === 'department' ? schema.department : null;
  // Rooms and equipment have no table yet (IMG, HOSP): their identifier is kept as given.
  if (!table) return;
  const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!row) throw new AppError('NOT_FOUND', 404);
}

/** Replaces the whole weekly template of a resource (configuration rows, audited). */
export async function saveSchedule(
  ctx: RequestContext,
  input: ScheduleInput,
  client: Client,
): Promise<void> {
  await withEditor(ctx, async (tx) => {
    await requireResource(tx, input.resourceKind, input.resourceId);
    const before = await tx
      .select()
      .from(schema.scheduleTemplate)
      .where(eq(schema.scheduleTemplate.resourceId, input.resourceId));
    await tx
      .delete(schema.scheduleTemplate)
      .where(eq(schema.scheduleTemplate.resourceId, input.resourceId));
    if (input.slots.length > 0) {
      await tx.insert(schema.scheduleTemplate).values(
        input.slots.map((s) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          ...s,
        })),
      );
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'update',
      entity: 'schedule_template',
      entityId: input.resourceId,
      diff: { before: before.length, after: input.slots.length },
    });
  });
}

export async function addScheduleException(
  ctx: RequestContext,
  input: ScheduleExceptionInput,
  client: Client,
): Promise<{ id: string }> {
  return withEditor(ctx, async (tx) => {
    await requireResource(tx, input.resourceKind, input.resourceId);
    const id = uuidv7();
    await tx.insert(schema.scheduleException).values({
      id,
      tenantId: ctx.tenantId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      date: input.date,
      kind: input.kind,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      slotMin: input.slotMin ?? null,
      reason: input.reason ?? null,
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'create',
      entity: 'schedule_exception',
      entityId: id,
      diff: { date: input.date, kind: input.kind },
    });
    return { id };
  });
}

export async function removeScheduleException(
  ctx: RequestContext,
  input: { id: string },
  client: Client,
): Promise<void> {
  await withEditor(ctx, async (tx) => {
    const removed = await tx
      .delete(schema.scheduleException)
      .where(eq(schema.scheduleException.id, input.id))
      .returning({ date: schema.scheduleException.date });
    if (removed.length === 0) throw new AppError('NOT_FOUND', 404);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      ip: client.ip,
      action: 'delete',
      entity: 'schedule_exception',
      entityId: input.id,
      diff: { date: removed[0]?.date },
    });
  });
}
