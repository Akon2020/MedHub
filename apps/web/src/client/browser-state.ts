'use client';

import { useSyncExternalStore } from 'react';
import { readIdentity, readTenantCode, type StoredIdentity } from './identity';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Browser connectivity; assumed online during server rendering. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function subscribeStorage(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

let cachedRaw: string | null = null;
let cachedIdentity: StoredIdentity | null = null;

function identitySnapshot(): StoredIdentity | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem('medhub.identity');
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIdentity = raw ? readIdentity() : null;
  }
  return cachedIdentity;
}

export function useStoredIdentity(): StoredIdentity | null {
  return useSyncExternalStore(subscribeStorage, identitySnapshot, () => null);
}

export function useStoredTenantCode(): string {
  return useSyncExternalStore(subscribeStorage, readTenantCode, () => '');
}
