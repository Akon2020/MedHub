'use client';

import {
  authorizationFor,
  capConsumption,
  coverLine,
  parsePlan,
  voucherValid,
  type AuthorizationView,
  type CoverageContext,
  type CoveredLine,
  type LineDraft,
} from '@medhub/domain';
import type { CatalogSnapshot } from '@medhub/domain';
import type { useRuntime } from '@/client/runtime';

type Store = NonNullable<ReturnType<typeof useRuntime>['store']>;

export type CoverageInputs = {
  context: CoverageContext | null;
  voucher: 'valid' | 'missing';
  emergency: boolean;
  byCap: Record<string, number>;
  hospitalDaysUsed: number;
  authorizations: AuthorizationView[];
};

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Everything the engine needs for a patient on a day, read from the local
 * copy (offline included): active coverage, plan, voucher in force, open
 * emergency coverage of the visit, consumption already known.
 */
export async function coverageInputs(
  store: Store,
  conventions: CatalogSnapshot['conventions'] | undefined,
  patientId: string,
  encounterId: string | null,
  day: string,
): Promise<CoverageInputs> {
  const empty: CoverageInputs = {
    authorizations: [],
    context: null,
    voucher: 'missing',
    emergency: false,
    byCap: {},
    hospitalDaysUsed: 0,
  };
  if (!conventions) return empty;
  const link = (await store.readEntitiesByPatient('patient_coverage', patientId)).find(
    (e) => !e.rejected && e.data.status === 'active',
  );
  if (!link) return empty;
  const member = conventions.beneficiaries.find((b) => b.id === link.data.beneficiaryId);
  const contract = conventions.contracts.find((c) => c.id === link.data.contractId);
  const plan =
    member && contract
      ? conventions.plans.find((p) => p.contractId === contract.id && p.code === member.planCode)
      : null;
  if (!member || !contract || !plan) return empty;
  const vouchers = (await store.readEntitiesByPatient('referral_voucher', patientId))
    .filter((e) => !e.rejected)
    .map((e) => ({
      contractId: s(e.data.contractId),
      issuedOn: s(e.data.issuedOn),
      validUntil: s(e.data.validUntil),
    }));
  const exceptions = (await store.readEntitiesByPatient('coverage_exception', patientId)).filter(
    (e) =>
      !e.rejected &&
      e.data.contractId === contract.id &&
      (!encounterId || !e.data.encounterId || e.data.encounterId === encounterId),
  );
  const lines = (await store.readEntitiesByPatient('invoice_line', patientId))
    .filter((e) => !e.rejected && e.data.beneficiaryId === member.id)
    .map((e) => ({
      category: s(e.data.category),
      code: typeof e.data.code === 'string' ? e.data.code : null,
      payerShare: typeof e.data.payerShare === 'number' ? e.data.payerShare : 0,
      performedAt: s(e.data.performedAt),
      status: s(e.data.status) || 'active',
      invoiceId: s(e.data.invoiceId),
      quantity: typeof e.data.quantity === 'number' ? e.data.quantity : 1,
    }));
  const invoicesOfVisit = encounterId
    ? new Set(
        (await store.readEntitiesByPatient('invoice', patientId))
          .filter((e) => e.data.encounterId === encounterId)
          .map((e) => e.id),
      )
    : new Set<string>();
  const authorizations: AuthorizationView[] = (
    await store.readEntitiesByPatient('prior_authorization', patientId)
  )
    .filter((e) => !e.rejected && e.data.contractId === contract.id)
    .map((e) => ({
      serviceItemId: typeof e.data.serviceItemId === 'string' ? e.data.serviceItemId : null,
      status:
        e.data.status === 'approved'
          ? 'approved'
          : e.data.status === 'rejected'
            ? 'rejected'
            : 'pending',
      authorizedAmount:
        typeof e.data.authorizedAmount === 'number' ? e.data.authorizedAmount : null,
      validUntil: typeof e.data.validUntil === 'string' ? e.data.validUntil : null,
      requestedAt: s(e.data.requestedAt),
    }));
  const rules = parsePlan(plan.rules);
  return {
    authorizations,
    context: {
      contract: { id: contract.id, priceListId: contract.priceListId, currency: contract.currency },
      plan: { id: plan.id, version: plan.version, rules: plan.rules },
      member: {
        id: member.id,
        status: member.status,
        validFrom: member.validFrom,
        validUntil: member.validUntil,
        isDayLaborer: member.isDayLaborer,
      },
    },
    voucher: voucherValid(vouchers, contract.id, day) ? 'valid' : 'missing',
    emergency: exceptions.some((e) => e.data.status === 'open' || e.data.status === 'regularized'),
    byCap: rules ? capConsumption(rules, lines, day) : {},
    hospitalDaysUsed: lines
      .filter(
        (l) =>
          l.status !== 'superseded' && l.category === 'bed_day' && invoicesOfVisit.has(l.invoiceId),
      )
      .reduce((n, l) => n + l.quantity, 0),
  };
}

/** Covers a priced line for the patient; a patient without contract keeps it as is. */
export function applyCoverage(
  line: LineDraft,
  inputs: CoverageInputs,
  finance: CatalogSnapshot['finance'] | undefined,
  day: string,
  department: string | null = null,
): CoveredLine {
  const priorAuthorization = authorizationFor(
    inputs.authorizations,
    line.serviceItemId ?? null,
    day,
  );
  return coverLine({
    line,
    serviceItemId: line.serviceItemId ?? null,
    day,
    performedAt: new Date().toISOString(),
    department,
    coverage: inputs.context,
    catalog: { priceLists: finance?.priceLists ?? [], prices: finance?.prices ?? [] },
    voucher: inputs.voucher,
    emergency: inputs.emergency,
    priorAuthorization,
    consumption: { byCap: inputs.byCap, hospitalDaysUsed: inputs.hospitalDaysUsed },
  });
}

/** The fields of a covered line in an invoice.add_line payload. */
export function coveredFields(covered: CoveredLine) {
  return {
    payerShare: covered.payerShare,
    contractId: covered.contractId,
    beneficiaryId: covered.beneficiaryId,
    coverage: covered.coverage,
  };
}
