'use client';

import { HardDrive, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/client/activation';
import { useOnline } from '@/client/browser-state';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/features/shell/page-header';

export default function DiagnosticPage() {
  const t = useTranslations('diagnostic');
  const ts = useTranslations('sync');
  const format = useFormatter();
  const { status, device, identity, syncNow } = useRuntime();
  const online = useOnline();
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then((e) => setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => setStorage(null));
  }, []);

  const { data } = useLocalQuery(async (store) => {
    const [state, rejected] = await Promise.all([store.readState(), store.rejectedItems()]);
    return { state, rejected };
  }, []);

  const when = (ms: number | null | undefined) =>
    ms ? format.dateTime(new Date(ms), { dateStyle: 'medium', timeStyle: 'medium' }) : ts('never');

  const rows = [
    {
      label: t('device'),
      value: device ? `${identity?.tenantCode ?? ''} · ${device.deviceCode}` : '',
    },
    { label: t('pending'), value: String(status?.pending ?? 0) },
    { label: t('rejected'), value: String(status?.rejected ?? 0) },
    { label: t('conflicts'), value: String(status?.conflicts ?? 0) },
    { label: t('lastSync'), value: when(data?.state.lastSyncAt) },
    { label: t('lastServer'), value: when(data?.state.lastServerTime) },
    { label: t('version'), value: APP_VERSION },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button onClick={() => syncNow()}>
            <RefreshCw />
            {t('forceSync')}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="pt-5">
            <dl className="divide-y divide-border">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 py-3 text-sm"
                >
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="text-right font-medium tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card className="flex items-center gap-4 p-5">
            <span
              className={`grid size-11 place-items-center rounded-xl ${online ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
            >
              {online ? (
                <Wifi className="size-5" aria-hidden />
              ) : (
                <WifiOff className="size-5" aria-hidden />
              )}
            </span>
            <div>
              <p className="text-sm text-muted-foreground">{t('network')}</p>
              <p className="font-semibold">{online ? t('online') : t('offline')}</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4 p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-primary">
              <HardDrive className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">{t('storage')}</p>
              <p className="font-semibold">
                {storage && storage.quota > 0
                  ? `${format.number(storage.usage / 1_048_576, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 })} / ${format.number(storage.quota / 1_048_576, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 })}`
                  : t('storageUnknown')}
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('rejectedTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.rejected.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t('rejectedEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.rejected.map((item) => (
                <li
                  key={item.opId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="font-mono text-xs">{item.op.command}</span>
                  <span className="text-danger">
                    {t('reason')} : {item.lastError ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
