'use client';

import { DUPLICATE_ALERT_SCORE, type CommandName, type CommandPayload } from '@medhub/domain';
import {
  DEFAULT_MAX_PIN_ATTEMPTS,
  isInitialized,
  loadCatalogs,
  loadTokens,
  loadDevice,
  nextCounter,
  openLocalDb,
  recoverWithCode,
  revokeOfflineToken,
  unlockWithPin,
  wipeLocal,
  type EncryptedClientStore,
  type MedHubLocalDb,
  type StoredCatalogs,
  type UnlockedLocal,
} from '@medhub/local-db';
import { systemClock } from '@medhub/shared';
import { signOperation } from '@medhub/sync';
import { SyncClient, type DispatchOptions } from '@medhub/sync/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from './api';
import { refreshCatalogs } from './catalogs';
import { exportJournal } from './diagnostic-export';
import { refreshTokens, tokensDue, tokenStatus, type TokenStatus } from './device-tokens';
import { installTestHook } from './e2e-hook';
import { clearIdentity, DEVICE_REVOKED_FLAG, readIdentity, type StoredIdentity } from './identity';
import { SyncLoop, type SyncStatus } from './sync-loop';
import { HttpSyncTransport } from './transport';

export type Phase = 'loading' | 'no-identity' | 'not-activated' | 'locked' | 'ready';

export type UnlockOutcome =
  | { ok: true }
  | { ok: false; reason: 'WRONG_PIN'; remaining: number }
  | { ok: false; reason: 'BLOCKED_USE_RECOVERY' | 'WIPED' | 'NOT_ACTIVATED' | 'OFFLINE_EXPIRED' };

type Session = {
  unlocked: UnlockedLocal;
  client: SyncClient;
  loop: SyncLoop;
  device: { deviceId: string; deviceCode: string };
};

type RuntimeValue = {
  phase: Phase;
  identity: StoredIdentity | null;
  device: { deviceId: string; deviceCode: string } | null;
  store: EncryptedClientStore | null;
  status: SyncStatus | null;
  /** Offline access and license read from the signed tokens of the device. */
  tokens: TokenStatus | null;
  /** Local copy of the read-only catalogs (sites, departments, pick lists...). */
  catalogs: StoredCatalogs | null;
  /** Similarity score from which registration shows the patients that look alike. */
  duplicateAlertScore: number;
  /** Downloads the catalogs now, without waiting for the next check. */
  reloadCatalogs: () => Promise<void>;
  /** Diagnostic journal sealed for support (no patient data, readable by support only). */
  exportJournal: () => Promise<{ fileName: string; content: string } | 'NO_SUPPORT_KEY' | null>;
  /** Bumped after every local write and every sync cycle; drives local queries. */
  revision: number;
  unlock: (pin: string) => Promise<UnlockOutcome>;
  recover: (code: string, newPin: string) => Promise<boolean>;
  lock: () => void;
  signOut: () => Promise<void>;
  syncNow: () => void;
  dispatch: <N extends CommandName>(
    name: N,
    payload: CommandPayload<N>,
    options?: DispatchOptions,
  ) => Promise<{ opId: string; entityId: string }>;
  nextCounter: (name: string) => Promise<number>;
};

const RuntimeContext = createContext<RuntimeValue | null>(null);

/** Defaults until the structure publishes its own values (docs/06, config_entry). */
const DEFAULT_AUTO_LOCK_MINUTES = 5;

async function startSession(
  identity: StoredIdentity,
  unlocked: UnlockedLocal,
  hooks: {
    afterSync: (deviceId: string) => Promise<void>;
    onRevoked: () => void;
    onUserDisabled: () => void;
  },
): Promise<Session | null> {
  const device = await loadDevice(unlocked);
  if (!device) return null;
  const secretKey = device.secretKey;
  const client = new SyncClient({
    store: unlocked.store,
    transport: new HttpSyncTransport(device.deviceId),
    clock: systemClock,
    identity: {
      tenantId: identity.tenantId,
      siteId: identity.siteId,
      userId: identity.userId,
      deviceId: device.deviceId,
    },
    sign: (op) => signOperation(op, secretKey),
    permissions: new Set(identity.permissions),
  });
  const loop = new SyncLoop(client, unlocked.store, {
    afterSync: () => hooks.afterSync(device.deviceId),
    onRevoked: hooks.onRevoked,
    onUserDisabled: hooks.onUserDisabled,
  });
  return {
    unlocked,
    client,
    loop,
    device: { deviceId: device.deviceId, deviceCode: device.deviceCode },
  };
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const [tokens, setTokens] = useState<TokenStatus | null>(null);
  const [catalogs, setCatalogs] = useState<StoredCatalogs | null>(null);
  const [autoLockMs, setAutoLockMs] = useState(DEFAULT_AUTO_LOCK_MINUTES * 60_000);
  const [duplicateAlertScore, setDuplicateAlertScore] = useState(DUPLICATE_ALERT_SCORE);
  const dbRef = useRef<MedHubLocalDb | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readIdentity();
      if (!stored) {
        if (!cancelled) setPhase('no-identity');
        return;
      }
      const db = openLocalDb(stored);
      dbRef.current = db;
      const initialized = await isInitialized(db);
      if (cancelled) return;
      setIdentity(stored);
      setPhase(initialized ? 'locked' : 'not-activated');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.loop.subscribe((next) => {
      setStatus(next);
      setRevision((r) => r + 1);
    });
    session.loop.start();
    const uninstall = installTestHook({
      client: session.client,
      store: session.unlocked.store,
      db: session.unlocked.db,
      device: session.device,
    });
    return () => {
      uninstall();
      unsubscribe();
      session.loop.stop();
    };
  }, [session]);

  const lock = useCallback(() => {
    setSession(null);
    setStatus(null);
    setPhase((p) => (p === 'ready' ? 'locked' : p));
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return;
    let timer = setTimeout(lock, autoLockMs);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, autoLockMs);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [phase, lock, autoLockMs]);

  /** Remote wipe ordered by the server (device retired or declared lost). */
  const wipeDevice = useCallback(() => {
    const db = dbRef.current;
    setSession(null);
    setStatus(null);
    void (async () => {
      if (db) await wipeLocal(db).catch(() => undefined);
      dbRef.current = null;
      clearIdentity();
      try {
        window.sessionStorage.setItem(DEVICE_REVOKED_FLAG, '1');
      } catch {
        // The sign-in page then simply shows no explanation.
      }
      setIdentity(null);
      setPhase('no-identity');
    })();
  }, []);

  const openWith = useCallback(
    async (unlocked: UnlockedLocal): Promise<'ok' | 'not-activated' | 'expired'> => {
      if (!identity) return 'not-activated';
      const device = await loadDevice(unlocked);
      if (!device) return 'not-activated';
      const who = {
        tenantId: identity.tenantId,
        userId: identity.userId,
        deviceId: device.deviceId,
      };
      const read = async () =>
        tokenStatus(unlocked.db, who, (await unlocked.store.readState()).lastServerTime);
      let current = await read();
      if (current.offline !== 'valid' && current.offline !== 'expiring' && navigator.onLine) {
        if (await refreshTokens(unlocked.db, device.deviceId)) current = await read();
      }
      // Devices activated before the tokens existed keep working until their next sync.
      if (current.offline === 'expired' || current.offline === 'invalid') return 'expired';
      setTokens(current);
      setCatalogs(await loadCatalogs(unlocked.db));
      const stored = await loadTokens(unlocked.db);
      if (stored?.config) setAutoLockMs(stored.config.autoLockMinutes * 60_000);
      if (stored?.config?.duplicateAlertScore) {
        setDuplicateAlertScore(stored.config.duplicateAlertScore);
      }
      const next = await startSession(identity, unlocked, {
        afterSync: async (deviceId) => {
          if (await refreshCatalogs(unlocked.db)) setCatalogs(await loadCatalogs(unlocked.db));
          if (!(await tokensDue(unlocked.db))) return;
          if (await refreshTokens(unlocked.db, deviceId)) setTokens(await read());
        },
        onRevoked: wipeDevice,
        onUserDisabled: () => {
          void revokeOfflineToken(unlocked.db)
            .catch(() => undefined)
            .then(lock);
        },
      });
      if (!next) return 'not-activated';
      setSession(next);
      setPhase('ready');
      return 'ok';
    },
    [identity, wipeDevice, lock],
  );

  const unlock = useCallback(
    async (pin: string): Promise<UnlockOutcome> => {
      const db = dbRef.current;
      if (!db || !identity) return { ok: false, reason: 'NOT_ACTIVATED' };
      const stored = await loadTokens(db);
      const result = await unlockWithPin(
        db,
        pin,
        stored?.config?.pinMaxAttempts ?? DEFAULT_MAX_PIN_ATTEMPTS,
      );
      if (!result.ok) {
        if (result.reason === 'WIPED') setPhase('not-activated');
        return result;
      }
      const opened = await openWith(result.unlocked);
      if (opened === 'ok') return { ok: true };
      return { ok: false, reason: opened === 'expired' ? 'OFFLINE_EXPIRED' : 'NOT_ACTIVATED' };
    },
    [identity, openWith],
  );

  const recover = useCallback(
    async (code: string, newPin: string) => {
      const db = dbRef.current;
      if (!db) return false;
      try {
        return (await openWith(await recoverWithCode(db, code, newPin))) === 'ok';
      } catch {
        return false;
      }
    },
    [openWith],
  );

  const signOut = useCallback(async () => {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null);
    clearIdentity();
    setIdentity(null);
    setPhase('no-identity');
  }, []);

  const dispatch = useCallback<RuntimeValue['dispatch']>(
    async (name, payload, options) => {
      if (!session) throw new Error('LOCKED');
      const result = await session.client.dispatch(name, payload, options);
      setRevision((r) => r + 1);
      await session.loop.refresh();
      session.loop.trigger();
      return result;
    },
    [session],
  );

  const value = useMemo<RuntimeValue>(
    () => ({
      phase,
      identity,
      device: session?.device ?? null,
      store: session?.unlocked.store ?? null,
      status,
      tokens,
      catalogs,
      duplicateAlertScore,
      reloadCatalogs: async () => {
        if (!session) return;
        await refreshCatalogs(session.unlocked.db, Date.now(), true);
        setCatalogs(await loadCatalogs(session.unlocked.db));
      },
      exportJournal: async () => {
        if (!session || !identity) return null;
        return exportJournal(session.unlocked.db, session.unlocked.store, {
          tenantCode: identity.tenantCode,
          userId: identity.userId,
          deviceId: session.device.deviceId,
          deviceCode: session.device.deviceCode,
          status: status
            ? {
                pending: status.pending,
                rejected: status.rejected,
                conflicts: status.conflicts,
                clockSuspect: status.clockSuspect,
              }
            : null,
        });
      },
      revision,
      unlock,
      recover,
      lock,
      signOut,
      syncNow: () => session?.loop.trigger(0),
      dispatch,
      nextCounter: async (name: string) => {
        if (!session) throw new Error('LOCKED');
        return nextCounter(session.unlocked.db, name);
      },
    }),
    [
      phase,
      identity,
      session,
      status,
      tokens,
      catalogs,
      duplicateAlertScore,
      revision,
      unlock,
      recover,
      lock,
      signOut,
      dispatch,
    ],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime must be used inside RuntimeProvider');
  return value;
}

/** Runs an async read against the unlocked local store and re-runs it on every local change. */
export function useLocalQuery<T>(
  query: (store: EncryptedClientStore) => Promise<T>,
  deps: readonly unknown[],
): { data: T | undefined; loading: boolean } {
  const { store, revision } = useRuntime();
  const [state, setState] = useState<{ data: T | undefined; loading: boolean }>({
    data: undefined,
    loading: true,
  });
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    queryRef
      .current(store)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, revision, ...deps]);

  return state;
}
