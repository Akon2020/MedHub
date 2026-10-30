'use client';

import { isInitialized, openLocalDb } from '@medhub/local-db';
import { isTenantCode, normalizeTenantCode } from '@medhub/shared';
import { Building2, KeyRound, Loader2, LogIn, User, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline, useStoredIdentity, useStoredTenantCode } from '@/client/browser-state';
import {
  DEVICE_REVOKED_FLAG,
  identityFromProfile,
  writeIdentity,
  type ServerProfile,
} from '@/client/identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MfaEnrollStep, MfaVerifyStep } from './mfa-step';
import { PasswordChangeStep, type AfterPassword } from './password-step';

const KNOWN_ERRORS = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_TENANT_UNKNOWN',
  'AUTH_TENANT_SUSPENDED',
  'AUTH_NO_ACTIVE_ROLE',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
]);

type LoginResponse =
  AfterPassword | { status: 'password_change_required'; challenge: string; minLength: number };

type Step =
  | { kind: 'verify' | 'enroll'; challenge: string }
  | { kind: 'password'; challenge: string; minLength: number };

function Field({
  id,
  label,
  icon: Icon,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  icon: typeof User;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} className="pl-10" {...props} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const storedCode = useStoredTenantCode();
  const storedIdentity = useStoredIdentity();
  const online = useOnline();
  const [retired, setRetired] = useState(false);

  useEffect(() => {
    try {
      if (!window.sessionStorage.getItem(DEVICE_REVOKED_FLAG)) return;
      window.sessionStorage.removeItem(DEVICE_REVOKED_FLAG);
      // The flag only exists in the browser: it can only be read after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetired(true);
    } catch {
      // Storage unavailable: nothing to explain.
    }
  }, []);
  const [tenantCodeInput, setTenantCode] = useState<string | null>(null);
  const tenantCode = tenantCodeInput ?? storedCode;
  const canUnlock = storedIdentity !== null;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);

  async function finish(profile: ServerProfile) {
    const identity = identityFromProfile(profile);
    writeIdentity(identity);
    setPassword('');
    const db = openLocalDb(identity);
    const ready = await isInitialized(db);
    db.close();
    router.push(ready ? '/app' : '/connexion/activation');
  }

  async function proceed(result: LoginResponse) {
    if (result.status === 'signed_in') {
      await finish(result.profile);
      return;
    }
    setPassword('');
    setStep(
      result.status === 'password_change_required'
        ? { kind: 'password', challenge: result.challenge, minLength: result.minLength }
        : {
            kind: result.status === 'mfa_required' ? 'verify' : 'enroll',
            challenge: result.challenge,
          },
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const code = normalizeTenantCode(tenantCode);
    if (!isTenantCode(code) || !username.trim() || !password) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          tenantCode: code,
          username: username.trim().toLowerCase(),
          password,
        }),
      });
      await proceed(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(t(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`));
      } else {
        setError(t('errors.NETWORK'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step?.kind === 'password')
    return (
      <PasswordChangeStep
        challenge={step.challenge}
        minLength={step.minLength}
        onResult={proceed}
      />
    );
  if (step?.kind === 'verify')
    return <MfaVerifyStep challenge={step.challenge} onSignedIn={finish} />;
  if (step?.kind === 'enroll')
    return <MfaEnrollStep challenge={step.challenge} onSignedIn={finish} />;

  return (
    <div>
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t('subtitle')}</p>

      {retired && (
        <p role="alert" className="mt-6 rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {t('deviceRetired')}
        </p>
      )}

      {!online && (
        <div className="mt-6 flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p>{t('offline')}</p>
            {canUnlock && (
              <Link
                href="/app"
                className="mt-2 inline-block font-semibold underline underline-offset-4"
              >
                {t('unlockInstead')}
              </Link>
            )}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
        <Field
          id="tenantCode"
          label={t('tenantCode')}
          icon={Building2}
          hint={t('tenantCodeHint')}
          value={tenantCode}
          onChange={(e) => setTenantCode(e.target.value.toUpperCase())}
          autoComplete="organization"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="HOP-KIN-0042"
          required
        />
        <Field
          id="username"
          label={t('username')}
          icon={User}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <Field
          id="password"
          label={t('password')}
          icon={KeyRound}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={submitting || !online} className="mt-1 w-full">
          {submitting ? <Loader2 className="animate-spin" /> : <LogIn />}
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
