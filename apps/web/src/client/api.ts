import { NetworkError } from '@medhub/sync/client';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 20_000;

/**
 * Short JSON request to our own API. Network failures and timeouts surface as
 * NetworkError so that the sync loop can back off; HTTP errors carry the code.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; details?: Record<string, unknown> };
    } | null;
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', response.status, body?.error?.details ?? {});
  }
  return (await response.json()) as T;
}
