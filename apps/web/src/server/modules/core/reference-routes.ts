import 'server-only';
import {
  choiceItemsSaveSchema,
  choiceListCreateSchema,
  choiceListUpdateSchema,
} from '@medhub/domain';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  catalogSnapshot,
  createChoiceList,
  getReference,
  saveChoiceItems,
  simulateChoiceImport,
  updateChoiceList,
} from './reference';

const client = (request: Request) => ({ ip: clientIp(request) });

/** One megabyte of CSV is far more than any pick list. */
const CSV_MAX_LENGTH = 1_000_000;

export const referenceRoute = defineRoute({
  route: 'reference.read',
  handler: async ({ ctx }) => json(await getReference(ctx)),
});

export const catalogsRoute = defineRoute({
  route: 'reference.catalogs',
  handler: async ({ request, ctx }) => {
    const snapshot = await catalogSnapshot(ctx);
    const known = new URL(request.url).searchParams.get('etag');
    return json(known === snapshot.etag ? { unchanged: true, etag: snapshot.etag } : snapshot);
  },
});

export const choiceListCreateRoute = defineRoute({
  route: 'choice_lists.create',
  schema: choiceListCreateSchema,
  handler: async ({ request, body, ctx }) =>
    json(await createChoiceList(ctx, body, client(request)), { status: 201 }),
});

export const choiceListUpdateRoute = defineRoute({
  route: 'choice_lists.update',
  schema: choiceListUpdateSchema,
  handler: async ({ request, body, ctx }) => {
    await updateChoiceList(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const choiceItemsSaveRoute = defineRoute({
  route: 'choice_lists.items',
  schema: choiceItemsSaveSchema,
  handler: async ({ request, body, ctx }) =>
    json(await saveChoiceItems(ctx, body, client(request))),
});

export const choiceImportRoute = defineRoute({
  route: 'choice_lists.import',
  schema: z.object({ listId: z.uuid(), csv: z.string().min(1).max(CSV_MAX_LENGTH) }),
  handler: async ({ body, ctx }) => json(await simulateChoiceImport(ctx, body)),
});
