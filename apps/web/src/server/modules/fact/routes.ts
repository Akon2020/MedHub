import 'server-only';
import {
  approvalDecisionInput,
  exchangeRateInput,
  priceListInput,
  serviceItemInput,
} from '@medhub/domain';
import { decideApproval, listApprovals, saveApprovalThreshold } from './approvals';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  financeOverview,
  importPrices,
  importServiceItems,
  saveBillingRule,
  saveCurrencySetting,
  savePriceList,
  saveServiceItem,
  setExchangeRate,
} from './pricing';

const csvImport = { csv: z.string().max(5_000_000), apply: z.boolean().default(false) };

export const financeRoute = defineRoute({
  route: 'finance.read',
  handler: async ({ ctx }) => json(await financeOverview(ctx)),
});

export const serviceItemSaveRoute = defineRoute({
  route: 'service_items.save',
  schema: serviceItemInput,
  handler: async ({ request, body, ctx }) =>
    json(await saveServiceItem(ctx, body, { ip: clientIp(request) })),
});

export const serviceItemImportRoute = defineRoute({
  route: 'service_items.import',
  schema: z.object(csvImport),
  handler: async ({ request, body, ctx }) =>
    json(await importServiceItems(ctx, body, { ip: clientIp(request) })),
});

export const priceListSaveRoute = defineRoute({
  route: 'price_lists.save',
  schema: priceListInput,
  handler: async ({ request, body, ctx }) =>
    json(await savePriceList(ctx, body, { ip: clientIp(request) })),
});

export const priceImportRoute = defineRoute({
  route: 'prices.import',
  schema: z.object({ priceListId: z.uuid(), ...csvImport }),
  handler: async ({ request, body, ctx }) =>
    json(await importPrices(ctx, body, { ip: clientIp(request) })),
});

export const exchangeRateRoute = defineRoute({
  route: 'exchange_rates.set',
  schema: exchangeRateInput,
  handler: async ({ request, body, ctx }) =>
    json(await setExchangeRate(ctx, body, { ip: clientIp(request) })),
});

export const currencySettingRoute = defineRoute({
  route: 'currencies.save',
  schema: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    cashRoundingStep: z.number().int().min(0).max(1_000_000_000),
    isAccepted: z.boolean(),
  }),
  handler: async ({ request, body, ctx }) => {
    await saveCurrencySetting(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const billingRuleRoute = defineRoute({
  route: 'billing_rules.save',
  schema: z.object({
    encounterKind: z.string().max(30).nullable(),
    departmentId: z.uuid().nullable(),
    serviceItemId: z.uuid().nullable(),
  }),
  handler: async ({ request, body, ctx }) => {
    await saveBillingRule(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const approvalsRoute = defineRoute({
  route: 'approvals.read',
  handler: async ({ ctx }) => json(await listApprovals(ctx)),
});

export const approvalDecideRoute = defineRoute({
  route: 'approvals.decide',
  schema: approvalDecisionInput,
  handler: async ({ request, body, ctx }) => {
    await decideApproval(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const approvalThresholdRoute = defineRoute({
  route: 'approval_thresholds.save',
  schema: z.object({
    roleId: z.uuid(),
    kind: z.enum(['discount', 'credit_note']),
    currency: z.string().regex(/^[A-Z]{3}$/),
    maxAmount: z.number().int().min(0).max(1_000_000_000_000),
  }),
  handler: async ({ request, body, ctx }) => {
    await saveApprovalThreshold(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});
