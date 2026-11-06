'use client';

import { Loader2, Phone, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

type Row = {
  enrollmentId: string;
  patientId: string;
  mrn: string;
  name: string;
  phone: string | null;
  program: string;
  lastContact: string | null;
  dueAt: string;
  lost: boolean;
  daysLate: number;
};

/** Call list of the programmes: lost to follow-up first, online (docs/modules/dpi.md 6). */
export function FollowUpList() {
  const t = useTranslations('record.followUp');
  const tb = useTranslations('record.breakGlass');
  const format = useFormatter();
  const online = useOnline();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows((await apiFetch<{ rows: Row[] }>('/api/v1/programs/follow-up')).rows);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  if (!online && !rows) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <WifiOff className="size-4" aria-hidden />
        {t('offline')}
      </p>
    );
  }
  if (error) return <p className="text-sm text-danger">{t('error')}</p>;
  if (!rows) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <Card>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.enrollmentId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <Link
                href={`/app/patients/fiche?id=${r.patientId}`}
                className="block font-medium hover:text-primary"
              >
                {r.name || tb('protectedName')}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {r.mrn} · {r.program}
                {r.lastContact
                  ? ` · ${t('last', { date: format.dateTime(new Date(r.lastContact), { dateStyle: 'medium' }) })}`
                  : ''}
              </span>
            </span>
            {r.phone && (
              <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-primary">
                <Phone className="size-3.5" aria-hidden />
                {r.phone}
              </a>
            )}
            {r.lost ? (
              <Badge variant="danger">{t('lost', { days: r.daysLate })}</Badge>
            ) : (
              <Badge variant="muted">
                {t('due', { date: format.dateTime(new Date(r.dueAt), { dateStyle: 'medium' }) })}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
