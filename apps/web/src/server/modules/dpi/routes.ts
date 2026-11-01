import 'server-only';
import { vitalDefinitionInput } from '@medhub/domain';
import { clientIp, defineRoute, json } from '../../platform/http';
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
