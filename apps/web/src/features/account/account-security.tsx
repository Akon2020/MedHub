'use client';

import { Laptop, Loader2, LogOut, Palette, ShieldCheck, ShieldOff, WifiOff } from 'lucide-react';
import { deviceLabel } from '@medhub/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  EnrollmentForm,
  RecoveryCodesPanel,
  useMfaErrorMessage,
  type EnrollmentMaterial,
} from '@/features/auth/mfa-step';

type Overview = {
  mfa: {
    enabled: boolean;
    enabledAt: string | null;
    requiredByRole: boolean;
    recoveryCodesLeft: number;
  };
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    userAgent: string | null;
    ip: string | null;
    deviceId: string | null;
  }[];
};

type Mode =
  | { kind: 'idle' }
  | { kind: 'enroll'; material: EnrollmentMaterial }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'confirm'; action: 'regenerate' | 'disable' };

/** Online-only screen (docs/07-ui-ux.md section on the two families of screens). */
export function AccountSecurity() {
  const t = useTranslations('account');
  const format = useFormatter();
  const online = useOnline();
  const describe = useMfaErrorMessage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>('/api/v1/account/security'));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [describe]);

  useEffect(() => {
    if (!online) return;
    // Fetching on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  const startEnrollment = () =>
    run(async () => {
      const material = await apiFetch<EnrollmentMaterial>('/api/v1/account/mfa/setup', {
        method: 'POST',
      });
      setMode({ kind: 'enroll', material });
    });

  async function confirmEnrollment(value: string) {
    const { recoveryCodes } = await apiFetch<{ recoveryCodes: string[] }>(
      '/api/v1/account/mfa/confirm',
      { method: 'POST', body: JSON.stringify({ code: value }) },
    );
    setMode({ kind: 'codes', codes: recoveryCodes });
    await refresh();
  }

  function submitConfirmation(event: FormEvent) {
    event.preventDefault();
    if (mode.kind !== 'confirm') return;
    const action = mode.action;
    void run(async () => {
      if (action === 'regenerate') {
        const { recoveryCodes } = await apiFetch<{ recoveryCodes: string[] }>(
          '/api/v1/account/mfa/recovery-codes',
          { method: 'POST', body: JSON.stringify({ code: code.trim() }) },
        );
        setMode({ kind: 'codes', codes: recoveryCodes });
      } else {
        await apiFetch('/api/v1/account/mfa/disable', {
          method: 'POST',
          body: JSON.stringify({ code: code.trim() }),
        });
        setMode({ kind: 'idle' });
      }
      setCode('');
      await refresh();
    });
  }

  const revoke = (target: { sessionId: string } | { others: true }) =>
    run(async () => {
      await apiFetch('/api/v1/account/sessions/revoke', {
        method: 'POST',
        body: JSON.stringify(target),
      });
      await refresh();
    });

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="grid content-start gap-6">
        {!online && (
          <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t('offline')}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('mfa.title')}</CardTitle>
              <CardDescription className="mt-1">{t('mfa.text')}</CardDescription>
            </div>
            {overview && (
              <Badge variant={overview.mfa.enabled ? 'success' : 'warning'}>
                {overview.mfa.enabled ? t('mfa.on') : t('mfa.off')}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            {!overview && online && (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
            {overview && mode.kind === 'idle' && (
              <>
                {overview.mfa.enabled ? (
                  <p className="text-sm text-muted-foreground">
                    {t('mfa.since', { date: when(overview.mfa.enabledAt ?? '') })}
                    {' · '}
                    {t('mfa.codesLeft', { count: overview.mfa.recoveryCodesLeft })}
                  </p>
                ) : (
                  overview.mfa.requiredByRole && (
                    <p className="text-sm text-warning">{t('mfa.requiredByRole')}</p>
                  )
                )}
                <div className="flex flex-wrap gap-2">
                  {!overview.mfa.enabled && (
                    <Button disabled={busy || !online} onClick={startEnrollment}>
                      <ShieldCheck />
                      {t('mfa.enable')}
                    </Button>
                  )}
                  {overview.mfa.enabled && (
                    <Button
                      variant="secondary"
                      disabled={busy || !online}
                      onClick={() => setMode({ kind: 'confirm', action: 'regenerate' })}
                    >
                      {t('mfa.regenerate')}
                    </Button>
                  )}
                  {overview.mfa.enabled && !overview.mfa.requiredByRole && (
                    <Button
                      variant="ghost"
                      className="text-danger"
                      disabled={busy || !online}
                      onClick={() => setMode({ kind: 'confirm', action: 'disable' })}
                    >
                      <ShieldOff />
                      {t('mfa.disable')}
                    </Button>
                  )}
                </div>
              </>
            )}
            {mode.kind === 'enroll' && (
              <EnrollmentForm material={mode.material} onConfirm={confirmEnrollment} />
            )}
            {mode.kind === 'codes' && (
              <RecoveryCodesPanel
                codes={mode.codes}
                doneLabel={t('done')}
                onDone={() => setMode({ kind: 'idle' })}
              />
            )}
            {mode.kind === 'confirm' && (
              <form onSubmit={submitConfirmation} className="grid gap-4" noValidate>
                <p className="text-sm text-muted-foreground">
                  {mode.action === 'regenerate'
                    ? t('mfa.confirmRegenerate')
                    : t('mfa.confirmDisable')}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="account-mfa-code">{t('mfa.codeLabel')}</Label>
                  <Input
                    id="account-mfa-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                    className="font-mono tracking-widest"
                    autoFocus
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant={mode.action === 'disable' ? 'destructive' : 'default'}
                    disabled={busy || code.trim().length < 6}
                  >
                    {busy && <Loader2 className="animate-spin" />}
                    {mode.action === 'regenerate' ? t('mfa.regenerate') : t('mfa.disable')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setMode({ kind: 'idle' });
                      setCode('');
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('sessions.title')}</CardTitle>
              <CardDescription className="mt-1">{t('sessions.text')}</CardDescription>
            </div>
            {overview && overview.sessions.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !online}
                onClick={() => revoke({ others: true })}
              >
                <LogOut />
                {t('sessions.revokeOthers')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {overview?.sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Laptop className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {deviceLabel(s.userAgent) || t('sessions.unknownBrowser')}
                      {s.current && (
                        <Badge variant="info" className="ml-2 align-middle">
                          {t('sessions.current')}
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t('sessions.lastSeen', { date: when(s.lastSeenAt) })}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !online}
                      onClick={() => revoke({ sessionId: s.id })}
                    >
                      {t('sessions.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="content-start">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-primary" aria-hidden />
              {t('appearance.title')}
            </CardTitle>
            <CardDescription className="mt-1">{t('appearance.text')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('appearance.theme')}</span>
            <ThemeSwitcher />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('appearance.language')}</span>
            <LocaleSwitcher />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
