import { ManualClock, toIso, uuidv7 } from '@medhub/shared';
import { NetworkError, SyncClient, type SyncTransport } from '../src/client/engine';
import type { PullResponse, PushRequest, PushResponse } from '../src/protocol';
import { processPull, processPush, type ServerSyncContext } from '../src/server';
import { bytesToBase64, generateDeviceKeyPair, signOperation } from '../src/signing';
import { MemoryClientStore, MemoryServerStore } from '../src/testing';

export const ALL_PERMISSIONS = new Set([
  'patient:create',
  'patient:update',
  'vital_sign:record',
  'stock:move',
]);

/** Deterministic PRNG so that a failing seed can be replayed exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NetworkMode = {
  offline: boolean;
  /** Probability that a push fails before reaching the server. */
  failBefore: number;
  /** Probability that the server commits but the response is lost. */
  loseResponse: number;
};

export class FlakyTransport implements SyncTransport {
  mode: NetworkMode = { offline: false, failBefore: 0, loseResponse: 0 };
  stats = { pushCalls: 0, failedBefore: 0, lostResponses: 0, duplicates: 0, conflicts: 0 };

  constructor(
    private readonly server: MemoryServerStore,
    private readonly ctx: ServerSyncContext,
    private readonly clock: ManualClock,
    private readonly random: () => number,
  ) {}

  async push(request: PushRequest): Promise<PushResponse> {
    this.stats.pushCalls += 1;
    if (this.mode.offline || this.random() < this.mode.failBefore) {
      this.stats.failedBefore += 1;
      throw new NetworkError('OFFLINE');
    }
    const wire = JSON.parse(JSON.stringify(request)) as PushRequest;
    const response = await processPush(this.server, this.ctx, wire);
    for (const r of response.results) {
      if (r.status === 'duplicate') this.stats.duplicates += 1;
      if (r.status === 'needs_review') this.stats.conflicts += 1;
    }
    if (this.random() < this.mode.loseResponse) {
      this.stats.lostResponses += 1;
      throw new NetworkError('RESPONSE_LOST');
    }
    return JSON.parse(JSON.stringify(response)) as PushResponse;
  }

  async pull(cursor: number, options: { limit: number; lookback: boolean }): Promise<PullResponse> {
    if (this.mode.offline || this.random() < this.mode.failBefore)
      throw new NetworkError('OFFLINE');
    const response = await processPull(this.server, {
      cursor,
      limit: options.limit,
      lookback: options.lookback,
      nowMs: this.clock.now(),
      serverTime: toIso(this.clock.now()),
    });
    return JSON.parse(JSON.stringify(response)) as PullResponse;
  }
}

export type Device = {
  id: string;
  store: MemoryClientStore;
  client: SyncClient;
  transport: FlakyTransport;
};

export function createWorld(seed: number, deviceCount = 2) {
  const random = mulberry32(seed);
  const clock = new ManualClock(Date.UTC(2026, 9, 1, 8));
  const server = new MemoryServerStore(() => clock.now());
  const tenantId = uuidv7();
  const userId = uuidv7();

  const devices: Device[] = Array.from({ length: deviceCount }, () => {
    const id = uuidv7();
    const keys = generateDeviceKeyPair();
    const ctx: ServerSyncContext = {
      tenantId,
      userId,
      deviceId: id,
      permissions: ALL_PERMISSIONS,
      devicePublicKey: bytesToBase64(keys.publicKey),
      serverTime: () => toIso(clock.now()),
    };
    const store = new MemoryClientStore();
    const transport = new FlakyTransport(server, ctx, clock, random);
    const client = new SyncClient({
      store,
      transport,
      clock,
      identity: { tenantId, siteId: null, userId, deviceId: id },
      sign: (op) => signOperation(op, keys.secretKey),
      permissions: ALL_PERMISSIONS,
    });
    return { id, store, client, transport };
  });

  return { random, clock, server, tenantId, userId, devices };
}

/** Brings every device back online and syncs until nothing moves anymore. */
export async function settle(devices: Device[]): Promise<void> {
  for (const d of devices) d.transport.mode = { offline: false, failBefore: 0, loseResponse: 0 };
  for (let round = 0; round < 3; round += 1) {
    for (const d of devices) await d.client.sync();
  }
}
