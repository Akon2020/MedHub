import type { EncryptedClientStore } from '@medhub/local-db';
import { NetworkError, type SyncClient } from '@medhub/sync/client';
import { ApiError } from './api';

export type SyncState = 'online' | 'syncing' | 'offline' | 'attention';

export type SyncStatus = {
  state: SyncState;
  pending: number;
  rejected: number;
  conflicts: number;
  lastSyncAt: number | null;
  clockSuspect: boolean;
  needsLogin: boolean;
};

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000];
const VISIBLE_INTERVAL_MS = 30_000;
const HIDDEN_INTERVAL_MS = 300_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
export const SYNC_LOCK_NAME = 'medhub-sync';

/**
 * Drives synchronisation: on network return, on a timer, when the tab becomes
 * visible and after each local write. Never gives up; backs off on failures.
 * A Web Lock keeps a single cycle across tabs.
 */
export class SyncLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private running = false;
  private stopped = false;
  private needsLogin = false;
  private status: SyncStatus = {
    state: 'offline',
    pending: 0,
    rejected: 0,
    conflicts: 0,
    lastSyncAt: null,
    clockSuspect: false,
    needsLogin: false,
  };
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private readonly client: SyncClient,
    private readonly store: EncryptedClientStore,
    private readonly hooks: {
      /** After each successful cycle (token renewal). */
      afterSync?: () => Promise<void>;
      /** The server retired this device: the runtime wipes it. */
      onRevoked?: () => void;
      /** The user was disabled: the runtime drops the offline token and locks. */
      onUserDisabled?: () => void;
    } = {},
  ) {}

  start(): void {
    this.stopped = false;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.refresh();
    this.trigger();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  current(): SyncStatus {
    return this.status;
  }

  /** Ask for a cycle soon (after a local write or a manual request). */
  trigger(delayMs = 250): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.cycle(), delayMs);
  }

  private onOnline = () => {
    this.failures = 0;
    this.trigger(0);
  };

  private onOffline = () => {
    void this.refresh('offline');
  };

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.trigger(0);
  };

  private async cycle(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    let nextDelay =
      document.visibilityState === 'visible' ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS;
    try {
      if (!navigator.onLine) {
        await this.refresh('offline');
      } else {
        await this.refresh('syncing');
        await this.withLock(() => this.client.sync());
        this.failures = 0;
        this.needsLogin = false;
        await this.hooks.afterSync?.().catch(() => undefined);
        await this.refresh();
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DEVICE_REVOKED' && this.hooks.onRevoked) {
        this.stop();
        this.hooks.onRevoked();
      } else if (
        error instanceof ApiError &&
        error.code === 'AUTH_USER_DISABLED' &&
        this.hooks.onUserDisabled
      ) {
        this.stop();
        this.hooks.onUserDisabled();
      } else if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'DEVICE_REVOKED')
      ) {
        this.needsLogin = true;
        await this.refresh('attention');
      } else if (error instanceof NetworkError || error instanceof ApiError) {
        nextDelay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 300_000;
        this.failures += 1;
        await this.refresh('offline');
      } else {
        console.error('sync cycle failed', error instanceof Error ? error.message : error);
        await this.refresh('attention');
      }
    } finally {
      this.running = false;
      if (!this.stopped) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.cycle(), nextDelay);
      }
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      return navigator.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) =>
        lock ? fn() : undefined,
      );
    }
    return fn();
  }

  async refresh(forced?: SyncState): Promise<void> {
    const [counts, state] = await Promise.all([this.store.outboxCounts(), this.store.readState()]);
    const clockSuspect =
      state.lastServerTime !== null && Date.now() < state.lastServerTime - CLOCK_SKEW_MS;
    const attention =
      counts.rejected > 0 || counts.conflicts > 0 || clockSuspect || this.needsLogin;
    let next: SyncState;
    if (forced === 'syncing') next = 'syncing';
    else if (attention || forced === 'attention') next = 'attention';
    else if (forced === 'offline' || !navigator.onLine) next = 'offline';
    else next = 'online';
    this.status = {
      state: next,
      pending: counts.pending,
      rejected: counts.rejected,
      conflicts: counts.conflicts,
      lastSyncAt: state.lastSyncAt,
      clockSuspect,
      needsLogin: this.needsLogin,
    };
    for (const listener of this.listeners) listener(this.status);
  }
}
