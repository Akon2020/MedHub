'use client';

import { GraduationCap, Loader2, RotateCcw, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStepUp } from '@/features/auth/step-up';

type TrainingView = {
  available: boolean;
  training: {
    code: string;
    createdAt: string;
    status: string;
    users: number;
    patients: number;
  } | null;
  archived: number;
  canManage: boolean;
};

const KNOWN_ERRORS = new Set([
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
  'TRAINING_NOT_ALLOWED',
  'TRAINING_ALREADY_EXISTS',
  'TRAINING_CODE_TAKEN',
]);

/** Online-only screen: the training base of the structure, created and reset on demand. */
export function TrainingSettings() {
  const t = useTranslations('settings.training');
  const ts = useTranslations('settings');
  const format = useFormatter();
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<TrainingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? ts(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : ts('errors.NETWORK'),
    [ts],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch<TrainingView>('/api/v1/training'));
      setError(null);
    } catch (err) {
      setError(describe(err));
    }
  }, [describe]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function build(mode: 'create' | 'reset') {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { code } = await guard(() =>
        apiFetch<{ code: string }>('/api/v1/training', {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }),
      );
      setConfirming(false);
      setNotice(t(mode === 'create' ? 'createdNotice' : 'resetNotice', { code }));
      await refresh();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  if (!online && !view) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{ts('offline')}</p>
      </div>
    );
  }
  if (!view) {
    return error ? (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }

  return (
    <div className="grid gap-4">
      {dialog}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="size-4 text-primary" aria-hidden />
                {t('cardTitle')}
              </CardTitle>
              <CardDescription className="mt-1">{t('cardText')}</CardDescription>
            </div>
            {view.training && <Badge variant="success">{t('active')}</Badge>}
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {!view.available ? (
              <p className="rounded-xl bg-info-soft p-4 text-info">{t('insideTraining')}</p>
            ) : view.training ? (
              <>
                <div className="grid gap-1 rounded-xl bg-accent p-4">
                  <span className="text-xs text-muted-foreground">{t('codeLabel')}</span>
                  <span
                    data-testid="training-code"
                    className="font-mono text-2xl font-semibold tracking-wider"
                  >
                    {view.training.code}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('codeHint')}</span>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('createdAt')}</dt>
                    <dd className="font-medium">
                      {format.dateTime(new Date(view.training.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('content')}</dt>
                    <dd className="font-medium">
                      {t('counts', {
                        users: view.training.users,
                        patients: view.training.patients,
                      })}
                    </dd>
                  </div>
                </dl>
                {view.canManage &&
                  (confirming ? (
                    <div className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
                      <p>{t('resetConfirm')}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy || !online}
                          onClick={() => void build('reset')}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                          {t('resetAction')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      className="justify-self-start"
                      disabled={busy || !online}
                      onClick={() => setConfirming(true)}
                    >
                      <RotateCcw />
                      {t('resetButton')}
                    </Button>
                  ))}
              </>
            ) : (
              <>
                <p>{t('none')}</p>
                {view.canManage && (
                  <Button
                    className="justify-self-start"
                    disabled={busy || !online}
                    onClick={() => void build('create')}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <GraduationCap />}
                    {t('create')}
                  </Button>
                )}
              </>
            )}
            {view.archived > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('archived', { count: view.archived })}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('howTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
              <li>{t('how.copy')}</li>
              <li>{t('how.signIn')}</li>
              <li>{t('how.banner')}</li>
              <li>{t('how.messages')}</li>
              <li>{t('how.reset')}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
