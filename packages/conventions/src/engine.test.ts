import { describe, expect, it } from 'vitest';
import { evaluateCoverage, percentOf, type CoverageInput } from './engine';
import { OPEN_CLINIC_PLANS, PLAN_A, PLAN_B, PLAN_C, PLAN_D } from './fixtures/open-clinic';
import { isGenerationDay, monthDue, packagesDue } from './packages';
import { planRules, type PlanRulesInput } from './schema';

const plans = Object.fromEntries(
  [PLAN_A, PLAN_B, PLAN_C, PLAN_D].map((p) => [p.code, planRules.parse(p)]),
);

const input = (
  plan: string,
  serviceCode: string,
  category: string,
  over: Partial<{
    unitPrice: number;
    quantity: number;
    context: Partial<CoverageInput['context']>;
    consumption: Partial<CoverageInput['consumption']>;
    beneficiary: Partial<CoverageInput['beneficiary']>;
  }> = {},
): CoverageInput => ({
  plan: plans[plan]!,
  ruleVersion: `${plan}@1`,
  line: {
    serviceCode,
    category,
    department: null,
    quantity: over.quantity ?? 1,
    unitPrice: over.unitPrice ?? 1000,
    currency: 'USD',
    performedAt: '2026-11-07T09:00:00.000Z',
  },
  beneficiary: { status: 'active', validFrom: '2026-01-01', validUntil: null, ...over.beneficiary },
  consumption: { byCap: {}, hospitalDaysUsed: 0, ...over.consumption },
  context: {
    emergency: false,
    voucher: 'valid',
    priorAuthorization: { status: 'none' },
    isDayLaborer: false,
    ...over.context,
  },
});

describe('demonstration plans', () => {
  it('are valid plan rules', () => {
    for (const p of OPEN_CLINIC_PLANS) expect(planRules.safeParse(p).success).toBe(true);
  });
});

describe('coverage engine: reference cases A to D', () => {
  it('covers an included act in full, inside the package, with its rule in the trace', () => {
    for (const code of ['A', 'B', 'C']) {
      const r = evaluateCoverage(input(code, 'CONS-GEN', 'consultation'));
      expect(r).toMatchObject({
        decision: 'covered',
        patientShare: 0,
        thirdPartyShare: 1000,
        billing: 'package',
      });
      expect(r.matchedRule).toBeTruthy();
      expect(r.ruleVersion).toBe(`${code}@1`);
    }
    expect(evaluateCoverage(input('D', 'CONS-GEN', 'consultation'))).toMatchObject({
      decision: 'covered',
      billing: 'per_act',
      thirdPartyShare: 1000,
    });
  });

  it('leaves an excluded act to the patient and tells the cash desk what to do', () => {
    expect(evaluateCoverage(input('A', 'ACCOUCH', 'procedure'))).toMatchObject({
      decision: 'not_covered',
      patientShare: 1000,
      thirdPartyShare: 0,
      matchedRule: 'accouchements',
      action: 'block',
    });
    expect(evaluateCoverage(input('B', 'ACCOUCH', 'procedure')).decision).toBe('covered');
    expect(evaluateCoverage(input('A', 'KINE', 'procedure'))).toMatchObject({
      decision: 'not_covered',
      matchedRule: null,
      action: 'warn',
      reasons: expect.arrayContaining(['CONV_DEFAULT_RULE']),
    });
  });

  it('needs a prior authorization, then covers the authorized amount per act', () => {
    expect(evaluateCoverage(input('B', 'SCANNER', 'imaging', { unitPrice: 15000 }))).toMatchObject({
      decision: 'needs_prior_authorization',
      thirdPartyShare: 0,
      requires: ['prior_authorization'],
      action: 'block',
    });
    expect(
      evaluateCoverage(
        input('B', 'SCANNER', 'imaging', {
          unitPrice: 15000,
          context: { priorAuthorization: { status: 'approved', authorizedAmount: 12000 } },
        }),
      ),
    ).toMatchObject({
      decision: 'partially_covered',
      thirdPartyShare: 12000,
      patientShare: 3000,
      billing: 'per_act',
    });
    expect(
      evaluateCoverage(
        input('D', 'SCANNER', 'imaging', {
          context: { priorAuthorization: { status: 'rejected' } },
        }),
      ).decision,
    ).toBe('not_covered');
  });

  it('stops at the cap and reports it', () => {
    const r = evaluateCoverage(
      input('B', 'MED', 'drug', {
        unitPrice: 5000,
        consumption: { byCap: { 'medicaments-annee': 198000 } },
      }),
    );
    expect(r).toMatchObject({
      decision: 'partially_covered',
      thirdPartyShare: 2000,
      patientShare: 3000,
    });
    expect(r.warnings).toContain('CONV_CAP_REACHED_medicaments-annee');
    expect(r.consumed).toEqual({ 'medicaments-annee': 2000 });
  });

  it('bills the hospital days beyond the package per act, with a justification', () => {
    const inPackage = evaluateCoverage(
      input('A', 'HOSP-J', 'bed_day', { consumption: { hospitalDaysUsed: 2 } }),
    );
    expect(inPackage).toMatchObject({
      billing: 'package',
      warnings: ['CONV_HOSPITAL_LAST_PACKAGE_DAY'],
    });
    const beyond = evaluateCoverage(
      input('A', 'HOSP-J', 'bed_day', { consumption: { hospitalDaysUsed: 3 } }),
    );
    expect(beyond).toMatchObject({
      decision: 'covered',
      billing: 'per_act',
      requires: ['justification'],
    });
    expect(
      evaluateCoverage(input('C', 'HOSP-J', 'bed_day', { consumption: { hospitalDaysUsed: 5 } }))
        .billing,
    ).toBe('package');
  });

  it('covers an emergency without voucher, to regularise; blocks otherwise', () => {
    expect(
      evaluateCoverage(input('B', 'CONS-GEN', 'consultation', { context: { voucher: 'missing' } })),
    ).toMatchObject({
      decision: 'blocked',
      requires: ['voucher'],
      action: 'block',
    });
    const night = evaluateCoverage(
      input('B', 'CONS-GEN', 'consultation', { context: { voucher: 'missing', emergency: true } }),
    );
    expect(night).toMatchObject({
      decision: 'covered',
      requires: ['voucher'],
      warnings: ['CONV_VOUCHER_TO_REGULARISE'],
    });
  });

  it('bills a day laborer per act, for emergencies only', () => {
    expect(
      evaluateCoverage(
        input('B', 'CONS-GEN', 'consultation', {
          context: { isDayLaborer: true, emergency: true },
        }),
      ),
    ).toMatchObject({ decision: 'covered', billing: 'per_act', reasons: ['CONV_DAY_LABORER'] });
    expect(
      evaluateCoverage(input('B', 'CONS-GEN', 'consultation', { context: { isDayLaborer: true } }))
        .decision,
    ).toBe('not_covered');
  });

  it('refuses a beneficiary who has left or is not yet covered', () => {
    expect(
      evaluateCoverage(
        input('A', 'CONS-GEN', 'consultation', { beneficiary: { validUntil: '2026-10-31' } }),
      ).reasons,
    ).toEqual(['CONV_BENEFICIARY_INACTIVE']);
    expect(
      evaluateCoverage(
        input('A', 'CONS-GEN', 'consultation', { beneficiary: { status: 'suspended' } }),
      ).decision,
    ).toBe('not_covered');
  });

  it('applies the patient share by category and percent rules, without fractions', () => {
    const plan: PlanRulesInput = {
      ...PLAN_D,
      code: 'T',
      copay: [{ category: 'drug', patientPercent: 20 }],
      rules: [{ id: 'kine', match: { serviceCodes: ['KINE'] }, coverage: 'percent', percent: 75 }],
    };
    const base = input('D', 'MED', 'drug', { unitPrice: 1333 });
    const withCopay = evaluateCoverage({ ...base, plan: planRules.parse(plan) });
    expect(withCopay).toMatchObject({
      thirdPartyShare: 1066,
      patientShare: 267,
      decision: 'partially_covered',
    });
    const kine = evaluateCoverage({
      ...input('D', 'KINE', 'procedure', { unitPrice: 999 }),
      plan: planRules.parse(plan),
    });
    expect(kine).toMatchObject({ thirdPartyShare: 749, patientShare: 250 });
    expect(percentOf(1333, 20)).toBe(267);
  });
});

describe('monthly packages', () => {
  it('makes every month begun due', () => {
    expect(monthDue({ validFrom: '2026-11-30', validUntil: null }, '2026-11')).toBe(true);
    expect(monthDue({ validFrom: '2026-12-01', validUntil: null }, '2026-11')).toBe(false);
    expect(monthDue({ validFrom: '2026-01-01', validUntil: '2026-11-01' }, '2026-11')).toBe(true);
    expect(monthDue({ validFrom: '2026-01-01', validUntil: '2026-10-31' }, '2026-11')).toBe(false);
    expect(
      packagesDue(
        [
          { validFrom: '2026-01-01', validUntil: null },
          { validFrom: '2026-11-29', validUntil: null },
          { validFrom: '2026-01-01', validUntil: '2026-09-30' },
        ],
        '2026-11',
        7500,
      ),
    ).toEqual({ families: 2, amount: 15000 });
  });

  it('generates on the configured day, or the last day of a short month', () => {
    expect(isGenerationDay('2026-11-25', 25)).toBe(true);
    expect(isGenerationDay('2026-11-24', 25)).toBe(false);
    expect(isGenerationDay('2027-02-28', 30)).toBe(true);
  });
});
