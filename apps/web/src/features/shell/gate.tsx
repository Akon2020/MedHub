'use client';

import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { RuntimeProvider, useRuntime } from '@/client/runtime';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppShell } from './app-shell';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="hero-backdrop flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="glass w-full max-w-md rounded-[28px] p-6 sm:p-9">{children}</div>
      </main>
    </div>
  );
}

function UnlockScreen() {
  const t = useTranslations('auth.unlock');
  const { identity, unlock, recover, signOut } = useRuntime();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [expired, setExpired] = useState(false);

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await unlock(pin);
    setPin('');
    setBusy(false);
    if (result.ok) return;
    if (result.reason === 'WRONG_PIN') setMessage(t('wrong', { remaining: result.remaining }));
    else if (result.reason === 'BLOCKED_USE_RECOVERY') {
      setMessage(t('blocked'));
      setRecoveryMode(true);
    } else if (result.reason === 'WIPED') setMessage(t('wiped'));
    else if (result.reason === 'OFFLINE_EXPIRED') {
      setMessage(t('offlineExpired'));
      setExpired(true);
    } else setMessage(t('noLocal'));
  }

  async function onRecover(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6,12}$/.test(newPin)) return;
    setBusy(true);
    const ok = await recover(code, newPin);
    setBusy(false);
    if (!ok) setMessage(t('recoveryFailed'));
  }

  return (
    <Frame>
      <span className="inline-grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <LockKeyhole className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        {identity ? `${identity.displayName} · ${identity.tenantName}` : t('subtitle')}
      </p>

      {!recoveryMode ? (
        <form onSubmit={onUnlock} className="mt-7 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="unlock-pin">{t('pin')}</Label>
            <Input
              id="unlock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
              className="text-center text-xl tracking-[0.5em]"
            />
          </div>
          {message && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {message}
            </p>
          )}
          {expired && (
            <Button asChild variant="secondary" size="lg">
              <Link href="/connexion">{t('signInOnline')}</Link>
            </Button>
          )}
          <Button type="submit" size="lg" disabled={busy || pin.length < 6}>
            {busy && <Loader2 className="animate-spin" />}
            {t('submit')}
          </Button>
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setRecoveryMode(true)}
          >
            {t('useRecovery')}
          </button>
        </form>
      ) : (
        <form onSubmit={onRecover} className="mt-7 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="recovery-code">{t('recoveryCode')}</Label>
            <Input
              id="recovery-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono tracking-wider"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recovery-pin">{t('newPin')}</Label>
            <Input
              id="recovery-pin"
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
            />
          </div>
          {message && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {message}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || newPin.length < 6 || code.length < 20}>
            <KeyRound />
            {t('recover')}
          </Button>
        </form>
      )}

      <button
        type="button"
        onClick={() => void signOut().then(() => router.replace('/connexion'))}
        className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-foreground"
      >
        {t('switchUser')}
      </button>
    </Frame>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { phase } = useRuntime();
  const router = useRouter();
  const t = useTranslations();

  useEffect(() => {
    if (phase === 'no-identity') router.replace('/connexion');
  }, [phase, router]);

  if (phase === 'ready') return <AppShell>{children}</AppShell>;
  if (phase === 'locked') return <UnlockScreen />;
  if (phase === 'not-activated') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">{t('auth.pinSetup.title')}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{t('auth.unlock.noLocal')}</p>
        <Button asChild className="mt-6 w-full">
          <Link href="/connexion">{t('auth.submit')}</Link>
        </Button>
      </Frame>
    );
  }
  return (
    <div className="grid min-h-dvh place-items-center bg-background" aria-busy="true">
      <Loader2 className="size-6 animate-spin text-primary" aria-label={t('common.loading')} />
    </div>
  );
}

export function AppGate({ children }: { children: ReactNode }) {
  return (
    <RuntimeProvider>
      <Gate>{children}</Gate>
    </RuntimeProvider>
  );
}
