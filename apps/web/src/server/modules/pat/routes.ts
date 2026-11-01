import 'server-only';
import { AppError } from '@medhub/shared';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { patientMergeSchema, patientUnmergeSchema } from '@medhub/domain';
import { dismissDuplicate, listDuplicates } from './duplicates';
import { listPatientConflicts, patientHistory, resolvePatientConflict } from './history';
import { listMerges, mergePatients, unmergePatients } from './merge';
import { fetchPatient, searchPatients } from './search';

export const duplicatesRoute = defineRoute({
  route: 'patients.duplicates',
  handler: async ({ ctx }) => json(await listDuplicates(ctx)),
});

export const duplicateDismissRoute = defineRoute({
  route: 'patients.duplicates.dismiss',
  schema: z.object({ candidateId: z.uuid(), reason: z.string().trim().min(3).max(300) }),
  handler: async ({ request, body, ctx }) => {
    await dismissDuplicate(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

export const mergeRoute = defineRoute({
  route: 'patients.merge',
  schema: patientMergeSchema,
  handler: async ({ request, body, ctx }) =>
    json(await mergePatients(ctx, body, { ip: clientIp(request) })),
});

export const unmergeRoute = defineRoute({
  route: 'patients.unmerge',
  schema: patientUnmergeSchema,
  handler: async ({ request, body, ctx }) =>
    json(await unmergePatients(ctx, body, { ip: clientIp(request) })),
});

export const mergesRoute = defineRoute({
  route: 'patients.merges',
  handler: async ({ ctx }) => json(await listMerges(ctx)),
});

export const historyRoute = defineRoute({
  route: 'patients.history',
  handler: async ({ request, ctx }) => {
    const id = z.uuid().safeParse(new URL(request.url).searchParams.get('id'));
    if (!id.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await patientHistory(ctx, id.data));
  },
});

export const conflictsRoute = defineRoute({
  route: 'patients.conflicts',
  handler: async ({ ctx }) => json(await listPatientConflicts(ctx)),
});

export const conflictResolveRoute = defineRoute({
  route: 'patients.conflicts.resolve',
  schema: z.object({
    conflictId: z.uuid(),
    choice: z.enum(['keep', 'apply']),
    reason: z.string().trim().min(3).max(300),
  }),
  handler: async ({ request, body, ctx }) => {
    await resolvePatientConflict(ctx, body, { ip: clientIp(request) });
    return json({ ok: true });
  },
});

const searchQuery = z.object({
  q: z.string().trim().min(2).max(120),
  cursor: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const searchRoute = defineRoute({
  route: 'patients.search',
  handler: async ({ request, ctx }) => {
    const params = new URL(request.url).searchParams;
    const parsed = searchQuery.safeParse({
      q: params.get('q') ?? '',
      cursor: params.get('cursor') ?? undefined,
    });
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await searchPatients(ctx, parsed.data));
  },
});

export const patientStateRoute = defineRoute({
  route: 'patients.state',
  handler: async ({ request, ctx }) => {
    const id = z.uuid().safeParse(new URL(request.url).searchParams.get('id'));
    if (!id.success) throw new AppError('VALIDATION_FAILED', 400);
    return json(await fetchPatient(ctx, id.data));
  },
});
