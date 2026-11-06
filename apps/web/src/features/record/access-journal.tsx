'use client';

import { Eye, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Entry = {
  at: string;
  user: string;
  device: string | null;
  screen: string;
  emergency: boolean;
};

/** Who opened this record, read online on demand (audit:read). */
export function AccessJournal({ patientId }: { patientId: string }) {
  const t = useTranslations('record.access');
  const format = useFormatter();
  const online = useOnline();
  const { identity } = useRuntime();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!identity?.permissions.includes('audit:read')) return null;

  async function load() {
    setBusy(true);
    setError(false);
    try {
      setEntries(
        (await apiFetch<{ entries: Entry[] }>(`/api/v1/patients/access?id=${patientId}`)).entries,
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        {entries === null && (
          <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void load()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('show')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {t('error')}
          </p>
        )}
        {entries === null ? (
          <p className="text-muted-foreground">{online ? t('hint') : t('offline')}</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 font-medium">{e.user}</span>
                {e.emergency && <Badge variant="danger">{t('emergency')}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' })}
                  {e.device ? ` · ${t('device', { code: e.device })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
