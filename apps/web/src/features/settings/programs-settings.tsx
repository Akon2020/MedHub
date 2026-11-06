'use client';

import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStepUp } from '@/features/auth/step-up';

type Program = {
  id: string;
  code: string;
  name: string;
  followUpIntervalDays: number;
  graceDays: number;
  isActive: boolean;
};

const EMPTY = {
  id: null as string | null,
  code: '',
  name: '',
  interval: '30',
  grace: '14',
  isActive: true,
};

/** Chronic care programmes of the structure and their follow-up rhythm. */
export function ProgramsSettings() {
  const t = useTranslations('settings.programs');
  const ts = useTranslations('settings');
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<{ programs: Program[]; canEdit: boolean } | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch('/api/v1/programs'));
    } catch {
      setError(ts('errors.UNKNOWN'));
    }
  }, [ts]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await guard(() =>
        apiFetch('/api/v1/programs', {
          method: 'POST',
          body: JSON.stringify({
            id: draft.id,
            code: draft.code,
            name: draft.name,
            followUpIntervalDays: Number(draft.interval),
            graceDays: Number(draft.grace),
            isActive: draft.isActive,
          }),
        }),
      );
      setDraft(EMPTY);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'RDV_CODE_TAKEN'
          ? ts('errors.RDV_CODE_TAKEN')
          : ts('errors.VALIDATION_FAILED'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;

  return (
    <Card className="mt-6">
      {dialog}
      <CardHeader>
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="mt-1">{t('subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {view.programs.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        <ul className="divide-y divide-border">
          {view.programs.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.code} · {t('rhythm', { interval: p.followUpIntervalDays, grace: p.graceDays })}
                </span>
              </span>
              {!p.isActive && <Badge variant="muted">{t('inactive')}</Badge>}
              {view.canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      code: p.code,
                      name: p.name,
                      interval: String(p.followUpIntervalDays),
                      grace: String(p.graceDays),
                      isActive: p.isActive,
                    })
                  }
                >
                  {t('edit')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {view.canEdit && (
          <form onSubmit={submit} className="grid gap-3 rounded-xl bg-muted/50 p-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="program-name">{t('name')}</Label>
                <Input
                  id="program-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="program-code">{t('code')}</Label>
                <Input
                  id="program-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="program-interval">{t('interval')}</Label>
                <Input
                  id="program-interval"
                  inputMode="numeric"
                  value={draft.interval}
                  onChange={(e) =>
                    setDraft({ ...draft, interval: e.target.value.replace(/\D/g, '') })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="program-grace">{t('grace')}</Label>
                <Input
                  id="program-grace"
                  inputMode="numeric"
                  value={draft.grace}
                  onChange={(e) => setDraft({ ...draft, grace: e.target.value.replace(/\D/g, '') })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              {t('active')}
            </label>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || draft.name.trim().length < 2}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t('save')}
              </Button>
              {draft.id && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(EMPTY)}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
