import { minorAmountSchema } from '@medhub/shared';
import { z } from 'zod';

/**
 * Prior authorizations and guarantees (docs/modules/conv.md section 5). A
 * request leaves with the next synchronisation; the payer's decision is
 * recorded online by Direction (owner decision S11).
 */
export const priorAuthorizationRequestPayload = z.object({
  patientId: z.uuid(),
  contractId: z.uuid(),
  beneficiaryId: z.uuid(),
  serviceItemId: z.uuid().nullish(),
  serviceCode: z.string().trim().max(40).nullish(),
  label: z.string().trim().min(2).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountRequested: minorAmountSchema.refine((n) => n > 0, 'FACT_AMOUNT_ZERO'),
  reason: z.string().trim().min(5).max(500),
  requestedAt: z.iso.datetime(),
  status: z.literal('pending').default('pending'),
});

export const priorAuthorizationDecisionInput = z
  .object({
    id: z.uuid(),
    approve: z.boolean(),
    authorizedAmount: minorAmountSchema.min(1).nullish(),
    validUntil: z.iso.date().nullish(),
    payerReference: z.string().trim().max(60).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((d) => !d.approve || (d.authorizedAmount && d.validUntil), {
    message: 'CONV_DECISION_INCOMPLETE',
  })
  .refine((d) => d.approve || (d.note ?? '').trim().length >= 3, {
    message: 'CONV_DECISION_INCOMPLETE',
  });

export type AuthorizationView = {
  serviceItemId: string | null;
  status: 'pending' | 'approved' | 'rejected';
  authorizedAmount: number | null;
  validUntil: string | null;
  requestedAt: string;
};

/** The most recent request for a service: approved and in force, pending, or rejected. */
export function authorizationFor(
  requests: readonly AuthorizationView[],
  serviceItemId: string | null,
  day: string,
): { status: 'approved' | 'pending' | 'rejected' | 'none'; authorizedAmount: number | null } {
  if (!serviceItemId) return { status: 'none', authorizedAmount: null };
  const mine = requests
    .filter((r) => r.serviceItemId === serviceItemId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const approved = mine.find(
    (r) => r.status === 'approved' && (!r.validUntil || day <= r.validUntil),
  );
  if (approved) return { status: 'approved', authorizedAmount: approved.authorizedAmount };
  const last = mine[0];
  if (!last || (last.status === 'approved' && last.validUntil !== null && day > last.validUntil)) {
    return { status: 'none', authorizedAmount: null };
  }
  return { status: last.status === 'approved' ? 'none' : last.status, authorizedAmount: null };
}

export const guaranteeInput = z.object({
  contractId: z.uuid(),
  memberNumber: z.string().trim().max(40).nullish(),
  kind: z.enum(['receive', 'refund']),
  amount: minorAmountSchema.refine((n) => n > 0, 'FACT_AMOUNT_ZERO'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  method: z.enum(['cash', 'transfer', 'cheque', 'mobile_money']),
  reference: z.string().trim().max(60).nullish(),
});

/** Guarantee held for a contract: received minus refunded, per worker and in total. */
export function guaranteeBalance(
  rows: readonly {
    memberNumber: string | null;
    kind: 'receive' | 'refund' | string;
    amount: number;
  }[],
): { total: number; byMember: Record<string, number> } {
  const byMember: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const signed = r.kind === 'refund' ? -r.amount : r.amount;
    total += signed;
    const key = r.memberNumber ?? '';
    byMember[key] = (byMember[key] ?? 0) + signed;
  }
  return { total, byMember };
}
