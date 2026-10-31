import 'server-only';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { dismissDuplicate, listDuplicates } from './duplicates';

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
