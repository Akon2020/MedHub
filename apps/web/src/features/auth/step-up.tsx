'use client';

import { Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMfaErrorMessage } from './mfa-step';

type Pending = { resolve: () => void; reject: (error: unknown) => void };

/**
 * Sensitive changes need a recent proof of the second factor. `guard(task)` runs
 * the task; when the server answers AUTH_STEP_UP_REQUIRED, it asks for a code,
 * proves it (the server rotates the session) and runs the task once more.
 */
export function useStepUp(): {
  guard: <T>(task: () => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);

  const guard = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'AUTH_STEP_UP_REQUIRED') throw error;
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      });
      return task();
    }
  }, []);

  const close = (outcome: 'done' | 'cancelled') => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    if (outcome === 'done') current?.resolve();
    else current?.reject(new ApiError('AUTH_STEP_UP_REQUIRED', 403));
  };

  return { guard, dialog: open ? <StepUpDialog onClose={close} /> : null };
}

function StepUpDialog({ onClose }: { onClose: (outcome: 'done' | 'cancelled') => void }) {
  const t = useTranslations('stepUp');
  const describe = useMfaErrorMessage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notEnrolled, setNotEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/auth/step-up', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      onClose('done');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_MFA_NOT_ENROLLED') setNotEnrolled(true);
      else setError(describe(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-[2px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose('cancelled');
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl ring-1 ring-border">
        <span className="inline-grid size-11 place-items-center rounded-xl bg-accent text-primary">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <h2 id="step-up-title" className="mt-4 text-lg font-semibold">
          {t('title')}
        </h2>
        {notEnrolled ? (
          <div className="mt-2 grid gap-4 text-sm text-muted-foreground">
            <p>{t('notEnrolled')}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/app/compte">{t('openAccount')}</Link>
              </Button>
              <Button variant="ghost" onClick={() => onClose('cancelled')}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-2 grid gap-4" noValidate>
            <p className="text-sm text-muted-foreground">{t('text')}</p>
            <div className="grid gap-2">
              <Label htmlFor="step-up-code">{t('code')}</Label>
              <Input
                id="step-up-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                className="text-center font-mono text-lg tracking-[0.3em]"
                autoFocus
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || code.trim().length < 6}>
                {busy && <Loader2 className="animate-spin" />}
                {t('confirm')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => onClose('cancelled')}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
