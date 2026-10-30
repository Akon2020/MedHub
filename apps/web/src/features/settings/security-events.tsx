'use client';

import { AlertTriangle, Info, Loader2, ShieldAlert, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export type SecurityEvent = {
  id: string;
  at: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  user: string | null;
  ip: string | null;
  detail: { anomalies?: string[]; device?: string; rule?: string; minutes?: number };
};

const KNOWN_KINDS = new Set([
  'sign_in_anomaly',
  'rate_limited',
  'ip_auto_blocked',
  'ip_refused',
  'mfa_enabled',
  'mfa_disabled',
]);

const ICONS = { info: Info, warning: AlertTriangle, critical: ShieldAlert } as const;
const BADGES = { info: 'info', warning: 'warning', critical: 'danger' } as const;

/** Online-only review of the structure's security events (docs/03 section 6). */
export function SecurityEvents() {
  const t = useTranslations('settings.security');
  const format = useFormatter();
  const online = useOnline();
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEvents((await apiFetch<{ events: SecurityEvent[] }>('/api/v1/security/events')).events);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PERMISSION_DENIED' ? t('denied') : t('loadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  if (!online && !events) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!events) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <Card>
      <CardContent className="pt-5">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => {
              const Icon = ICONS[event.severity];
              const kind = KNOWN_KINDS.has(event.kind) ? event.kind : 'other';
              const details = [
                ...(event.detail.anomalies ?? []).map((a) => t(`anomalies.${a}`)),
                event.detail.device,
                event.ip,
              ].filter(Boolean);
              return (
                <li key={event.id} className="flex items-start gap-3 py-3 text-sm">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t(`kinds.${kind}`)}
                      {event.user ? ` · ${event.user}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
                  </div>
                  <div className="grid justify-items-end gap-1">
                    <Badge variant={BADGES[event.severity]}>
                      {t(`severity.${event.severity}`)}
                    </Badge>
                    <time className="text-xs text-muted-foreground" dateTime={event.at}>
                      {format.dateTime(new Date(event.at), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
