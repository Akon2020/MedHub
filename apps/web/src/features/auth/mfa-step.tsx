'use client';

import { KeyRound, Loader2, Printer, ShieldCheck, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import type { ServerProfile } from '@/client/identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MFA_ERRORS = new Set([
  'AUTH_MFA_INVALID',
  'AUTH_MFA_CHALLENGE_EXPIRED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_TENANT_SUSPENDED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
]);

export type EnrollmentMaterial = { secret: string; uri: string; qrSvg: string };

export function useMfaErrorMessage() {
  const t = useTranslations('auth');
  return (error: unknown) =>
    error instanceof ApiError
      ? t(`errors.${MFA_ERRORS.has(error.code) ? error.code : 'UNKNOWN'}`)
      : t('errors.NETWORK');
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {message}
    </p>
  );
}

function CodeField({
  value,
  onChange,
  recovery,
}: {
  value: string;
  onChange: (value: string) => void;
  recovery: boolean;
}) {
  const t = useTranslations('auth.mfa');
  return (
    <div className="grid gap-2">
      <Label htmlFor="mfa-code">{recovery ? t('recoveryCode') : t('code')}</Label>
      <Input
        id="mfa-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={recovery ? 11 : 6}
        placeholder={recovery ? 'XXXXX-XXXXX' : '123456'}
        className="text-center font-mono text-lg tracking-[0.3em]"
        autoFocus
        required
      />
    </div>
  );
}

/** Second sign-in step for an account that already has an authenticator. */
export function MfaVerifyStep({
  challenge,
  onSignedIn,
}: {
  challenge: string;
  onSignedIn: (profile: ServerProfile) => Promise<void>;
}) {
  const t = useTranslations('auth.mfa');
  const describe = useMfaErrorMessage();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { profile } = await apiFetch<{ profile: ServerProfile }>('/api/v1/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge, code: code.trim() }),
      });
      await onSignedIn(profile);
    } catch (err) {
      setError(describe(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="inline-grid size-12 place-items-center rounded-2xl bg-accent text-primary">
        <Smartphone className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">{t('verifyTitle')}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {recovery ? t('recoveryText') : t('verifyText')}
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-5" noValidate>
        <CodeField value={code} onChange={setCode} recovery={recovery} />
        <ErrorLine message={error} />
        <Button
          type="submit"
          size="lg"
          disabled={busy || code.trim().length < 6}
          className="w-full"
        >
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {t('verify')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {recovery ? t('useApp') : t('useRecovery')}
        </button>
      </form>
    </div>
  );
}

export function RecoveryCodesPanel({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[];
  onDone: () => void;
  doneLabel: string;
}) {
  const t = useTranslations('auth.mfa');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <h2 className="text-xl font-semibold">{t('recoveryCodesTitle')}</h2>
      <p className="mt-2 text-[15px] text-muted-foreground">{t('recoveryCodesText')}</p>
      <ol className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-card p-4 font-mono text-[15px] font-semibold tracking-wider ring-1 ring-border">
        {codes.map((code) => (
          <li key={code} className="select-all text-center">
            {code}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          <Printer />
          {t('print')}
        </Button>
      </div>
      <label className="mt-5 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        {t('recoveryConfirm')}
      </label>
      <Button
        type="button"
        size="lg"
        className="mt-5 w-full"
        disabled={!confirmed}
        onClick={onDone}
      >
        {doneLabel}
      </Button>
    </div>
  );
}

/** Shows the QR code and the secret, then asks for a first code. */
export function EnrollmentForm({
  material,
  onConfirm,
}: {
  material: EnrollmentMaterial;
  onConfirm: (code: string) => Promise<void>;
}) {
  const t = useTranslations('auth.mfa');
  const describe = useMfaErrorMessage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qr = `data:image/svg+xml;base64,${btoa(material.qrSvg)}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(code.trim());
    } catch (err) {
      setError(describe(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <ol className="grid gap-1.5 text-sm text-muted-foreground">
        <li>1. {t('enrollStep1')}</li>
        <li>2. {t('enrollStep2')}</li>
        <li>3. {t('enrollStep3')}</li>
      </ol>
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-border sm:flex-row sm:items-start">
        {/* The QR code stays dark on white in both themes so that cameras can read it. */}
        {/* A data URL needs no optimisation: next/image would add nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={t('qrAlt')} width={168} height={168} className="size-42 shrink-0" />
        <div className="min-w-0 text-[#0d1d1d]">
          <p className="text-xs font-medium uppercase tracking-wide text-[#5d6a78]">
            {t('manualKey')}
          </p>
          <p className="mt-1 select-all break-all font-mono text-sm font-semibold">
            {material.secret.replace(/(.{4})/g, '$1 ').trim()}
          </p>
        </div>
      </div>
      <CodeField value={code} onChange={setCode} recovery={false} />
      <ErrorLine message={error} />
      <Button
        type="submit"
        size="lg"
        disabled={busy || code.trim().length !== 6}
        className="w-full"
      >
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        {t('activate')}
      </Button>
    </form>
  );
}

/** Enrollment imposed at sign-in by a role that requires a second factor. */
export function MfaEnrollStep({
  challenge,
  onSignedIn,
}: {
  challenge: string;
  onSignedIn: (profile: ServerProfile) => Promise<void>;
}) {
  const t = useTranslations('auth.mfa');
  const describe = useMfaErrorMessage();
  const [material, setMaterial] = useState<EnrollmentMaterial | null>(null);
  const [done, setDone] = useState<{ profile: ServerProfile; codes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setMaterial(
        await apiFetch<EnrollmentMaterial>('/api/v1/auth/mfa/enroll', {
          method: 'POST',
          body: JSON.stringify({ challenge }),
        }),
      );
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(code: string) {
    const result = await apiFetch<{ profile: ServerProfile; recoveryCodes: string[] }>(
      '/api/v1/auth/mfa/activate',
      { method: 'POST', body: JSON.stringify({ challenge, code }) },
    );
    setDone({ profile: result.profile, codes: result.recoveryCodes });
  }

  if (done) {
    return (
      <RecoveryCodesPanel
        codes={done.codes}
        doneLabel={t('continue')}
        onDone={() => void onSignedIn(done.profile)}
      />
    );
  }

  return (
    <div>
      <span className="inline-grid size-12 place-items-center rounded-2xl bg-accent text-primary">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">{t('enrollTitle')}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t('enrollText')}</p>
      <div className="mt-8">
        {material ? (
          <EnrollmentForm material={material} onConfirm={confirm} />
        ) : (
          <div className="grid gap-5">
            <ErrorLine message={error} />
            <Button type="button" size="lg" className="w-full" disabled={busy} onClick={start}>
              {busy ? <Loader2 className="animate-spin" /> : <Smartphone />}
              {t('enrollStart')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
