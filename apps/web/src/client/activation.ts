import { initializeLocal, openLocalDb, saveDevice } from '@medhub/local-db';
import type { DeviceKind } from '@medhub/shared';
import { bytesToBase64, generateDeviceKeyPair } from '@medhub/sync';
import { apiFetch } from './api';
import { storeTokens, type DeviceTokensResponse } from './device-tokens';
import type { StoredIdentity } from './identity';

export const APP_VERSION = '0.1.0';

/**
 * Device activation (online only): creates the encrypted local database, the
 * Ed25519 key pair that signs every operation, and registers the public key.
 * Returns the recovery code that must be shown exactly once.
 */
export async function activateDevice(
  identity: StoredIdentity,
  input: { pin: string; name: string; kind: DeviceKind },
): Promise<{ recoveryCode: string; deviceCode: string }> {
  const db = openLocalDb(identity);
  const keys = generateDeviceKeyPair();
  const registered = await apiFetch<{
    deviceId: string;
    deviceCode: string;
    tokens: DeviceTokensResponse;
  }>('/api/v1/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      publicKey: bytesToBase64(keys.publicKey),
      name: input.name,
      kind: input.kind,
      appVersion: APP_VERSION,
    }),
  });
  const { unlocked, recoveryCode } = await initializeLocal(db, input.pin);
  await saveDevice(unlocked, {
    deviceId: registered.deviceId,
    deviceCode: registered.deviceCode,
    secretKey: keys.secretKey,
  });
  await storeTokens(db, registered.tokens);
  keys.secretKey.fill(0);
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  db.close();
  return { recoveryCode, deviceCode: registered.deviceCode };
}
