'use client';

import { History, Loader2, RotateCcw, Send, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStepUp } from '@/features/auth/step-up';

type Version = {
  version: number;
  status: 'draft' | 'published' | 'archived';
  value: number;
  note: string | null;
  createdAt: string;
  publishedAt: string | null;
};

type Item = {
  key: string;
  unit: string;
  default: number;
  published: Version | null;
  draft: Version | null;
  history: Version[];
};

type Configuration = { items: Item[]; canEdit: boolean; canPublish: boolean };

const KNOWN_ERRORS = new Set([
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
]);

function ConfigCard({
  item,
  canEdit,
  canPublish,
  run,
}: {
  item: Item;
  canEdit: boolean;
  canPublish: boolean;
  run: (path: string, body: unknown) => Promise<void>;
}) {
  const t = useTranslations('settings.configuration');
  const format = useFormatter();
  const online = useOnline();
  const current = item.published?.value ?? item.default;
  const [value, setValue] = useState(String(item.draft?.value ?? current));
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = item.key.replace('security.', '');

  async function act(path: string, body: unknown) {
    setBusy(true);
    try {
      await run(path, body);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void act('/api/v1/config/draft', { key: item.key, value: Number(value) });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t(`keys.${key}.title`)}</CardTitle>
          <CardDescription className="mt-1">{t(`keys.${key}.text`)}</CardDescription>
        </div>
        <div className="grid justify-items-end gap-1">
          <Badge variant={item.published ? 'success' : 'muted'}>
            {item.published
              ? t('publishedVersion', { version: item.published.version })
              : t('defaultValue')}
          </Badge>
          {item.draft && <Badge variant="warning">{t('draftPending')}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p>
          {t('current')} :{' '}
          <span className="font-semibold">
            {current} {t(`units.${item.unit}`)}
          </span>
          {!item.published && ` (${t('defaultHint')})`}
        </p>
        {canEdit && (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="grid gap-2">
              <Label htmlFor={`config-${key}`}>{t('newValue')}</Label>
              <Input
                id={`config-${key}`}
                type="number"
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-32"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy || !online}>
              {t('saveDraft')}
            </Button>
            {item.draft && canPublish && (
              <Button
                type="button"
                disabled={busy || !online}
                onClick={() => void act('/api/v1/config/publish', { key: item.key })}
              >
                <Send />
                {t('publish', { value: item.draft.value })}
              </Button>
            )}
            {item.draft && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !online}
                onClick={() => void act('/api/v1/config/discard', { key: item.key })}
              >
                {t('discard')}
              </Button>
            )}
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </form>
        )}
        {item.history.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
            >
              <History className="size-4" aria-hidden />
              {t('history', { count: item.history.length })}
            </button>
            {showHistory && (
              <ul className="mt-2 divide-y divide-border rounded-xl ring-1 ring-border">
                {item.history.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">v{v.version}</span>
                    <span className="font-medium">
                      {v.value} {t(`units.${item.unit}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {v.publishedAt
                        ? format.dateTime(new Date(v.publishedAt), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : ''}
                    </span>
                    <Badge variant={v.status === 'published' ? 'success' : 'muted'}>
                      {t(`status.${v.status}`)}
                    </Badge>
                    {canEdit && v.status === 'archived' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={busy || !online}
                        onClick={() =>
                          void act('/api/v1/config/restore', { key: item.key, version: v.version })
                        }
                      >
                        <RotateCcw />
                        {t('restore')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Online-only screen: device security settings, with draft, publication and history. */
export function ConfigurationSettings() {
  const t = useTranslations('settings');
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [error, setError] = useState<string | null>(null);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? t(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : t('errors.NETWORK'),
    [t],
  );

  const refresh = useCallback(async () => {
    try {
      setConfig(await apiFetch<Configuration>('/api/v1/config'));
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

  const run = async (path: string, body: unknown) => {
    try {
      await guard(() => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }));
      await refresh();
    } catch (err) {
      setError(describe(err));
    }
  };

  if (!online && !config) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!config) {
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
      <p className="text-sm text-muted-foreground">{t('configuration.lifecycle')}</p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {config.items.map((item) => (
          <ConfigCard
            key={`${item.key}-${item.draft?.version ?? 0}-${item.published?.version ?? 0}`}
            item={item}
            canEdit={config.canEdit}
            canPublish={config.canPublish}
            run={run}
          />
        ))}
      </div>
    </div>
  );
}
