import 'server-only';
import { AppError, isAppError, uuidv7 } from '@medhub/shared';
import { z } from 'zod';
import { withTenant } from '@medhub/db';
import { database } from './db';
import { env } from './env';
import { logger } from './logger';
import { loadPermissions, requirePermission } from './permissions';
import { checkIp, securityEvent } from './security';
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
    const retryAfter = error.details?.retryAfter;
    return json(body, {
      status: error.status,
      ...(typeof retryAfter === 'number' ? { headers: { 'Retry-After': String(retryAfter) } } : {}),
    });
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
 * resolution, structure IP rules, optional permission, body validation, uniform
 * error format, no-store caching and timing. Services still check the finer
 * permissions inside their own tenant transaction.
 */
export function defineRoute<
  S extends z.ZodType | undefined = undefined,
  A extends boolean = true,
>(options: { route: string; auth?: A; permission?: string; schema?: S; handler: Handler<S, A> }) {
  return async (request: Request): Promise<Response> => {
    const requestId = uuidv7();
    const started = performance.now();
    let status = 500;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request);
      const requireAuth = options.auth ?? true;
      const ctx = requireAuth ? await resolveTenant(request) : null;
      if (ctx) {
        const ip = clientIp(request);
        const decision = await checkIp(ip, { area: 'tenant', tenantId: ctx.tenantId });
        if (!decision.allowed) {
          await securityEvent({
            kind: 'ip_refused',
            severity: 'warning',
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            ip,
            detail: { route: options.route },
          });
          throw new AppError('IP_BLOCKED', 403);
        }
        if (options.permission) {
          const permission = options.permission;
          await withTenant(
            database().db,
            { tenantId: ctx.tenantId, userId: ctx.userId },
            async (tx) => requirePermission(await loadPermissions(tx, ctx.userId), permission),
          );
        }
      }
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
      status = response.status;
      return withTiming(response, started);
    } catch (error) {
      const response = errorResponse(error, requestId, options.route);
      status = response.status;
      return withTiming(response, started);
    } finally {
      try {
        reportDuration(options.route, request.method, status, started, requestId);
      } catch {
        // Timing must never turn a served response into a failure.
      }
    }
  };
}

function withTiming(response: Response, started: number): Response {
  response.headers.set('Server-Timing', `app;dur=${Math.round(performance.now() - started)}`);
  return response;
}

/**
 * Slow requests are logged with the pool state, to tell a saturated pool
 * (waiting clients) from a slow query or lock (see docs/avancement.md).
 */
function reportDuration(
  route: string,
  method: string,
  status: number,
  started: number,
  requestId: string,
): void {
  const durationMs = Math.round(performance.now() - started);
  telemetry().recordMetric('http.duration_ms', durationMs, {
    route,
    method,
    status: String(status),
  });
  if (durationMs < env().MEDHUB_SLOW_REQUEST_MS) return;
  const { pool } = database();
  logger.warn(
    {
      requestId,
      route,
      method,
      status,
      durationMs,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    },
    'slow_request',
  );
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')
  );
}
