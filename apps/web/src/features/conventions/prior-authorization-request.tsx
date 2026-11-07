'use client';

import { AppError } from '@medhub/shared';
import { Send } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InvoiceLineView } from '@/features/billing/billing-helpers';

/**
 * Asks the payer's prior agreement for an act (docs/modules/conv.md, P4
 * step 3). The request leaves with the next synchronisation, offline
 * included; Direction records the answer online and the line is then
 * evaluated again.
 */
export function PriorAuthorizationRequest({
  line,
  patientId,
  money,
}: {
  line: InvoiceLineView;
  patientId: string;
  money: (amount: number, currency: string) => string;
}) {
  const t = useTranslations('conventions.priorAuthorization');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, identity } = useRuntime();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRequest = (identity?.permissions ?? []).includes('prior_authorization:request');

  const { data: requests } = useLocalQuery(
    async (store) =>
      (await store.readEntitiesByPatient('prior_authorization', patientId))
        .filter(
          (e) =>
            !e.rejected &&
            e.data.contractId === line.contractId &&
            e.data.serviceItemId === line.serviceItemId,
        )
        .sort((a, b) => String(b.data.requestedAt).localeCompare(String(a.data.requestedAt))),
    [patientId, line.contractId, line.serviceItemId],
  );
  const last = requests?.[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!line.contractId || !line.beneficiaryId || line.unitPrice === null) return;
    setBusy(true);
    setError(null);
    void dispatch('prior_authorization.request', {
      patientId,
      contractId: line.contractId,
      beneficiaryId: line.beneficiaryId,
      serviceItemId: line.serviceItemId,
      serviceCode: line.code,
      label: line.label,
      currency: line.currency,
      amountRequested: line.unitPrice * line.quantity,
      reason: reason.trim(),
      requestedAt: new Date().toISOString(),
      status: 'pending',
    })
      .then(() => {
        setOpen(false);
        setReason('');
      })
      .catch((err: unknown) => {
        const code = err instanceof AppError ? err.code : 'UNKNOWN';
        setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
      })
      .finally(() => setBusy(false));
  }

  if (last) {
    const status = String(last.data.status);
    const when = format.dateTime(new Date(String(last.data.requestedAt)), {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    if (status === 'pending') {
      return <span role="status">{t('pending', { date: when })}</span>;
    }
    if (status === 'approved') {
      return (
        <span role="status" className="text-foreground">
          {t('approved', {
            amount: money(Number(last.data.authorizedAmount ?? 0), String(last.data.currency)),
            date: String(last.data.validUntil ?? ''),
          })}
        </span>
      );
    }
    if (status === 'rejected' && !open) {
      return (
        <span role="status" className="flex flex-wrap items-center gap-2">
          {t('rejected', { note: String(last.data.decisionNote ?? '') })}
          {canRequest && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              {t('again')}
            </Button>
          )}
        </span>
      );
    }
  }

  if (!canRequest || !line.contractId || !line.beneficiaryId || line.unitPrice === null) {
    return null;
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Send aria-hidden />
        {t('request')}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label={t('reason')}
        placeholder={t('reason')}
        className="h-8 min-w-48 flex-1"
        minLength={5}
        required
      />
      <Button size="sm" type="submit" disabled={busy || reason.trim().length < 5}>
        {t('send')}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        {t('cancel')}
      </Button>
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </form>
  );
}
