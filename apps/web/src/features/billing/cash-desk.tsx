'use client';

import { patientFullName } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { ArrowLeft, ChevronRight, FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/features/shell/page-header';
import { localDay } from '@/features/visits/visit-helpers';
import { toInvoiceView, toLineView, totalsOf } from './billing-helpers';
import { InvoiceCard, useMoney } from './invoice-card';
import { openInvoice } from './visit-billing';

const nameOf = (d: Record<string, unknown>) =>
  patientFullName({
    familyName: String(d.familyName ?? ''),
    middleName: typeof d.middleName === 'string' ? d.middleName : null,
    givenName: typeof d.givenName === 'string' ? d.givenName : null,
  });

/** Cash desk home: the invoices of the day on this workstation, open ones first. */
export function CashDeskHome() {
  const t = useTranslations('billing');
  const money = useMoney();
  const [filter, setFilter] = useState('');
  const { data } = useLocalQuery(async (store) => {
    const today = localDay(new Date());
    const invoices = (await store.readEntities('invoice'))
      .filter((e) => !e.rejected)
      .map(toInvoiceView)
      .filter((i) => i.status === 'open' || localDay(new Date(i.openedAt)) === today);
    const lines = (await store.readEntities('invoice_line'))
      .filter((e) => !e.rejected)
      .map(toLineView);
    return Promise.all(
      invoices.map(async (inv) => {
        const patient = await store.readEntity('patient', inv.patientId);
        return {
          invoice: inv,
          name: patient ? nameOf(patient.data) : '',
          mrn: String(patient?.data.mrn ?? ''),
          totals: totalsOf(lines.filter((l) => l.invoiceId === inv.id)),
        };
      }),
    );
  }, []);
  const rows = (data ?? [])
    .filter(
      (r) =>
        !filter.trim() ||
        `${r.name} ${r.mrn} ${r.invoice.number}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
    )
    .sort((a, b) =>
      a.invoice.status === b.invoice.status
        ? b.invoice.openedAt.localeCompare(a.invoice.openedAt)
        : a.invoice.status === 'open'
          ? -1
          : 1,
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Input
        aria-label={t('filter')}
        placeholder={t('filter')}
        className="mb-4 max-w-md"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {data && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.invoice.id}>
            <Link
              href={`/app/caisse?patient=${r.invoice.patientId}`}
              className="card-surface flex items-center gap-3 p-4 hover:ring-primary"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name || r.mrn}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.invoice.number}</span>
              </span>
              {r.totals.missingPrices > 0 && (
                <Badge variant="warning">{t('invoice.noPrice')}</Badge>
              )}
              <span className="font-mono text-sm">{money(r.totals.gross, r.invoice.currency)}</span>
              <Badge variant={r.invoice.status === 'open' ? 'info' : 'muted'}>
                {t(`invoice.status.${r.invoice.status}`)}
              </Badge>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** All invoices of one patient at the cash desk, the most recent first. */
export function PatientBilling({ patientId }: { patientId: string }) {
  const t = useTranslations('billing');
  const tErr = useTranslations('errors');
  const { dispatch, nextCounter, catalogs, identity, device } = useRuntime();
  const [error, setError] = useState<string | null>(null);
  const { data } = useLocalQuery(
    async (store) => {
      const patient = await store.readEntity('patient', patientId);
      const invoices = (await store.readEntitiesByPatient('invoice', patientId))
        .filter((e) => !e.rejected)
        .map(toInvoiceView)
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
      const lines = (await store.readEntitiesByPatient('invoice_line', patientId))
        .filter((e) => !e.rejected)
        .map(toLineView);
      return { patient, invoices, lines };
    },
    [patientId],
  );
  const perms = identity?.permissions ?? [];
  const finance = catalogs?.snapshot.finance;
  const currency =
    finance?.priceLists.find((l) => l.kind === 'public' && l.isActive)?.currency ?? 'USD';

  async function newInvoice() {
    setError(null);
    try {
      await openInvoice(
        {
          dispatch,
          nextCounter,
          finance,
          siteCode: identity?.siteCode ?? 'SIT',
          deviceCode: device?.deviceCode ?? 'XX',
          permissions: perms,
        },
        { patientId, encounterId: null, currency },
      );
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    }
  }

  if (!data) return null;
  if (!data.patient) return <p className="text-sm text-muted-foreground">{t('notOnDevice')}</p>;
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/caisse"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{nameOf(data.patient.data)}</h1>
        <span className="font-mono text-xs text-slate-ink">
          {String(data.patient.data.mrn ?? '')}
        </span>
        {perms.includes('invoice:create') && (
          <Button size="sm" variant="secondary" onClick={() => void newInvoice()}>
            <FilePlus2 />
            {t('newInvoice')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      {data.invoices.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('noInvoice')}</p>
      )}
      <div className="grid gap-4">
        {data.invoices.map((inv) => (
          <InvoiceCard
            key={inv.id}
            invoice={inv}
            lines={data.lines.filter((l) => l.invoiceId === inv.id)}
          />
        ))}
      </div>
    </div>
  );
}
