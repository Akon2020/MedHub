'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import type { ServerProfile } from '@/client/identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PASSWORD_ERRORS = new Set([
  'AUTH_PASSWORD_WEAK',
  'AUTH_PASSWORD_REUSED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_MFA_CHALLENGE_EXPIRED',
  'AUTH_TENANT_SUSPENDED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
]);

const PROBLEMS = ['too_short', 'too_long', 'common', 'contains_identity'] as const;

export type AfterPassword =
  | { status: 'signed_in'; profile: ServerProfile }
  | { status: 'mfa_required' | 'mfa_enrollment_required'; challenge: string };

/** Translates a refused password, with every reason given by the server. */
export function usePasswordErrorMessage() {
  const t = useTranslations('auth');
  return (error: unknown, minLength: number): string => {
    if (!(error instanceof ApiError)) return t('errors.NETWORK');
    if (error.code === 'AUTH_PASSWORD_WEAK') {
      const listed = Array.isArray(error.details.problems) ? error.details.problems : [];
      const min = typeof error.details.minLength === 'number' ? error.details.minLength : minLength;
      const reasons = PROBLEMS.filter((p) => listed.includes(p)).map((p) =>
        t(`passwordProblems.${p}`, { min }),
      );
      return [t('errors.AUTH_PASSWORD_WEAK'), ...reasons].join(' ');
    }
    return t(`errors.${PASSWORD_ERRORS.has(error.code) ? error.code : 'UNKNOWN'}`);
  };
}

/** New password typed twice; the policy is checked by the server. */
export function NewPasswordFields({
  idPrefix,
  minLength,
  password,
  confirmation,
  onPassword,
  onConfirmation,
}: {
  idPrefix: string;
  minLength: number;
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
}) {
  const t = useTranslations('auth.passwordChange');
  const mismatch = confirmation.length > 0 && confirmation !== password;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-new`}>{t('newPassword')}</Label>
        <Input
          id={`${idPrefix}-new`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          aria-describedby={`${idPrefix}-hint`}
          required
        />
        <p id={`${idPrefix}-hint`} className="text-xs text-muted-foreground">
          {t('hint', { min: minLength })}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-confirm`}>{t('confirm')}</Label>
        <Input
          id={`${idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => onConfirmation(e.target.value)}
          aria-invalid={mismatch}
          required
        />
        {mismatch && <p className="text-xs text-danger">{t('mismatch')}</p>}
      </div>
    </>
  );
}

/** Sign-in step after a temporary password: the user chooses their own. */
export function PasswordChangeStep({
  challenge,
  minLength,
  onResult,
}: {
  challenge: string;
  minLength: number;
  onResult: (result: AfterPassword) => Promise<void>;
}) {
  const t = useTranslations('auth.passwordChange');
  const describe = usePasswordErrorMessage();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<AfterPassword>('/api/v1/auth/password', {
        method: 'POST',
        body: JSON.stringify({ challenge, password }),
      });
      setPassword('');
      setConfirmation('');
      await onResult(result);
    } catch (err) {
      setError(describe(err, minLength));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="inline-grid size-12 place-items-center rounded-2xl bg-accent text-primary">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t('subtitle')}</p>
      <form onSubmit={submit} className="mt-8 grid gap-5" noValidate>
        <NewPasswordFields
          idPrefix="initial-password"
          minLength={minLength}
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || password.length === 0 || password !== confirmation}
        >
          {busy && <Loader2 className="animate-spin" />}
          {busy ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
