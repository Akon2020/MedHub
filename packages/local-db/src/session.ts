import {
  PBKDF2_ITERATIONS,
  b64ToBytes,
  bytesToB64,
  decryptJson,
  deriveLocalKeys,
  encryptJson,
  generateMasterSecret,
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapSecret,
  wrapSecret,
  type LocalKeys,
} from './crypto';
import {
  MedHubLocalDb,
  localDbName,
  type MetaRecord,
  type StoredCatalogs,
  type StoredTokens,
} from './database';
import { EncryptedClientStore } from './store';

export const DEFAULT_MAX_PIN_ATTEMPTS = 10;

export type LocalIdentity = { tenantId: string; userId: string };

export type DeviceSecrets = { deviceId: string; deviceCode: string; secretKey: Uint8Array };

export type UnlockedLocal = {
  db: MedHubLocalDb;
  store: EncryptedClientStore;
  keys: LocalKeys;
};

export function openLocalDb(identity: LocalIdentity): MedHubLocalDb {
  return new MedHubLocalDb(localDbName(identity.tenantId, identity.userId));
}

export async function isInitialized(db: MedHubLocalDb): Promise<boolean> {
  return (await db.meta.get('pin')) !== undefined;
}

/**
 * Activation: creates the master secret, wraps it with the PIN and with a
 * recovery code shown once to the user. Returns that recovery code.
 */
export async function initializeLocal(
  db: MedHubLocalDb,
  pin: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ unlocked: UnlockedLocal; recoveryCode: string }> {
  const master = generateMasterSecret();
  const recoveryCode = generateRecoveryCode();
  const pinWrap = await wrapSecret(master, pin, iterations);
  const recoveryWrap = await wrapSecret(master, normalizeRecoveryCode(recoveryCode), iterations);
  const keys = await deriveLocalKeys(master);
  await db.meta.bulkPut([
    { key: 'pin', value: pinWrap },
    { key: 'recovery', value: recoveryWrap },
    { key: 'failedPins', value: 0 },
  ]);
  return { unlocked: { db, keys, store: new EncryptedClientStore(db, keys) }, recoveryCode };
}

export type UnlockResult =
  | { ok: true; unlocked: UnlockedLocal }
  | { ok: false; reason: 'WRONG_PIN'; remaining: number }
  | { ok: false; reason: 'WIPED' }
  | { ok: false; reason: 'BLOCKED_USE_RECOVERY' };

/**
 * After too many failures the local data is erased only if no operation is
 * waiting to be sent; otherwise the device is blocked until the recovery code
 * or an online login is used, so that no unsent work is ever lost.
 */
export async function unlockWithPin(
  db: MedHubLocalDb,
  pin: string,
  maxAttempts = DEFAULT_MAX_PIN_ATTEMPTS,
): Promise<UnlockResult> {
  const failedRow = await db.meta.get('failedPins');
  const failed = failedRow?.key === 'failedPins' ? failedRow.value : 0;
  if (failed >= maxAttempts) return { ok: false, reason: 'BLOCKED_USE_RECOVERY' };

  const wrapped = await db.meta.get('pin');
  if (wrapped?.key !== 'pin') throw new Error('LOCAL_NOT_INITIALIZED');
  try {
    const master = await unwrapSecret(wrapped.value, pin);
    const keys = await deriveLocalKeys(master);
    await db.meta.put({ key: 'failedPins', value: 0 });
    return { ok: true, unlocked: { db, keys, store: new EncryptedClientStore(db, keys) } };
  } catch {
    const next = failed + 1;
    await db.meta.put({ key: 'failedPins', value: next });
    if (next >= maxAttempts) {
      const pending = await db.outbox.count();
      if (pending === 0) {
        await db.delete();
        return { ok: false, reason: 'WIPED' };
      }
      return { ok: false, reason: 'BLOCKED_USE_RECOVERY' };
    }
    return { ok: false, reason: 'WRONG_PIN', remaining: maxAttempts - next };
  }
}

/** Recovery: unlocks with the printed code and sets a new PIN. */
export async function recoverWithCode(
  db: MedHubLocalDb,
  recoveryCode: string,
  newPin: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<UnlockedLocal> {
  const wrapped = await db.meta.get('recovery');
  if (wrapped?.key !== 'recovery') throw new Error('LOCAL_NOT_INITIALIZED');
  const master = await unwrapSecret(wrapped.value, normalizeRecoveryCode(recoveryCode));
  const pinWrap = await wrapSecret(master, newPin, iterations);
  const keys = await deriveLocalKeys(master);
  await db.meta.bulkPut([
    { key: 'pin', value: pinWrap },
    { key: 'failedPins', value: 0 },
  ]);
  return { db, keys, store: new EncryptedClientStore(db, keys) };
}

export async function saveDevice(unlocked: UnlockedLocal, device: DeviceSecrets): Promise<void> {
  const record: MetaRecord = {
    key: 'device',
    value: {
      deviceId: device.deviceId,
      deviceCode: device.deviceCode,
      enc: await encryptJson(unlocked.keys.dataKey, { secretKey: bytesToB64(device.secretKey) }),
    },
  };
  await unlocked.db.meta.put(record);
}

export async function loadDevice(unlocked: UnlockedLocal): Promise<DeviceSecrets | null> {
  const row = await unlocked.db.meta.get('device');
  if (row?.key !== 'device') return null;
  const secret = await decryptJson<{ secretKey: string }>(unlocked.keys.dataKey, row.value.enc);
  return {
    deviceId: row.value.deviceId,
    deviceCode: row.value.deviceCode,
    secretKey: b64ToBytes(secret.secretKey),
  };
}

export async function saveTokens(
  db: MedHubLocalDb,
  tokens: Omit<StoredTokens, 'refreshedAt'>,
  refreshedAt = Date.now(),
): Promise<void> {
  await db.meta.put({ key: 'tokens', value: { ...tokens, refreshedAt } });
}

export async function loadTokens(db: MedHubLocalDb): Promise<StoredTokens | null> {
  const row = await db.meta.get('tokens');
  return row?.key === 'tokens' ? row.value : null;
}

export async function saveCatalogs(db: MedHubLocalDb, catalogs: StoredCatalogs): Promise<void> {
  await db.meta.put({ key: 'catalogs', value: catalogs });
}

export async function loadCatalogs(db: MedHubLocalDb): Promise<StoredCatalogs | null> {
  const row = await db.meta.get('catalogs');
  return row?.key === 'catalogs' ? row.value : null;
}

/**
 * The user was disabled: the offline token is dropped so that the PIN no
 * longer opens this database, but pending operations stay in case the account
 * is restored and the user signs in online again.
 */
export async function revokeOfflineToken(db: MedHubLocalDb): Promise<void> {
  const tokens = await loadTokens(db);
  await db.meta.put({
    key: 'tokens',
    value: {
      offlineToken: '',
      licenseToken: tokens?.licenseToken ?? '',
      signingKeys: tokens?.signingKeys ?? {},
      ...(tokens?.config ? { config: tokens.config } : {}),
      refreshedAt: tokens?.refreshedAt ?? 0,
    },
  });
}

/**
 * Remote wipe of a retired or lost device: the whole local database goes,
 * including any operation the server refused to receive.
 */
export async function wipeLocal(db: MedHubLocalDb): Promise<void> {
  db.close();
  await db.delete();
}
