import 'server-only';
import { contractInput, payerInput } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  conventionsOverview,
  importBeneficiaries,
  listBeneficiaries,
  publishPlan,
  savePayer,
  saveContract,
  savePlanDraft,
  setContractStatus,
} from './service';

export const conventionsRoute = defineRoute({
  route: 'contracts.read',
  handler: async ({ ctx }) => json(await conventionsOverview(ctx)),
});

export const payerSaveRoute = defineRoute({
  route: 'payers.save',
  schema: payerInput,
  handler: async ({ request, body, ctx }) =>
    json(await savePayer(ctx, body, { ip: clientIp(request) })),
});

export const contractSaveRoute = defineRoute({
  route: 'contracts.save',
  schema: contractInput,
  handler: async ({ request, body, ctx }) =>
    json(await saveContract(ctx, body, { ip: clientIp(request) })),
});

export const contractStatusRoute = defineRoute({
  route: 'contracts.status',
  schema: z.object({ id: z.uuid(), status: z.enum(['active', 'suspended', 'terminated']) }),
  handler: async ({ request, body, ctx }) => {
    await setContractStatus(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const planDraftRoute = defineRoute({
  route: 'contract_plans.save_draft',
  schema: z.object({ contractId: z.uuid(), rules: z.unknown() }),
  handler: async ({ request, body, ctx }) =>
    json(await savePlanDraft(ctx, body, { ip: clientIp(request) })),
});

export const planPublishRoute = defineRoute({
  route: 'contract_plans.publish',
  schema: z.object({ contractId: z.uuid(), code: z.string().min(1).max(10) }),
  handler: async ({ request, body, ctx }) =>
    json(await publishPlan(ctx, body, { ip: clientIp(request) })),
});

export const beneficiariesRoute = defineRoute({
  route: 'beneficiaries.read',
  handler: async ({ request, ctx }) => {
    const id = z.uuid().safeParse(new URL(request.url).searchParams.get('contract'));
    if (!id.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await listBeneficiaries(ctx, id.data));
  },
});

export const beneficiaryImportRoute = defineRoute({
  route: 'beneficiaries.import',
  schema: z.object({
    contractId: z.uuid(),
    csv: z.string().max(5_000_000),
    apply: z.boolean().default(false),
    completeList: z.boolean().default(false),
    effectiveOn: z.iso.date(),
  }),
  handler: async ({ request, body, ctx }) =>
    json(await importBeneficiaries(ctx, body, { ip: clientIp(request) })),
});
