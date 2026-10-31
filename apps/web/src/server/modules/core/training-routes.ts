import 'server-only';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import { buildTraining, getTraining } from './training';

export const trainingRoute = defineRoute({
  route: 'training.read',
  handler: async ({ ctx }) => json(await getTraining(ctx)),
});

export const trainingBuildRoute = defineRoute({
  route: 'training.build',
  schema: z.object({ mode: z.enum(['create', 'reset']) }),
  handler: async ({ request, body, ctx }) =>
    json(await buildTraining(ctx, body.mode, { ip: clientIp(request) })),
});
