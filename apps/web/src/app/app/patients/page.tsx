'use client';

import { ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useDeferredValue, useState } from 'react';
import { useLocalQuery } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { initialsOf, toPatientView } from '@/features/patients/patient-helpers';
import { RegisterForm } from '@/features/patients/register-form';
import { SyncBadge } from '@/features/patients/sync-badge';
import { PageHeader } from '@/features/shell/page-header';

function PatientsScreen() {
  const t = useTranslations('patients');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [showForm, setShowForm] = useState(params.get('new') === '1');
  const deferred = useDeferredValue(query.trim());

  const paramQuery = params.get('q') ?? '';
  const [lastParam, setLastParam] = useState(paramQuery);
  if (paramQuery !== lastParam) {
    setLastParam(paramQuery);
    setQuery(paramQuery);
  }

  const { data, loading } = useLocalQuery(
    async (store) => {
      const entities = deferred
        ? await store.searchPatients(deferred, 50)
        : await store.readEntities('patient');
      const views = entities.map((e) => toPatientView(e));
      if (!deferred) views.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      return views.slice(0, 100);
    },
    [deferred],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          !showForm && (
            <Button onClick={() => setShowForm(true)}>
              <UserPlus />
              {t('new')}
            </Button>
          )
        }
      />

      {showForm && (
        <div className="mb-6">
          <RegisterForm
            onCancel={() => setShowForm(false)}
            onDone={(id) => router.push(`/app/patients/fiche?id=${id}`)}
          />
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="h-10 w-full rounded-full border border-border bg-muted/50 pl-10 pr-4 text-sm outline-none focus:border-ring focus:bg-white focus:ring-[3px] focus:ring-ring/20"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('results', { count: data?.length ?? 0 })}
          </p>
        </div>

        {loading && !data ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{tc('loading')}</p>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent text-primary">
              <Users className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium">{t('empty')}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('columns.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.mrn')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.sex')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.age')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.phone')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-border transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/patients/fiche?id=${p.id}`}
                        className="flex items-center gap-3"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                          {initialsOf(p.name)}
                        </span>
                        <span className="font-medium hover:text-primary">{p.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-ink">{p.mrn}</td>
                    <td className="px-4 py-3">{t(`sex.${p.sex}`)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {p.age !== null ? tc('years', { count: p.age }) : ''}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-ink">{p.phone ?? ''}</td>
                    <td className="px-4 py-3">
                      <SyncBadge state={p.syncState} />
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PatientsPage() {
  return (
    <Suspense>
      <PatientsScreen />
    </Suspense>
  );
}
