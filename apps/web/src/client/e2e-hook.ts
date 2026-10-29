import type { EncryptedClientStore, MedHubLocalDb } from '@medhub/local-db';
import type { SyncClient } from '@medhub/sync/client';
import { SYNC_LOCK_NAME } from './sync-loop';

/**
 * Test hook for the two-browser offline bench (docs/02-offline-sync.md section 13).
 * Only installed when the build sets NEXT_PUBLIC_MEDHUB_E2E=1; never in production.
 */
export const E2E_ENABLED = process.env.NEXT_PUBLIC_MEDHUB_E2E === '1';

export type MedHubTestHook = {
  deviceId: string;
  deviceCode: string;
  dispatch: SyncClient['dispatch'];
  /** One full push and pull cycle; resolves to null on success, otherwise the error. */
  sync: () => Promise<string | null>;
  entities: (entity: string) => Promise<{ id: string; version: number; data: unknown }[]>;
  pending: () => Promise<number>;
  rawDump: () => Promise<string>;
};

declare global {
  interface Window {
    __medhubTest?: MedHubTestHook;
  }
}

export function installTestHook(input: {
  client: SyncClient;
  store: EncryptedClientStore;
  db: MedHubLocalDb;
  device: { deviceId: string; deviceCode: string };
}): () => void {
  if (!E2E_ENABLED) return () => undefined;
  const { client, store, db, device } = input;
  window.__medhubTest = {
    ...device,
    dispatch: (name, payload, options) => client.dispatch(name, payload, options),
    sync: async () => {
      try {
        // Waits for the background loop's cycle instead of returning while it runs.
        await navigator.locks.request(SYNC_LOCK_NAME, () => client.sync());
        return null;
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : 'UNKNOWN';
      }
    },
    entities: async (entity) =>
      (await store.readEntities(entity)).map((e) => ({
        id: e.id,
        version: e.version,
        data: e.data,
      })),
    pending: async () => (await store.outboxCounts()).pending,
    rawDump: async () => JSON.stringify(await Promise.all(db.tables.map((t) => t.toArray()))),
  };
  return () => {
    delete window.__medhubTest;
  };
}
