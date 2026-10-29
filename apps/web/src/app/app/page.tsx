'use client';

import { Activity, ArrowRight, CloudUpload, Gauge, Search, UserPlus, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { initialsOf, toPatientView } from '@/features/patients/patient-helpers';
import { SyncBadge } from '@/features/patients/sync-badge';

const TrendChart = dynamic(() => import('@/features/charts/trend-chart'), { ssr: false });

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const { identity, status } = useRuntime();

  const { data } = useLocalQuery(async (store) => {
    const now = new Date();
    const today = dayKey(now);
    const patients = (await store.readEntities('patient')).map((p) => toPatientView(p, now));
    const vitals = await store.readEntities('vital_sign');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      return d;
    });
    const counts = new Map(days.map((d) => [dayKey(d), 0]));
    for (const p of patients) {
      if (!p.createdAt) continue;
      const key = dayKey(new Date(p.createdAt));
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      total: patients.length,
      today: patients.filter((p) => p.createdAt && dayKey(new Date(p.createdAt)) === today).length,
      vitalsToday: vitals.filter((v) => {
        const at = typeof v.data.measuredAt === 'string' ? new Date(v.data.measuredAt) : null;
        return at !== null && dayKey(at) === today;
      }).length,
      series: days.map((d) => ({
        label: format.dateTime(d, { weekday: 'short' }),
        value: counts.get(dayKey(d)) ?? 0,
      })),
      recent: [...patients]
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, 6),
    };
  }, []);

  const cards = [
    { key: 'patients', value: data?.total, icon: Users },
    { key: 'registeredToday', value: data?.today, icon: UserPlus },
    { key: 'vitalsToday', value: data?.vitalsToday, icon: Activity },
    { key: 'pending', value: status?.pending, icon: CloudUpload },
  ] as const;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          {t('greeting', { name: identity?.displayName ?? '' })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map(({ key, value, icon: Icon }) => (
          <Card key={key} className="p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {t(`cards.${key}`)}
            </p>
            <p className="mt-3 font-display text-3xl font-semibold tabular-nums">{value ?? 0}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('registrations')}</CardTitle>
              <CardDescription className="mt-1">{t('registrationsHint')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {data ? (
              <TrendChart data={data.series} allowDecimals={false} height={260} />
            ) : (
              <div className="h-[260px]" />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('quick')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button asChild className="justify-start">
                <Link href="/app/patients?new=1">
                  <UserPlus />
                  {t('newPatient')}
                </Link>
              </Button>
              <Button asChild variant="secondary" className="justify-start">
                <Link href="/app/patients">
                  <Search />
                  {t('searchPatient')}
                </Link>
              </Button>
              <Button asChild variant="secondary" className="justify-start">
                <Link href="/app/diagnostic">
                  <Gauge />
                  {t('openDiagnostic')}
                </Link>
              </Button>
            </CardContent>
          </Card>
          <div className="rounded-2xl bg-primary p-5 text-sm leading-relaxed text-primary-foreground">
            {t('milestone')}
          </div>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('recent')}</CardTitle>
          <Link
            href="/app/patients"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t('viewAll')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardHeader>
        <CardContent>
          {!data || data.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.recent.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/patients/fiche?id=${p.id}`}
                    className="flex items-center gap-3 rounded-2xl p-3 ring-1 ring-border transition-colors hover:bg-muted/60"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                      {initialsOf(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{p.mrn}</span>
                    </span>
                    <SyncBadge state={p.syncState} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
