import 'server-only';
import { roleCreateSchema, roleUpdateSchema } from '@medhub/domain';
import { clientIp, defineRoute, json } from '../../platform/http';
import { createRole, listRoles, updateRole } from './roles';

const client = (request: Request) => ({ ip: clientIp(request) });

export const rolesRoute = defineRoute({
  route: 'roles.list',
  handler: async ({ ctx }) => json(await listRoles(ctx)),
});

export const roleCreateRoute = defineRoute({
  route: 'roles.create',
  schema: roleCreateSchema,
  handler: async ({ request, body, ctx }) =>
    json(await createRole(ctx, body, client(request)), { status: 201 }),
});

export const roleUpdateRoute = defineRoute({
  route: 'roles.update',
  schema: roleUpdateSchema,
  handler: async ({ request, body, ctx }) => {
    await updateRole(ctx, body, client(request));
    return json({ ok: true });
  },
});
