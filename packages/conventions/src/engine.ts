import type { CapDefinition, CoverageRule, PlanRules } from './schema';

/**
 * Coverage engine (docs/modules/conv.md section 4): pure and deterministic,
 * run at the offline cash desk and again by the server. The order of
 * evaluation is fixed: beneficiary, referral voucher or emergency, day
 * laborer, most specific rule, prior authorization, hospital days, caps,
 * patient share, rounding. The whole trace is kept on the invoice line.
 */
export type CoverageDecision =
  'covered' | 'partially_covered' | 'not_covered' | 'blocked' | 'needs_prior_authorization';

export type Requirement = 'voucher' | 'prior_authorization' | 'justification';

export type CoverageInput = {
  plan: PlanRules;
  ruleVersion: string;
  line: {
    serviceCode: string | null;
    category: string;
    /** Department code where the act is performed (specialty). */
    department: string | null;
    quantity: number;
    unitPrice: number;
    currency: string;
    performedAt: string;
  };
  beneficiary: {
    status: 'active' | 'suspended' | 'left';
    validFrom: string;
    validUntil: string | null;
  };
  /** Amounts already consumed per cap id, and hospital days already used for the stay. */
  consumption: { byCap: Readonly<Record<string, number>>; hospitalDaysUsed: number };
  context: {
    emergency: boolean;
    voucher: 'valid' | 'missing';
    priorAuthorization: {
      status: 'approved' | 'pending' | 'rejected' | 'none';
      authorizedAmount?: number | null;
    };
    isDayLaborer: boolean;
  };
};

export type CoverageResult = {
  decision: CoverageDecision;
  patientShare: number;
  thirdPartyShare: number;
  /** How the third party share is billed: inside the package, or per act (hors forfait). */
  billing: 'package' | 'per_act' | 'none';
  matchedRule: string | null;
  ruleVersion: string;
  /** What the cash desk does when the act is not covered. */
  action: 'block' | 'warn' | null;
  reasons: string[];
  warnings: string[];
  requires: Requirement[];
  /** Cap consumption added by this line, per cap id. */
  consumed: Record<string, number>;
};

/** Specificity: a service code beats a category with specialty, which beats a category. */
function specificity(rule: CoverageRule, line: CoverageInput['line']): number {
  const m = rule.match;
  if (m.serviceCodes?.length) {
    if (!line.serviceCode || !m.serviceCodes.includes(line.serviceCode)) return -1;
    return 3;
  }
  if (m.category && m.category !== line.category) return -1;
  if (m.specialties?.length) {
    if (!line.department || !m.specialties.includes(line.department)) return -1;
    return m.category ? 2 : 1.5;
  }
  return m.category ? 1 : -1;
}

export function matchRule(
  rules: readonly CoverageRule[],
  line: CoverageInput['line'],
): CoverageRule | null {
  let best: CoverageRule | null = null;
  let score = -1;
  for (const rule of rules) {
    const s = specificity(rule, line);
    // First rule wins among equally specific ones: the order of the table is kept.
    if (s > score) {
      best = rule;
      score = s;
    }
  }
  return best;
}

function capApplies(cap: CapDefinition, line: CoverageInput['line']): boolean {
  if (cap.serviceCodes?.length)
    return Boolean(line.serviceCode && cap.serviceCodes.includes(line.serviceCode));
  if (cap.categories?.length) return cap.categories.includes(line.category);
  return true;
}

/** Percentage of an amount in minor units, halves away from zero, never fractional. */
export function percentOf(amount: number, percent: number): number {
  return Math.floor((amount * percent + 50) / 100);
}

const day = (iso: string) => iso.slice(0, 10);

export function evaluateCoverage(input: CoverageInput): CoverageResult {
  const { plan, line, beneficiary, consumption, context } = input;
  const total = line.quantity * line.unitPrice;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const requires: Requirement[] = [];
  const result = (
    decision: CoverageDecision,
    thirdPartyShare: number,
    billing: CoverageResult['billing'],
    matchedRule: string | null,
    action: CoverageResult['action'],
    consumed: Record<string, number> = {},
  ): CoverageResult => ({
    decision,
    patientShare: total - thirdPartyShare,
    thirdPartyShare,
    billing,
    matchedRule,
    ruleVersion: input.ruleVersion,
    action,
    reasons,
    warnings,
    requires,
    consumed,
  });

  if (line.currency !== plan.currency) {
    reasons.push('CONV_CURRENCY_MISMATCH');
    return result('not_covered', 0, 'none', null, 'warn');
  }

  // 1. Beneficiary in force on the day of the act.
  const at = day(line.performedAt);
  if (
    beneficiary.status !== 'active' ||
    at < beneficiary.validFrom ||
    (beneficiary.validUntil !== null && at > beneficiary.validUntil)
  ) {
    reasons.push('CONV_BENEFICIARY_INACTIVE');
    return result('not_covered', 0, 'none', null, 'warn');
  }

  // 2. Referral voucher, or emergency covered now and regularised later.
  if (plan.voucherRequired && context.voucher !== 'valid') {
    if (!context.emergency) {
      reasons.push('CONV_VOUCHER_REQUIRED');
      requires.push('voucher');
      return result('blocked', 0, 'none', null, 'block');
    }
    warnings.push('CONV_VOUCHER_TO_REGULARISE');
    requires.push('voucher');
  }

  // 3. Day laborers of subcontractors: emergencies only, billed per act outside the package.
  if (context.isDayLaborer) {
    if (!context.emergency) {
      reasons.push('CONV_DAY_LABORER_EMERGENCY_ONLY');
      return result('not_covered', 0, 'none', null, 'warn');
    }
    reasons.push('CONV_DAY_LABORER');
    return result('covered', total, 'per_act', null, null);
  }

  // 4. Most specific rule, else the default of the plan.
  const rule = matchRule(plan.rules, line);
  const coverage = rule?.coverage ?? plan.default.coverage;
  const action = rule?.action ?? plan.default.action;
  const billing: CoverageResult['billing'] = plan.billing === 'per_act' ? 'per_act' : 'package';
  if (!rule) reasons.push('CONV_DEFAULT_RULE');

  // 5. Prior authorization: an excluded act becomes covered for the authorized amount.
  if (rule?.priorAuthorization) {
    const pa = context.priorAuthorization;
    if (pa.status === 'approved') {
      const authorized = Math.min(total, pa.authorizedAmount ?? total);
      reasons.push('CONV_PRIOR_AUTHORIZATION_APPROVED');
      return result(
        authorized < total ? 'partially_covered' : 'covered',
        authorized,
        'per_act',
        rule.id,
        null,
      );
    }
    requires.push('prior_authorization');
    if (pa.status === 'rejected') {
      reasons.push('CONV_PRIOR_AUTHORIZATION_REJECTED');
      return result('not_covered', 0, 'none', rule.id, action);
    }
    reasons.push('CONV_PRIOR_AUTHORIZATION_NEEDED');
    return result('needs_prior_authorization', 0, 'none', rule.id, rule.action ?? 'block');
  }

  if (coverage === 'excluded') {
    reasons.push('CONV_EXCLUDED');
    return result('not_covered', 0, 'none', rule?.id ?? null, action);
  }

  let thirdParty = total;
  if (coverage === 'percent') thirdParty = percentOf(total, rule?.percent ?? 0);
  if (coverage === 'capped') thirdParty = Math.min(total, (rule?.capAmount ?? 0) * line.quantity);
  let lineBilling = billing;

  // 6. Hospital days beyond the package (one line per day): billed per act, justified.
  if (line.category === 'bed_day' && plan.hospitalization) {
    if (consumption.hospitalDaysUsed >= plan.hospitalization.packageDays) {
      warnings.push('CONV_HOSPITAL_DAYS_EXCEEDED');
      if (plan.hospitalization.justificationRequired) requires.push('justification');
      lineBilling = 'per_act';
    } else if (consumption.hospitalDaysUsed + 1 === plan.hospitalization.packageDays) {
      warnings.push('CONV_HOSPITAL_LAST_PACKAGE_DAY');
    }
  }

  // 7. Caps: consumption already known plus this line.
  const consumed: Record<string, number> = {};
  for (const cap of plan.caps) {
    if (!capApplies(cap, line)) continue;
    const used = consumption.byCap[cap.id] ?? 0;
    const room = Math.max(0, cap.amount - used);
    if (thirdParty > room) {
      warnings.push(`CONV_CAP_REACHED_${cap.id}`);
      thirdParty = room;
    }
    consumed[cap.id] = thirdParty;
  }

  // 8. Patient share (ticket modérateur).
  const copay = plan.copay.find((c) =>
    c.serviceCodes?.length
      ? Boolean(line.serviceCode && c.serviceCodes.includes(line.serviceCode))
      : !c.category || c.category === line.category,
  );
  if (copay && copay.patientPercent > 0) {
    thirdParty -= percentOf(thirdParty, copay.patientPercent);
    reasons.push('CONV_COPAY');
  }
  for (const id of Object.keys(consumed)) consumed[id] = thirdParty;

  reasons.push(
    coverage === 'included'
      ? 'CONV_INCLUDED'
      : coverage === 'percent'
        ? 'CONV_PERCENT'
        : 'CONV_CAPPED',
  );
  const decision: CoverageDecision =
    thirdParty <= 0 ? 'not_covered' : thirdParty < total ? 'partially_covered' : 'covered';
  return result(
    decision,
    Math.max(0, thirdParty),
    thirdParty > 0 ? lineBilling : 'none',
    rule?.id ?? null,
    decision === 'not_covered' ? action : null,
    consumed,
  );
}
