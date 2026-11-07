import {
  capApplies,
  evaluateCoverage,
  planRules,
  type CoverageResult,
  type PlanRules,
} from '@medhub/conventions';
import { z } from 'zod';
import type { LineDraft } from '../fact/invoice';
import { resolvePrice, type Price, type PriceList } from '../fact/pricing';

/**
 * Coverage of the invoice lines of a covered patient (docs/modules/conv.md):
 * the engine of @medhub/conventions decides, this module prices the line
 * (negotiated list when covered, public list otherwise: owner decision S11)
 * and keeps the trace. Shared by the offline cash desk and the server.
 */
export const referralVoucherPayload = z
  .object({
    patientId: z.uuid(),
    contractId: z.uuid(),
    beneficiaryId: z.uuid(),
    number: z.string().trim().min(1).max(40),
    signatory: z.string().trim().min(2).max(120),
    issuedOn: z.iso.date(),
    validUntil: z.iso.date(),
    encounterId: z.uuid().nullish(),
    registeredAt: z.iso.datetime(),
  })
  .refine((v) => v.validUntil >= v.issuedOn, {
    message: 'CONV_VOUCHER_DATES',
    path: ['validUntil'],
  });

export const coverageExceptionPayload = z.object({
  patientId: z.uuid(),
  contractId: z.uuid(),
  encounterId: z.uuid().nullish(),
  reason: z.string().trim().min(5).max(300),
  recordedAt: z.iso.datetime(),
  dueBy: z.iso.datetime(),
  status: z.literal('open').default('open'),
});

export const coverageRegularizePayload = z.object({
  status: z.literal('regularized').default('regularized'),
  voucherId: z.uuid(),
});

export type CoverageContext = {
  contract: { id: string; priceListId: string | null; currency: string };
  plan: { id: string; version: number; rules: unknown };
  member: {
    id: string;
    status: string;
    validFrom: string;
    validUntil: string | null;
    isDayLaborer: boolean;
  };
};

export type CoveredLine = {
  line: LineDraft;
  payerShare: number;
  contractId: string | null;
  beneficiaryId: string | null;
  coverage: Record<string, unknown> | null;
  decision: CoverageResult['decision'] | null;
  action: CoverageResult['action'];
  requires: CoverageResult['requires'];
};

export function parsePlan(rules: unknown): PlanRules | null {
  const parsed = planRules.safeParse(rules);
  return parsed.success ? parsed.data : null;
}

/** A referral voucher in force on a day, for a contract. */
export function voucherValid(
  vouchers: readonly { contractId: string; issuedOn: string; validUntil: string }[],
  contractId: string,
  day: string,
): boolean {
  return vouchers.some(
    (v) => v.contractId === contractId && v.issuedOn <= day && day <= v.validUntil,
  );
}

/** Amounts the payer already covered per cap of the plan, for the period of each cap. */
export function capConsumption(
  plan: PlanRules,
  lines: readonly {
    category: string;
    code: string | null;
    payerShare: number;
    performedAt: string;
    status: string;
  }[],
  day: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cap of plan.caps) {
    const from =
      cap.period === 'year'
        ? `${day.slice(0, 4)}-01-01`
        : cap.period === 'month'
          ? `${day.slice(0, 7)}-01`
          : day;
    out[cap.id] = lines
      .filter(
        (l) =>
          l.status !== 'superseded' &&
          l.performedAt.slice(0, 10) >= from &&
          capApplies(cap, {
            serviceCode: l.code,
            category: l.category,
            department: null,
            quantity: 1,
            unitPrice: 0,
            currency: plan.currency,
            performedAt: l.performedAt,
          }),
      )
      .reduce((s, l) => s + l.payerShare, 0);
  }
  return out;
}

/**
 * Prices and covers one line. Covered acts take the price of the contract's
 * list when it has one; an act the contract does not cover is paid by the
 * patient at the public price (owner decision S11). Without a price the line
 * cannot be evaluated yet: it is kept and evaluated again once priced.
 */
export function coverLine(args: {
  line: LineDraft;
  serviceItemId: string | null;
  day: string;
  performedAt: string;
  department: string | null;
  coverage: CoverageContext | null;
  catalog: { priceLists: readonly PriceList[]; prices: readonly Price[] };
  voucher: 'valid' | 'missing';
  emergency: boolean;
  priorAuthorization: {
    status: 'approved' | 'pending' | 'rejected' | 'none';
    authorizedAmount?: number | null;
  };
  consumption: { byCap: Readonly<Record<string, number>>; hospitalDaysUsed: number };
}): CoveredLine {
  const none: CoveredLine = {
    line: args.line,
    payerShare: 0,
    contractId: null,
    beneficiaryId: null,
    coverage: null,
    decision: null,
    action: null,
    requires: [],
  };
  if (!args.coverage || args.line.unitPrice === null) return none;
  const plan = parsePlan(args.coverage.plan.rules);
  if (!plan)
    return { ...none, coverage: { decision: 'not_covered', reasons: ['CONV_PLAN_INVALID'] } };

  const negotiated =
    args.coverage.contract.priceListId && args.serviceItemId
      ? resolvePrice(
          {
            serviceItemId: args.serviceItemId,
            day: args.day,
            coveragePriceListId: args.coverage.contract.priceListId,
          },
          args.catalog.priceLists,
          args.catalog.prices,
        )
      : null;
  const contractLine: LineDraft =
    negotiated && negotiated.priceListId === args.coverage.contract.priceListId
      ? {
          ...args.line,
          unitPrice: negotiated.unitPrice.amount,
          currency: negotiated.unitPrice.currency,
          priceListId: negotiated.priceListId,
        }
      : args.line;

  const result = evaluateCoverage({
    plan,
    ruleVersion: `${args.coverage.plan.id}@${args.coverage.plan.version}`,
    line: {
      serviceCode: args.line.code ?? null,
      category: args.line.category,
      department: args.department,
      quantity: contractLine.quantity,
      unitPrice: contractLine.unitPrice ?? 0,
      currency: contractLine.currency,
      performedAt: args.performedAt,
    },
    beneficiary: {
      status:
        args.coverage.member.status === 'active'
          ? 'active'
          : args.coverage.member.status === 'left'
            ? 'left'
            : 'suspended',
      validFrom: args.coverage.member.validFrom,
      validUntil: args.coverage.member.validUntil,
    },
    consumption: args.consumption,
    context: {
      emergency: args.emergency,
      voucher: args.voucher,
      priorAuthorization: args.priorAuthorization,
      isDayLaborer: args.coverage.member.isDayLaborer,
    },
  });
  const trace = {
    planCode: plan.code,
    decision: result.decision,
    matchedRule: result.matchedRule,
    ruleVersion: result.ruleVersion,
    billing: result.billing,
    action: result.action,
    reasons: result.reasons,
    warnings: result.warnings,
    requires: result.requires,
    thirdPartyShare: result.thirdPartyShare,
    patientShare: result.patientShare,
  };
  const covered = result.thirdPartyShare > 0;
  return {
    line: covered ? contractLine : args.line,
    payerShare: covered ? result.thirdPartyShare : 0,
    contractId: args.coverage.contract.id,
    beneficiaryId: args.coverage.member.id,
    coverage: trace,
    decision: result.decision,
    action: result.action,
    requires: result.requires,
  };
}
