import 'server-only';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { listForms, publishForm, saveFormDraft } from './service';

export const formsRoute = defineRoute({
  route: 'forms.read',
  handler: async ({ ctx }) => json(await listForms(ctx)),
});

export const formDraftRoute = defineRoute({
  route: 'forms.save_draft',
  schema: z.object({ definitionId: z.uuid().nullish(), definition: z.unknown() }),
  handler: async ({ request, body, ctx }) =>
    json(await saveFormDraft(ctx, body, { ip: clientIp(request) })),
});

export const formPublishRoute = defineRoute({
  route: 'forms.publish',
  schema: z.object({ definitionId: z.uuid() }),
  handler: async ({ request, body, ctx }) =>
    json(await publishForm(ctx, body, { ip: clientIp(request) })),
});
