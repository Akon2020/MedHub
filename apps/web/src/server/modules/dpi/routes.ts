import 'server-only';
import { breakGlassReviewInput, programInput, vitalDefinitionInput } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { listBreakGlass, patientAccessLog, reviewBreakGlass } from './break-glass';
import { getVitalDefinitions, saveVitalDefinition } from './config';
import { importDiagnoses } from './consultation';
import { importDrugs, importInteractions } from './prescription';
import { followUpList, listPrograms, saveProgram } from './programs';

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

export const programsRoute = defineRoute({
  route: 'programs.read',
  handler: async ({ ctx }) => json(await listPrograms(ctx)),
});

export const programSaveRoute = defineRoute({
  route: 'programs.save',
  schema: programInput,
  handler: async ({ request, body, ctx }) =>
    json(await saveProgram(ctx, body, { ip: clientIp(request) })),
});

export const followUpRoute = defineRoute({
  route: 'programs.follow_up',
  handler: async ({ ctx }) => json(await followUpList(ctx)),
});

export const diagnosisImportRoute = defineRoute({
  route: 'diagnoses.import',
  schema: z.object({ csv: z.string().max(5_000_000), apply: z.boolean().default(false) }),
  handler: async ({ request, body, ctx }) =>
    json(await importDiagnoses(ctx, body, { ip: clientIp(request) })),
});

const catalogImport = z.object({
  csv: z.string().max(5_000_000),
  apply: z.boolean().default(false),
});

export const drugImportRoute = defineRoute({
  route: 'drugs.import',
  schema: catalogImport,
  handler: async ({ request, body, ctx }) =>
    json(await importDrugs(ctx, body, { ip: clientIp(request) })),
});

export const interactionImportRoute = defineRoute({
  route: 'drug_interactions.import',
  schema: catalogImport,
  handler: async ({ request, body, ctx }) =>
    json(await importInteractions(ctx, body, { ip: clientIp(request) })),
});
