import 'server-only';
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  tenantProfileSchema,
} from '@medhub/domain';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  createDepartment,
  createSite,
  getOrganization,
  listSecurityEvents,
  updateDepartment,
  updateSite,
  updateTenantProfile,
} from './organization';

const client = (request: Request) => ({ ip: clientIp(request) });

export const organizationRoute = defineRoute({
  route: 'organization.read',
  handler: async ({ ctx }) => json(await getOrganization(ctx)),
});

export const organizationUpdateRoute = defineRoute({
  route: 'organization.update',
  schema: tenantProfileSchema,
  handler: async ({ request, body, ctx }) => {
    await updateTenantProfile(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const siteCreateRoute = defineRoute({
  route: 'sites.create',
  schema: siteCreateSchema,
  handler: async ({ request, body, ctx }) =>
    json(await createSite(ctx, body, client(request)), { status: 201 }),
});

export const siteUpdateRoute = defineRoute({
  route: 'sites.update',
  schema: siteUpdateSchema,
  handler: async ({ request, body, ctx }) => {
    await updateSite(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const departmentCreateRoute = defineRoute({
  route: 'departments.create',
  schema: departmentCreateSchema,
  handler: async ({ request, body, ctx }) =>
    json(await createDepartment(ctx, body, client(request)), { status: 201 }),
});

export const departmentUpdateRoute = defineRoute({
  route: 'departments.update',
  schema: departmentUpdateSchema,
  handler: async ({ request, body, ctx }) => {
    await updateDepartment(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const securityEventsRoute = defineRoute({
  route: 'security.events',
  handler: async ({ ctx }) => json({ events: await listSecurityEvents(ctx) }),
});
