import Dexie, { type Table } from 'dexie';
import type { CatalogSnapshot } from '@medhub/domain';
import type { Ciphertext, WrappedSecret } from './crypto';

/**
 * Only identifiers, foreign keys, versions and status codes stay in clear for
 * indexing. Names, phone numbers, clinical values and payloads live in `enc`.
 */
export type EntityRecord = {
  key: string;
  entity: string;
  id: string;
  version: number;
  patientId: string | null;
  status: string | null;
  rejected: 0 | 1;
  enc: Ciphertext;
};

export type OutboxRecord = {
  opId: string;
  seq: number;
  status: string;
  attempts: number;
  entity: string;
  entityId: string;
  enc: Ciphertext;
};

export type SyncStateRow = {
  key: 'state';
  cursor: number;
  lastSyncAt: number | null;
  lastServerTime: number | null;
  hlc: string | null;
  outboxSeq: number;
};

export type ConflictRecord = {
  opId: string;
  entity: string;
  entityId: string;
  conflictId?: string;
  at: string;
};

export type SearchToken = {
  key: string;
  token: string;
  entityId: string;
};

/**
 * Platform tokens of the device. Signed, not secret (identifiers and dates only),
 * so they stay readable before the PIN unlocks the data key.
 */
export type StoredTokens = {
  offlineToken: string;
  licenseToken: string;
  signingKeys: Record<string, string>;
  /** Published structure settings applied offline. */
  config?: { autoLockMinutes: number; pinMaxAttempts: number };
  /** Seals the diagnostic journal for support; absent until the platform configures it. */
  supportKey?: string | null;
  refreshedAt: number;
};

/**
 * Read-only catalogs (sites, departments, pick lists, units, currencies,
 * provinces): structure settings, not patient data, kept readable offline.
 */
export type StoredCatalogs = { snapshot: CatalogSnapshot; fetchedAt: number };

export type MetaRecord =
  | { key: 'pin'; value: WrappedSecret }
  | { key: 'recovery'; value: WrappedSecret }
  | { key: 'device'; value: { deviceId: string; deviceCode: string; enc: Ciphertext } }
  | { key: 'failedPins'; value: number }
  | { key: 'tokens'; value: StoredTokens }
  | { key: 'catalogs'; value: StoredCatalogs }
  | { key: `counter:${string}`; value: number };

export class MedHubLocalDb extends Dexie {
  entities!: Table<EntityRecord, string>;
  outbox!: Table<OutboxRecord, string>;
  syncState!: Table<SyncStateRow, string>;
  conflicts!: Table<ConflictRecord, string>;
  searchIndex!: Table<SearchToken, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entities: 'key, entity, [entity+id], [entity+patientId], [entity+status]',
      outbox: 'opId, seq, status, entityId',
      syncState: 'key',
      conflicts: 'opId, entityId',
      searchIndex: 'key, token, entityId',
      meta: 'key',
    });
  }
}

/**
 * Atomic local counter used by offline numbering (MRN, receipts). It advances
 * before the number is used, so a failure can leave a gap but never a duplicate.
 */
export async function nextCounter(db: MedHubLocalDb, name: string): Promise<number> {
  const key = `counter:${name}` as const;
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(key);
    const next = (row && typeof row.value === 'number' ? row.value : 0) + 1;
    await db.meta.put({ key, value: next });
    return next;
  });
}

/** One database per structure and per user (docs/02-offline-sync.md section 2). */
export function localDbName(tenantId: string, userId: string): string {
  return `medhub-${tenantId}-${userId}`;
}
