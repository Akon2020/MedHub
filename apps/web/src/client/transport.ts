import type { PullResponse, PushRequest, PushResponse } from '@medhub/sync';
import type { SyncTransport } from '@medhub/sync/client';
import { apiFetch } from './api';

export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly deviceId: string) {}

  push(request: PushRequest): Promise<PushResponse> {
    return apiFetch<PushResponse>('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  pull(cursor: number, options: { limit: number; lookback: boolean }): Promise<PullResponse> {
    const params = new URLSearchParams({
      deviceId: this.deviceId,
      cursor: String(cursor),
      limit: String(options.limit),
      lookback: options.lookback ? '1' : '0',
    });
    return apiFetch<PullResponse>(`/api/v1/sync/pull?${params.toString()}`);
  }
}
