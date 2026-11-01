import 'server-only';
import { breakGlassReviewInput, vitalDefinitionInput } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { listBreakGlass, patientAccessLog, reviewBreakGlass } from './break-glass';
import { getVitalDefinitions, saveVitalDefinition } from './config';

export const vitalDefinitionsRoute = defineRoute({
  route: 'vital_sign_definitions.read',
  handler: async ({ ctx }) => json(await getVitalDefinitions(ctx)),
});

export const vitalDefinitionSaveRoute = defineRoute({
  route: 'vital_sign_definitions.save',
  schema: vitalDefinitionInput,
  handler: async ({ request, body, ctx }) => {
    await saveVitalDefinition(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const breakGlassListRoute = defineRoute({
  route: 'break_glass.list',
  handler: async ({ ctx }) => json(await listBreakGlass(ctx)),
});

export const breakGlassReviewRoute = defineRoute({
  route: 'break_glass.review',
  schema: breakGlassReviewInput,
  handler: async ({ request, body, ctx }) => {
    await reviewBreakGlass(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const patientAccessRoute = defineRoute({
  route: 'patients.access',
  handler: async ({ request, ctx }) => {
    const id = z.uuid().safeParse(new URL(request.url).searchParams.get('id'));
    if (!id.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await patientAccessLog(ctx, id.data));
  },
});
