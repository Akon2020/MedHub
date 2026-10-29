import 'server-only';
import { AppError, isAppError, uuidv7 } from '@medhub/shared';
import { z } from 'zod';
import { env } from './env';
import { telemetry } from './telemetry';
import { resolveTenant, type RequestContext } from './tenant';

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId: string };
};

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

export function errorResponse(error: unknown, requestId: string, route: string): Response {
  if (isAppError(error)) {
    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.code,
        ...(error.details ? { details: error.details } : {}),
        requestId,
      },
    };
    return json(body, { status: error.status });
  }
  telemetry().captureError(error, { requestId, route });
  return json(
    { error: { code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR', requestId } } satisfies ErrorBody,
    { status: 500 },
  );
}

/** CSRF: browsers always send Origin on cross-site writes; it must match our own. */
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const allowed = new Set([new URL(env().MEDHUB_BASE_URL).origin, new URL(request.url).origin]);
  if (!allowed.has(origin)) throw new AppError('CSRF_ORIGIN_MISMATCH', 403);
}

type Handler<S extends z.ZodType | undefined, A extends boolean> = (args: {
  request: Request;
  body: S extends z.ZodType ? z.infer<S> : undefined;
  ctx: A extends true ? RequestContext : null;
  requestId: string;
}) => Promise<Response>;

/**
 * Every route goes through here: request id, origin check on writes, session
 * resolution, body validation, uniform error format and no-store caching.
 * Permissions are checked by services inside their tenant transaction.
 */
export function defineRoute<
  S extends z.ZodType | undefined = undefined,
  A extends boolean = true,
>(options: { route: string; auth?: A; schema?: S; handler: Handler<S, A> }) {
  return async (request: Request): Promise<Response> => {
    const requestId = uuidv7();
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request);
      const requireAuth = options.auth ?? true;
      const ctx = requireAuth ? await resolveTenant(request) : null;
      let body: unknown = undefined;
      if (options.schema) {
        const raw: unknown = await request.json().catch(() => {
          throw new AppError('VALIDATION_FAILED', 400, { reason: 'INVALID_JSON' });
        });
        const parsed = options.schema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError('VALIDATION_FAILED', 400, {
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
          });
        }
        body = parsed.data;
      }
      const response = await options.handler({
        request,
        body: body as S extends z.ZodType ? z.infer<S> : undefined,
        ctx: ctx as A extends true ? RequestContext : null,
        requestId,
      });
      response.headers.set('X-Request-Id', requestId);
      if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error) {
      return errorResponse(error, requestId, options.route);
    }
  };
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')
  );
}
