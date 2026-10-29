'use client';

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '@/client/runtime';
import type { SyncState } from '@/client/sync-loop';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STYLE: Record<SyncState, { className: string; icon: typeof CheckCircle2 }> = {
  online: { className: 'bg-success-soft text-success ring-success/20', icon: CheckCircle2 },
  syncing: { className: 'bg-info-soft text-info ring-info/20', icon: RefreshCw },
  offline: { className: 'bg-warning-soft text-warning ring-warning/20', icon: CloudOff },
  attention: { className: 'bg-danger-soft text-danger ring-danger/20', icon: AlertTriangle },
};

/** Permanent sync state (docs/07-ui-ux.md section 3): green, blue, orange or red. */
export function SyncIndicator() {
  const t = useTranslations('sync');
  const format = useFormatter();
  const { status, syncNow } = useRuntime();
  const now = useNow({ updateInterval: 15_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!status) return null;
  const { className, icon: Icon } = STYLE[status.state];
  const label = t(status.state);
  const lastSync = status.lastSyncAt ? format.relativeTime(status.lastSyncAt, now) : t('never');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors',
          className,
        )}
      >
        <Icon className={cn('size-4', status.state === 'syncing' && 'animate-spin')} aria-hidden />
        <span className="hidden sm:inline">{label}</span>
        {status.pending > 0 && (
          <span className="rounded-full bg-white/80 px-1.5 text-[11px] tabular-nums">
            {status.pending}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 top-11 z-50 w-72 rounded-2xl bg-white p-4 text-sm shadow-xl ring-1 ring-border"
        >
          <p className="font-semibold">{label}</p>
          <p className="mt-1 text-muted-foreground">{t('lastSync', { time: lastSync })}</p>
          <ul className="mt-3 grid gap-1.5 text-[13px]">
            <li>{t('pending', { count: status.pending })}</li>
            {status.rejected > 0 && (
              <li className="text-danger">{t('rejected', { count: status.rejected })}</li>
            )}
            {status.conflicts > 0 && (
              <li className="text-danger">{t('conflicts', { count: status.conflicts })}</li>
            )}
            {status.clockSuspect && <li className="text-danger">{t('clock')}</li>}
          </ul>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => syncNow()} className="flex-1">
              <RefreshCw />
              {t('syncNow')}
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <Link href="/app/diagnostic" onClick={() => setOpen(false)}>
                {t('openDiagnostic')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
