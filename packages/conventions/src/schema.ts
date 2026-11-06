import { z } from 'zod';

/**
 * Rules of a contract plan (docs/modules/conv.md section 3): stored as JSON,
 * versioned, validated here identically on the workstation and the server.
 * Amounts are minor units of the plan currency.
 */
export const BILLING_MODES = ['per_act', 'family_monthly_package', 'per_case_package'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const COVERAGES = ['included', 'excluded', 'percent', 'capped'] as const;
export type Coverage = (typeof COVERAGES)[number];

const amount = z.number().int().min(0).refine(Number.isSafeInteger, 'AMOUNT_OUT_OF_RANGE');
const code = z.string().trim().min(1).max(40);

export const ruleMatch = z
  .object({
    serviceCodes: z.array(code).max(200).optional(),
    category: z.string().max(40).optional(),
    /** Department codes (specialties) where the act is performed. */
    specialties: z.array(code).max(50).optional(),
  })
  .refine((m) => Boolean(m.serviceCodes?.length || m.category || m.specialties?.length), {
    message: 'CONV_MATCH_EMPTY',
  });

export const coverageRule = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    match: ruleMatch,
    coverage: z.enum(COVERAGES),
    /** Share paid by the third party for `percent`, 0 to 100. */
    percent: z.number().int().min(0).max(100).optional(),
    /** Cap of the rule for `capped`, per act. */
    capAmount: amount.optional(),
    priorAuthorization: z.boolean().optional(),
    /** What the cash desk does with an act not covered by this rule. */
    action: z.enum(['block', 'warn']).optional(),
  })
  .refine((r) => r.coverage !== 'percent' || r.percent !== undefined, {
    message: 'CONV_PERCENT_REQUIRED',
  })
  .refine((r) => r.coverage !== 'capped' || r.capAmount !== undefined, {
    message: 'CONV_CAP_REQUIRED',
  });
export type CoverageRule = z.infer<typeof coverageRule>;

export const capDefinition = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  scope: z.enum(['beneficiary', 'family']),
  period: z.enum(['year', 'month', 'event']),
  amount,
  categories: z.array(z.string().max(40)).optional(),
  serviceCodes: z.array(code).optional(),
});
export type CapDefinition = z.infer<typeof capDefinition>;

export const copayDefinition = z.object({
  category: z.string().max(40).optional(),
  serviceCodes: z.array(code).optional(),
  /** Share left to the patient, 0 to 100 (ticket modérateur). */
  patientPercent: z.number().int().min(0).max(100),
});

export const planRules = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,9}$/),
  name: z.string().trim().min(2).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billing: z.enum(BILLING_MODES),
  /** Price of the package (per family and month, or per case). */
  price: amount.default(0),
  guaranteePerWorker: amount.default(0),
  hospitalization: z
    .object({
      packageDays: z.number().int().min(0).max(365),
      justificationRequired: z.boolean().default(true),
    })
    .optional(),
  /** A signed referral voucher is required; an emergency is covered and regularised later. */
  voucherRequired: z.boolean().default(true),
  voucherGraceHours: z.number().int().min(1).max(720).default(72),
  caps: z.array(capDefinition).max(30).default([]),
  copay: z.array(copayDefinition).max(30).default([]),
  rules: z.array(coverageRule).max(500).default([]),
  default: z
    .object({ coverage: z.enum(['included', 'excluded']), action: z.enum(['block', 'warn']) })
    .default({ coverage: 'excluded', action: 'warn' }),
});
export type PlanRules = z.infer<typeof planRules>;
export type PlanRulesInput = z.input<typeof planRules>;
