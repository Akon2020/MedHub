import 'server-only';
import { createHash } from 'node:crypto';
import { appendAudit, schema, type Tx, withTenant } from '@medhub/db';
import {
  parseChoiceItems,
  type CatalogSnapshot,
  type ChoiceItemInput,
  type ChoiceItemsSaveInput,
  type ChoiceListCreateInput,
  type ChoiceListUpdateInput,
  type ImportError,
} from '@medhub/domain';
import { AppError, parseCsv, uuidv7 } from '@medhub/shared';
import { asc, count, eq, gte } from 'drizzle-orm';
import { database } from '../../platform/db';
import { loadPermissions, requirePermission } from '../../platform/permissions';
import type { RequestContext } from '../../platform/tenant';
import { requireRecentStepUp } from './configuration';
import {
  activeDiagnoses,
  activeDrugs,
  activePrograms,
  effectiveVitalDefinitions,
  interactionRules,
} from '../dpi';
import { conventionsCatalog } from '../conv';
import { financeCatalog } from '../fact';
import { publishedFormVersions } from '../form';

type Client = { ip: string | null };

export type ChoiceListView = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  items: (ChoiceItemInput & { id: string })[];
};

export type ReferenceOverview = {
  choiceLists: ChoiceListView[];
  currencies: CatalogSnapshot['currencies'];
  units: CatalogSnapshot['units'];
  areas: { level: number; kind: string; count: number }[];
  provinces: { code: string; name: string }[];
  canEdit: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}

function inTenant<T>(
  ctx: RequestContext,
  permission: string,
  fn: (tx: Tx, permissions: ReadonlySet<string>) => Promise<T>,
  options: { stepUp: boolean },
): Promise<T> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const permissions = await loadPermissions(tx, ctx.userId);
    requirePermission(permissions, permission);
    if (options.stepUp) await requireRecentStepUp(tx, ctx);
    return fn(tx, permissions);
  });
}

async function platformCatalogs(tx: Tx) {
  const currencies = await tx.select().from(schema.currency).orderBy(asc(schema.currency.code));
  const units = await tx
    .select()
    .from(schema.unit)
    .orderBy(asc(schema.unit.kind), asc(schema.unit.code));
  const provinces = await tx
    .select({ code: schema.adminArea.code, name: schema.adminArea.name })
    .from(schema.adminArea)
    .where(eq(schema.adminArea.level, 1))
    .orderBy(asc(schema.adminArea.name));
  return { currencies, units, provinces };
}

async function loadLists(tx: Tx): Promise<ChoiceListView[]> {
  const lists = await tx.select().from(schema.choiceList).orderBy(asc(schema.choiceList.nameFr));
  const items = await tx
    .select()
    .from(schema.choiceItem)
    .orderBy(asc(schema.choiceItem.sortOrder), asc(schema.choiceItem.code));
  return lists.map((l) => ({
    id: l.id,
    code: l.code,
    nameFr: l.nameFr,
    nameEn: l.nameEn,
    description: l.description,
    isActive: l.isActive,
    version: l.version,
    items: items
      .filter((i) => i.listId === l.id)
      .map((i) => ({
        id: i.id,
        code: i.code,
        labelFr: i.labelFr,
        labelEn: i.labelEn,
        sortOrder: i.sortOrder,
        isActive: i.isActive,
      })),
  }));
}

export async function getReference(ctx: RequestContext): Promise<ReferenceOverview> {
  return inTenant(
    ctx,
    'configuration:read',
    async (tx, permissions) => {
      const { currencies, units, provinces } = await platformCatalogs(tx);
      const areas = await tx
        .select({ level: schema.adminArea.level, kind: schema.adminArea.kind, count: count() })
        .from(schema.adminArea)
        .groupBy(schema.adminArea.level, schema.adminArea.kind)
        .orderBy(asc(schema.adminArea.level), asc(schema.adminArea.kind));
      return {
        choiceLists: await loadLists(tx),
        currencies,
        units,
        areas,
        provinces,
        canEdit: permissions.has('configuration:edit'),
      };
    },
    { stepUp: false },
  );
}

export async function createChoiceList(
  ctx: RequestContext,
  input: ChoiceListCreateInput,
  client: Client,
): Promise<{ listId: string }> {
  try {
    return await inTenant(
      ctx,
      'configuration:edit',
      async (tx) => {
        const listId = uuidv7();
        await tx.insert(schema.choiceList).values({
          id: listId,
          tenantId: ctx.tenantId,
          code: input.code,
          nameFr: input.nameFr,
          nameEn: input.nameEn ?? null,
          description: input.description ?? null,
        });
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          ip: client.ip,
          action: 'choice_list_create',
          entity: 'choice_list',
          entityId: listId,
          diff: { code: input.code },
        });
        return { listId };
      },
      { stepUp: true },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('REF_LIST_CODE_TAKEN', 409);
    throw error;
  }
}

async function findList(tx: Tx, listId: string) {
  const [list] = await tx
    .select()
    .from(schema.choiceList)
    .where(eq(schema.choiceList.id, listId))
    .limit(1);
  if (!list) throw new AppError('NOT_FOUND', 404);
  return list;
}

export async function updateChoiceList(
  ctx: RequestContext,
  input: ChoiceListUpdateInput,
  client: Client,
): Promise<void> {
  await inTenant(
    ctx,
    'configuration:edit',
    async (tx) => {
      const list = await findList(tx, input.listId);
      await tx
        .update(schema.choiceList)
        .set({
          nameFr: input.nameFr,
          nameEn: input.nameEn ?? null,
          description: input.description ?? null,
          isActive: input.isActive,
          version: list.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.choiceList.id, list.id));
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        ip: client.ip,
        action: 'choice_list_update',
        entity: 'choice_list',
        entityId: list.id,
        diff: { isActive: input.isActive, version: list.version + 1 },
      });
    },
    { stepUp: true },
  );
}

/**
 * Saves the items of a list as a whole. Items are matched by code; a code that
 * is no longer in the list is deactivated, never deleted, so that what was
 * recorded with it keeps its meaning.
 */
export async function saveChoiceItems(
  ctx: RequestContext,
  input: ChoiceItemsSaveInput,
  client: Client,
): Promise<{ added: number; updated: number; deactivated: number }> {
  return inTenant(
    ctx,
    'configuration:edit',
    async (tx) => {
      const list = await findList(tx, input.listId);
      const existing = await tx
        .select()
        .from(schema.choiceItem)
        .where(eq(schema.choiceItem.listId, list.id));
      const byCode = new Map(existing.map((i) => [i.code, i]));
      const requested = new Set(input.items.map((i) => i.code));
      const now = new Date();
      let added = 0;
      let updated = 0;
      let deactivated = 0;
      for (const item of input.items) {
        const found = byCode.get(item.code);
        if (!found) {
          await tx.insert(schema.choiceItem).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            listId: list.id,
            code: item.code,
            labelFr: item.labelFr,
            labelEn: item.labelEn ?? null,
            sortOrder: item.sortOrder,
            isActive: item.isActive,
          });
          added += 1;
        } else if (
          found.labelFr !== item.labelFr ||
          found.labelEn !== (item.labelEn ?? null) ||
          found.sortOrder !== item.sortOrder ||
          found.isActive !== item.isActive
        ) {
          await tx
            .update(schema.choiceItem)
            .set({
              labelFr: item.labelFr,
              labelEn: item.labelEn ?? null,
              sortOrder: item.sortOrder,
              isActive: item.isActive,
              updatedAt: now,
            })
            .where(eq(schema.choiceItem.id, found.id));
          updated += 1;
        }
      }
      for (const item of existing) {
        if (requested.has(item.code) || !item.isActive) continue;
        await tx
          .update(schema.choiceItem)
          .set({ isActive: false, updatedAt: now })
          .where(eq(schema.choiceItem.id, item.id));
        deactivated += 1;
      }
      if (added + updated + deactivated > 0) {
        await tx
          .update(schema.choiceList)
          .set({ version: list.version + 1, updatedAt: now })
          .where(eq(schema.choiceList.id, list.id));
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          ip: client.ip,
          action: 'choice_items_save',
          entity: 'choice_list',
          entityId: list.id,
          diff: { added, updated, deactivated, version: list.version + 1 },
        });
      }
      return { added, updated, deactivated };
    },
    { stepUp: true },
  );
}

/** First step of an import: the file is checked line by line, nothing is written. */
export async function simulateChoiceImport(
  ctx: RequestContext,
  input: { listId: string; csv: string },
): Promise<{ items: ChoiceItemInput[]; errors: ImportError[] }> {
  return inTenant(
    ctx,
    'configuration:edit',
    async (tx) => {
      await findList(tx, input.listId);
      return parseChoiceItems(parseCsv(input.csv));
    },
    { stepUp: false },
  );
}

/**
 * Read-only catalogs for the devices. The etag lets a device skip the download
 * when nothing changed since its last copy.
 */
export async function catalogSnapshot(ctx: RequestContext): Promise<CatalogSnapshot> {
  return withTenant(database().db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const { currencies, units, provinces } = await platformCatalogs(tx);
    const sites = await tx
      .select({
        id: schema.site.id,
        code: schema.site.code,
        name: schema.site.name,
        isActive: schema.site.isActive,
      })
      .from(schema.site)
      .orderBy(asc(schema.site.code));
    const departments = await tx
      .select({
        id: schema.department.id,
        siteId: schema.department.siteId,
        code: schema.department.code,
        name: schema.department.name,
        isActive: schema.department.isActive,
      })
      .from(schema.department)
      .orderBy(asc(schema.department.name));
    const choiceLists = (await loadLists(tx))
      .filter((l) => l.isActive)
      .map((l) => ({
        code: l.code,
        nameFr: l.nameFr,
        nameEn: l.nameEn,
        items: l.items
          .filter((i) => i.isActive)
          .map((i) => ({ code: i.code, labelFr: i.labelFr, labelEn: i.labelEn ?? null })),
      }));
    const queues = await tx
      .select({
        id: schema.queue.id,
        code: schema.queue.code,
        name: schema.queue.name,
        ticketPrefix: schema.queue.ticketPrefix,
        siteId: schema.queue.siteId,
        departmentId: schema.queue.departmentId,
      })
      .from(schema.queue)
      .where(eq(schema.queue.isActive, true))
      .orderBy(asc(schema.queue.name));
    const appointmentTypes = await tx
      .select({
        id: schema.appointmentType.id,
        code: schema.appointmentType.code,
        name: schema.appointmentType.name,
        durationMin: schema.appointmentType.durationMin,
        color: schema.appointmentType.color,
        departmentId: schema.appointmentType.departmentId,
      })
      .from(schema.appointmentType)
      .where(eq(schema.appointmentType.isActive, true))
      .orderBy(asc(schema.appointmentType.name));
    const schedules = await tx
      .select({
        resourceKind: schema.scheduleTemplate.resourceKind,
        resourceId: schema.scheduleTemplate.resourceId,
        weekday: schema.scheduleTemplate.weekday,
        startTime: schema.scheduleTemplate.startTime,
        endTime: schema.scheduleTemplate.endTime,
        slotMin: schema.scheduleTemplate.slotMin,
        overbookMax: schema.scheduleTemplate.overbookMax,
      })
      .from(schema.scheduleTemplate)
      .orderBy(
        asc(schema.scheduleTemplate.resourceId),
        asc(schema.scheduleTemplate.weekday),
        asc(schema.scheduleTemplate.startTime),
      );
    // Exceptions from yesterday on: enough for an agenda kept offline for a few weeks.
    const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const scheduleExceptions = (
      await tx
        .select({
          resourceId: schema.scheduleException.resourceId,
          date: schema.scheduleException.date,
          kind: schema.scheduleException.kind,
          startTime: schema.scheduleException.startTime,
          endTime: schema.scheduleException.endTime,
          slotMin: schema.scheduleException.slotMin,
        })
        .from(schema.scheduleException)
        .where(gte(schema.scheduleException.date, since))
        .orderBy(asc(schema.scheduleException.date), asc(schema.scheduleException.id))
    ).map((e) => ({ ...e, kind: e.kind as 'closed' | 'extra' }));
    const staff = await tx
      .select({
        id: schema.userAccount.id,
        displayName: schema.userAccount.displayName,
        title: schema.userAccount.title,
      })
      .from(schema.userAccount)
      .where(eq(schema.userAccount.status, 'active'))
      .orderBy(asc(schema.userAccount.displayName), asc(schema.userAccount.id));
    const [tenant] = await tx
      .select({ timeZone: schema.tenant.timezone, legalMentions: schema.tenant.legalMentions })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, ctx.tenantId));
    const vitalDefinitions = (await effectiveVitalDefinitions(tx)).map(
      ({ configured: _c, ...d }) => d,
    );
    const programs = (await activePrograms(tx)).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      followUpIntervalDays: p.followUpIntervalDays,
      graceDays: p.graceDays,
    }));
    const diagnoses = await activeDiagnoses(tx);
    const forms = await publishedFormVersions(tx);
    const conventions = await conventionsCatalog(tx);
    const finance = await financeCatalog(tx, new Date().toISOString().slice(0, 10));
    const drugs = await activeDrugs(tx);
    const rules = await interactionRules(tx);
    const body = {
      conventions,
      finance,
      drugs,
      interactionRules: rules,
      diagnoses,
      forms,
      programs,
      vitalDefinitions,
      timeZone: tenant?.timeZone ?? 'Africa/Kinshasa',
      legalMentions: tenant?.legalMentions ?? null,
      currencies,
      units,
      provinces,
      sites,
      departments,
      choiceLists,
      queues,
      appointmentTypes,
      schedules,
      scheduleExceptions,
      staff,
    };
    const etag = createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 22);
    return { etag, ...body };
  });
}
