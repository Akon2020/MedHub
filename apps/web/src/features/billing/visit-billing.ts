'use client';

import {
  billingRuleFor,
  formatNumber,
  INVOICE_NUMBER_TEMPLATE,
  lineFor,
  type CoveredLine,
  type LineDraft,
} from '@medhub/domain';
import type { CatalogSnapshot } from '@medhub/domain';
import type { useRuntime } from '@/client/runtime';
import { localDay } from '@/features/visits/visit-helpers';
import { applyCoverage, coverageInputs, coveredFields } from './coverage-billing';

type Dispatch = ReturnType<typeof useRuntime>['dispatch'];

export type BillingContext = {
  dispatch: Dispatch;
  nextCounter: (name: string) => Promise<number>;
  finance: CatalogSnapshot['finance'] | undefined;
  siteCode: string;
  deviceCode: string;
  permissions: readonly string[];
  /** Local store and contracts: the line is covered when the patient has a contract (S11). */
  store?: NonNullable<ReturnType<typeof useRuntime>['store']>;
  conventions?: CatalogSnapshot['conventions'];
};

/** Opens an invoice for a patient (offline number carrying the device code). */
export async function openInvoice(
  ctx: BillingContext,
  input: { patientId: string; encounterId: string | null; currency: string; dependsOn?: string[] },
): Promise<{ entityId: string; opId: string }> {
  const now = new Date();
  const seq = await ctx.nextCounter(`invoice:${now.getFullYear()}`);
  return ctx.dispatch(
    'invoice.open',
    {
      patientId: input.patientId,
      encounterId: input.encounterId,
      currency: input.currency,
      number: formatNumber(INVOICE_NUMBER_TEMPLATE, {
        site: ctx.siteCode,
        device: ctx.deviceCode,
        year: now.getFullYear(),
        seq,
      }),
      openedAt: now.toISOString(),
    },
    { dependsOn: input.dependsOn },
  );
}

export async function addLine(
  ctx: BillingContext,
  input: {
    invoiceId: string;
    patientId: string;
    line: LineDraft;
    source?: { table: string; id: string };
    supersedesId?: string | null;
    manualPrice?: boolean;
    /** Coverage computed for the line; the priced line it carries replaces `line`. */
    covered?: CoveredLine;
    reevaluation?: boolean;
    dependsOn?: string[];
  },
): Promise<{ entityId: string; opId: string }> {
  return ctx.dispatch(
    'invoice.add_line',
    {
      ...(input.covered?.line ?? input.line),
      ...(input.covered ? coveredFields(input.covered) : {}),
      reevaluation: input.reevaluation ?? false,
      invoiceId: input.invoiceId,
      patientId: input.patientId,
      sourceTable: input.source?.table ?? null,
      sourceId: input.source?.id ?? null,
      performedAt: new Date().toISOString(),
      supersedesId: input.supersedesId ?? null,
      manualPrice: input.manualPrice ?? false,
    },
    { dependsOn: input.dependsOn },
  );
}

/**
 * Billing of a visit opening (owner decision S10): the configured service is
 * added to a new invoice of the visit, priced from the lists of the day, on
 * the workstation and offline included. Without a rule nothing is billed;
 * without a price the line is kept and flagged to the cash desk.
 */
export async function billVisitOpening(
  ctx: BillingContext,
  visit: { id: string; opId: string; patientId: string; kind: string; departmentId: string | null },
): Promise<boolean> {
  const finance = ctx.finance;
  if (!finance || !ctx.permissions.includes('invoice:create')) return false;
  if (!ctx.permissions.includes('invoice:add_line')) return false;
  const rule = billingRuleFor(finance.billingRules ?? [], visit);
  const service = rule ? finance.serviceItems.find((s) => s.id === rule.serviceItemId) : null;
  if (!service || !service.isActive) return false;
  const fallback =
    finance.priceLists.find((l) => l.kind === 'public' && l.isActive)?.currency ?? 'USD';
  const day = localDay(new Date());
  const line = lineFor(service, day, finance, fallback);
  const covered = ctx.store
    ? applyCoverage(
        line,
        await coverageInputs(ctx.store, ctx.conventions, visit.patientId, visit.id, day),
        finance,
        day,
      )
    : undefined;
  const invoice = await openInvoice(ctx, {
    patientId: visit.patientId,
    encounterId: visit.id,
    currency: covered?.line.currency ?? line.currency,
    dependsOn: [visit.opId],
  });
  await addLine(ctx, {
    invoiceId: invoice.entityId,
    patientId: visit.patientId,
    line,
    covered,
    source: { table: 'encounter', id: visit.id },
    dependsOn: [invoice.opId],
  });
  return true;
}
