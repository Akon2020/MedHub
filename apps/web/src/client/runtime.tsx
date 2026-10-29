'use client';

import type { CommandName, CommandPayload } from '@medhub/domain';
import {
  isInitialized,
  loadDevice,
  nextCounter,
  openLocalDb,
  recoverWithCode,
  unlockWithPin,
  type EncryptedClientStore,
  type MedHubLocalDb,
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
import { installTestHook } from './e2e-hook';
import { clearIdentity, readIdentity, type StoredIdentity } from './identity';
import { SyncLoop, type SyncStatus } from './sync-loop';
import { HttpSyncTransport } from './transport';

export type Phase = 'loading' | 'no-identity' | 'not-activated' | 'locked' | 'ready';

export type UnlockOutcome =
  | { ok: true }
  | { ok: false; reason: 'WRONG_PIN'; remaining: number }
  | { ok: false; reason: 'BLOCKED_USE_RECOVERY' | 'WIPED' | 'NOT_ACTIVATED' };

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

const AUTO_LOCK_MS = 5 * 60 * 1000;

async function startSession(
  identity: StoredIdentity,
  unlocked: UnlockedLocal,
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
  const loop = new SyncLoop(client, unlocked.store);
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
    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, AUTO_LOCK_MS);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [phase, lock]);

  const openWith = useCallback(
    async (unlocked: UnlockedLocal): Promise<boolean> => {
      if (!identity) return false;
      const next = await startSession(identity, unlocked);
      if (!next) return false;
      setSession(next);
      setPhase('ready');
      return true;
    },
    [identity],
  );

  const unlock = useCallback(
    async (pin: string): Promise<UnlockOutcome> => {
      const db = dbRef.current;
      if (!db || !identity) return { ok: false, reason: 'NOT_ACTIVATED' };
      const result = await unlockWithPin(db, pin);
      if (!result.ok) {
        if (result.reason === 'WIPED') setPhase('not-activated');
        return result;
      }
      return (await openWith(result.unlocked))
        ? { ok: true }
        : { ok: false, reason: 'NOT_ACTIVATED' };
    },
    [identity, openWith],
  );

  const recover = useCallback(
    async (code: string, newPin: string) => {
      const db = dbRef.current;
      if (!db) return false;
      try {
        return await openWith(await recoverWithCode(db, code, newPin));
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
    [phase, identity, session, status, revision, unlock, recover, lock, signOut, dispatch],
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
