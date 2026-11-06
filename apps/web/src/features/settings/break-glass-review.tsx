'use client';

import { Check, Loader2, Siren } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Event = {
  id: string;
  user: string;
  patientMrn: string;
  reasonCode: string;
  reasonText: string;
  startedAt: string;
  endsAt: string;
  reviewedAt: string | null;
  reviewOutcome: string | null;
  reviewComment: string | null;
};

/** Mandatory review of every emergency access (docs/03 section 4), audit:review. */
export function BreakGlassReview() {
  const t = useTranslations('settings.breakGlass');
  const tr = useTranslations('record.breakGlass');
  const format = useFormatter();
  const online = useOnline();
  const { identity } = useRuntime();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = identity?.permissions.includes('audit:review') ?? false;

  const refresh = useCallback(async () => {
    try {
      setEvents((await apiFetch<{ events: Event[] }>('/api/v1/break-glass')).events);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'NETWORK');
    }
  }, []);

  useEffect(() => {
    if (!online || !allowed) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, allowed, refresh]);

  if (!allowed) return null;

  async function review(id: string, outcome: 'justified' | 'to_investigate') {
    setBusy(id);
    try {
      await apiFetch('/api/v1/break-glass/review', {
        method: 'POST',
        body: JSON.stringify({ breakGlassId: id, outcome, comment: comment[id]?.trim() || null }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'NETWORK');
    } finally {
      setBusy(null);
    }
  }

  const pending = (events ?? []).filter((e) => !e.reviewedAt);

  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Siren className="size-4 text-danger" aria-hidden />
            {t('title')}
            {pending.length > 0 && <Badge variant="danger">{pending.length}</Badge>}
          </CardTitle>
          <CardDescription className="mt-1">{t('subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {t('error')}
          </p>
        )}
        {events === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : events.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="grid gap-2 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{e.user}</span>
                  <span className="font-mono text-xs">{e.patientMrn}</span>
                  <Badge variant="warning">{tr(`reasons.${e.reasonCode}`)}</Badge>
                  {e.reviewOutcome && (
                    <Badge variant={e.reviewOutcome === 'justified' ? 'success' : 'danger'}>
                      {t(`outcomes.${e.reviewOutcome}`)}
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground">{e.reasonText}</p>
                <p className="text-xs text-muted-foreground">
                  {t('window', {
                    from: format.dateTime(new Date(e.startedAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                    to: format.dateTime(new Date(e.endsAt), { timeStyle: 'short' }),
                  })}
                  {e.reviewComment ? ` · ${e.reviewComment}` : ''}
                </p>
                {!e.reviewedAt && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('comment')}
                      placeholder={t('comment')}
                      className="max-w-sm"
                      value={comment[e.id] ?? ''}
                      onChange={(ev) => setComment({ ...comment, [e.id]: ev.target.value })}
                    />
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void review(e.id, 'justified')}
                    >
                      <Check />
                      {t('justified')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => void review(e.id, 'to_investigate')}
                    >
                      {t('investigate')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
