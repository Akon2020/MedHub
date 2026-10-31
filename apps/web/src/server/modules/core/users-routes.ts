import 'server-only';
import { userCreateSchema, userUpdateSchema } from '@medhub/domain';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  createUser,
  listUsers,
  resetMfa,
  resetPassword,
  setUserStatus,
  unlockUser,
  updateUser,
} from './users';

const client = (request: Request) => ({ ip: clientIp(request) });
const target = z.object({ userId: z.uuid() });
const reason = z.string().trim().min(3).max(300);

export const usersRoute = defineRoute({
  route: 'users.list',
  handler: async ({ ctx }) => json(await listUsers(ctx)),
});

export const userCreateRoute = defineRoute({
  route: 'users.create',
  schema: userCreateSchema,
  handler: async ({ request, body, ctx }) =>
    json(await createUser(ctx, body, client(request)), { status: 201 }),
});

export const userUpdateRoute = defineRoute({
  route: 'users.update',
  schema: userUpdateSchema,
  handler: async ({ request, body, ctx }) => {
    await updateUser(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const userStatusRoute = defineRoute({
  route: 'users.status',
  schema: target.extend({ status: z.enum(['active', 'disabled']), reason }),
  handler: async ({ request, body, ctx }) => {
    await setUserStatus(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const userResetPasswordRoute = defineRoute({
  route: 'users.reset_password',
  schema: target,
  handler: async ({ request, body, ctx }) => json(await resetPassword(ctx, body, client(request))),
});

export const userResetMfaRoute = defineRoute({
  route: 'users.reset_mfa',
  schema: target.extend({ reason }),
  handler: async ({ request, body, ctx }) => {
    await resetMfa(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const userUnlockRoute = defineRoute({
  route: 'users.unlock',
  schema: target,
  handler: async ({ request, body, ctx }) => {
    await unlockUser(ctx, body, client(request));
    return json({ ok: true });
  },
});
