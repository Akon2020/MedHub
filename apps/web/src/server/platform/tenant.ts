import 'server-only';
import { AppError } from '@medhub/shared';
import { lookupSession, SESSION_COOKIE } from './session';

export type RequestContext = {
  tenantId: string;
  userId: string;
  sessionId: string;
  deviceId: string | null;
};

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Single entry point that resolves the structure of a request. Version 1 reads
 * the signed session; phase 3 will also read the host name (subdomains).
 * The tenant never comes from the body, the URL or a custom header.
 */
export async function resolveTenant(request: Request): Promise<RequestContext> {
  const session = await lookupSession(readCookie(request, SESSION_COOKIE));
  if (!session) throw new AppError('UNAUTHENTICATED', 401);
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
  };
}
