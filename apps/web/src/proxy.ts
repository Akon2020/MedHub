import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/server/platform/http';
import { checkIp, securityEvent } from '@/server/platform/security';

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  const https = (process.env.MEDHUB_BASE_URL ?? '').startsWith('https://');
  return [
    "default-src 'self'",
    // Nonce plus strict-dynamic: only scripts emitted by Next.js for this response run.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // React style attributes (charts, sizes) need inline styles; scripts never do.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * Runs before every page and API request: platform and admin IP rules (the
 * structure rules are applied once the session is known, in defineRoute), then
 * a fresh CSP nonce for documents.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const area = request.nextUrl.pathname.startsWith('/admin') ? 'admin' : 'public';
  try {
    const decision = await checkIp(ip, { area });
    if (!decision.allowed) {
      await securityEvent({
        kind: 'ip_refused',
        severity: 'warning',
        ip,
        detail: { area, path: request.nextUrl.pathname.slice(0, 100) },
      });
      return new NextResponse('Accès refusé / Access denied', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  } catch {
    // An unreachable database must not take the offline-capable shell down with it.
  }

  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
