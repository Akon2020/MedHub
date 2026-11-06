'use client';

import { patientFullName } from '@medhub/domain';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLocalQuery } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/features/shell/page-header';
import { localDay } from '@/features/visits/visit-helpers';

const OPEN = new Set(['arrived', 'triaged', 'in_consultation', 'waiting_results']);

/** Today's open visits known to this workstation, the entry point of the consultation. */
export function ConsultationQueue({ title }: { title: string }) {
  const t = useTranslations('consultation');
  const { data } = useLocalQuery(async (store) => {
    const today = localDay(new Date());
    const visits = (await store.readEntities('encounter')).filter(
      (e) =>
        !e.rejected &&
        typeof e.data.startedAt === 'string' &&
        localDay(new Date(e.data.startedAt)) === today &&
        OPEN.has(String(e.data.status)),
    );
    const rows = await Promise.all(
      visits.map(async (v) => {
        const patient = await store.readEntity('patient', String(v.data.patientId));
        const d = patient?.data ?? {};
        return {
          id: v.id,
          patientId: String(v.data.patientId),
          startedAt: String(v.data.startedAt),
          status: String(v.data.status),
          mrn: String(d.mrn ?? ''),
          name: patient
            ? patientFullName({
                familyName: String(d.familyName ?? ''),
                middleName: typeof d.middleName === 'string' ? d.middleName : null,
                givenName: typeof d.givenName === 'string' ? d.givenName : null,
              })
            : '',
        };
      }),
    );
    return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={title} subtitle={t('queueSubtitle')} />
      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('queueEmpty')}</p>
      )}
      <ul className="grid gap-2">
        {(data ?? []).map((r) => (
          <li key={r.id}>
            <Link
              href={`/app/consultation?patient=${r.patientId}`}
              className="card-surface flex items-center gap-3 p-4 hover:ring-primary"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name || r.mrn}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.mrn}</span>
              </span>
              <Badge variant={r.status === 'in_consultation' ? 'info' : 'muted'}>
                {t(`status.${r.status}`)}
              </Badge>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
