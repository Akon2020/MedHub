import {
  loadCatalogs,
  loadTokens,
  type EncryptedClientStore,
  type MedHubLocalDb,
} from '@medhub/local-db';
import { sealForSupport } from '@medhub/sync';
import { APP_VERSION } from './activation';

export type JournalContext = {
  tenantCode: string;
  userId: string;
  deviceId: string;
  deviceCode: string;
  status: { pending: number; rejected: number; conflicts: number; clockSuspect: boolean } | null;
};

/**
 * What support needs to understand a device: counters, identifiers, states and
 * error codes. Never an operation payload, a name or a clinical value: the
 * outbox content stays encrypted in IndexedDB and is not read here, except the
 * command name and error code of rejected operations.
 */
async function buildJournal(
  db: MedHubLocalDb,
  store: EncryptedClientStore,
  context: JournalContext,
): Promise<Record<string, unknown>> {
  const [state, outbox, conflicts, rejected, tokens, catalogs] = await Promise.all([
    store.readState(),
    db.outbox.toArray(),
    db.conflicts.toArray(),
    store.rejectedItems(),
    loadTokens(db),
    loadCatalogs(db),
  ]);
  const estimate = await navigator.storage?.estimate().catch(() => null);
  return {
    kind: 'medhub-diagnostic',
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    tenantCode: context.tenantCode,
    userId: context.userId,
    device: { id: context.deviceId, code: context.deviceCode },
    status: context.status,
    syncState: state,
    outbox: outbox.map((o) => ({
      opId: o.opId,
      seq: o.seq,
      status: o.status,
      attempts: o.attempts,
      entity: o.entity,
      entityId: o.entityId,
    })),
    rejected: rejected.map((r) => ({
      opId: r.opId,
      command: r.op.command,
      error: r.lastError ?? null,
    })),
    conflicts,
    tokens: tokens
      ? {
          refreshedAt: tokens.refreshedAt,
          hasOfflineToken: tokens.offlineToken !== '',
          config: tokens.config ?? null,
        }
      : null,
    catalogs: catalogs ? { etag: catalogs.snapshot.etag, fetchedAt: catalogs.fetchedAt } : null,
    storage: estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null,
  };
}

/**
 * The journal sealed for the support key received with the device tokens.
 * Works offline: the file can travel by any means, only support can open it.
 */
export async function exportJournal(
  db: MedHubLocalDb,
  store: EncryptedClientStore,
  context: JournalContext,
): Promise<{ fileName: string; content: string } | 'NO_SUPPORT_KEY'> {
  const supportKey = (await loadTokens(db))?.supportKey;
  if (!supportKey) return 'NO_SUPPORT_KEY';
  const envelope = await sealForSupport(
    JSON.stringify(await buildJournal(db, store, context)),
    supportKey,
  );
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return {
    fileName: `medhub-${context.tenantCode}-${context.deviceCode}-${stamp}.medhub-diag`,
    content: JSON.stringify(envelope),
  };
}
