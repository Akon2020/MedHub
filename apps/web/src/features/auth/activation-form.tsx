'use client';

import { DEVICE_KINDS, type DeviceKind } from '@medhub/shared';
import { CheckCircle2, Loader2, Printer, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { activateDevice } from '@/client/activation';
import { ApiError } from '@/client/api';
import { useStoredIdentity } from '@/client/browser-state';
import { readIdentity } from '@/client/identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const noopSubscribe = () => () => undefined;

function guessKind(): DeviceKind {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android/i.test(ua)) return 'phone';
  return 'desktop';
}

export function ActivationForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const identity = useStoredIdentity();
  const guessedKind = useSyncExternalStore(noopSubscribe, guessKind, () => 'desktop' as DeviceKind);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [kindChoice, setKind] = useState<DeviceKind | null>(null);
  const kind = kindChoice ?? guessedKind;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [stored, setStored] = useState(false);

  useEffect(() => {
    if (!readIdentity()) router.replace('/connexion');
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    if (!/^\d{6,12}$/.test(pin)) return setError(t('pinSetup.tooShort'));
    if (pin !== confirm) return setError(t('pinSetup.mismatch'));
    setError(null);
    setBusy(true);
    try {
      const result = await activateDevice(identity, {
        pin,
        name: name.trim() || t(`pinSetup.kinds.${kind}`),
        kind,
      });
      setPin('');
      setConfirm('');
      setRecovery(result.recoveryCode);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/connexion');
      setError(err instanceof ApiError ? t('errors.UNKNOWN') : t('errors.NETWORK'));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    return (
      <div>
        <span className="inline-grid size-12 place-items-center rounded-2xl bg-accent text-primary">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold">{t('recovery.title')}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{t('recovery.text')}</p>
        <p className="mt-6 select-all break-all rounded-2xl bg-card p-5 text-center font-mono text-lg font-semibold tracking-widest ring-1 ring-border">
          {recovery}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => window.print()}>
            <Printer />
            {t('recovery.print')}
          </Button>
        </div>
        <label className="mt-6 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={stored}
            onChange={(e) => setStored(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          {t('recovery.confirm')}
        </label>
        <Button
          className="mt-6 w-full"
          size="lg"
          disabled={!stored}
          onClick={() => router.replace('/app')}
        >
          <CheckCircle2 />
          {t('recovery.continue')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('pinSetup.title')}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t('pinSetup.subtitle')}</p>
      <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="pin">{t('pinSetup.pin')}</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pinConfirm">{t('pinSetup.pinConfirm')}</Label>
            <Input
              id="pinConfirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="deviceName">{t('pinSetup.deviceName')}</Label>
          <Input
            id="deviceName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('pinSetup.deviceNamePlaceholder')}
            maxLength={60}
          />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-slate-ink">
            {t('pinSetup.deviceKind')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {DEVICE_KINDS.map((k) => (
              <label
                key={k}
                className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 transition-colors ${
                  kind === k ? 'bg-accent ring-primary' : 'bg-card ring-border hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="accent-[var(--primary)]"
                />
                {t(`pinSetup.kinds.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy || !identity} className="w-full">
          {busy && <Loader2 className="animate-spin" />}
          {busy ? t('pinSetup.submitting') : t('pinSetup.submit')}
        </Button>
      </form>
    </div>
  );
}
