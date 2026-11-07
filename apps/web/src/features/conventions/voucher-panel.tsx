'use client';

import { parsePlan } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { FileCheck2, Siren } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { localDay } from '@/features/visits/visit-helpers';

/**
 * Referral vouchers and emergency coverage (docs/modules/conv.md 5): the
 * desk records the signed voucher, or covers an emergency on the service card
 * with a reason (owner decision S11), to regularise within the plan's delay.
 */
export function VoucherPanel({
  patientId,
  contractId,
  beneficiaryId,
  planRules,
  encounterId,
}: {
  patientId: string;
  contractId: string;
  beneficiaryId: string;
  planRules: unknown;
  encounterId: string | null;
}) {
  const t = useTranslations('conventions.coverage');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch } = useRuntime();
  const today = localDay(new Date());
  const [voucher, setVoucher] = useState({
    number: '',
    signatory: '',
    issuedOn: today,
    validUntil: today,
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const grace = parsePlan(planRules)?.voucherGraceHours ?? 72;

  const { data } = useLocalQuery(
    async (store) => ({
      vouchers: (await store.readEntitiesByPatient('referral_voucher', patientId)).filter(
        (e) => !e.rejected && e.data.contractId === contractId,
      ),
      exceptions: (await store.readEntitiesByPatient('coverage_exception', patientId)).filter(
        (e) => !e.rejected && e.data.contractId === contractId,
      ),
    }),
    [patientId, contractId],
  );

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  const open = (data?.exceptions ?? []).filter((e) => e.data.status === 'open');
  const lastVoucher = (data?.vouchers ?? []).sort((a, b) =>
    String(b.data.registeredAt).localeCompare(String(a.data.registeredAt)),
  )[0];

  return (
    <div className="grid gap-3">
      {open.map((e) => {
        const due = Date.parse(String(e.data.dueBy));
        return (
          <div
            key={e.id}
            role="status"
            className={
              due < now
                ? 'rounded-lg bg-danger-soft p-2 text-xs text-danger'
                : 'rounded-lg bg-warning-soft p-2 text-xs text-warning'
            }
          >
            <p className="flex items-center gap-1">
              <Siren className="size-3.5" aria-hidden />
              {t(due < now ? 'overdue' : 'openEmergency', {
                date: format.dateTime(new Date(due), { dateStyle: 'medium', timeStyle: 'short' }),
              })}{' '}
              · {String(e.data.reason)}
            </p>
            {lastVoucher && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    dispatch(
                      'coverage_exception.regularize',
                      { status: 'regularized', voucherId: lastVoucher.id },
                      { entityId: e.id },
                    ),
                  )
                }
              >
                {t('regularize')}
              </Button>
            )}
          </div>
        );
      })}
      {(data?.vouchers ?? []).length > 0 && (
        <ul className="grid gap-1 text-xs">
          {data!.vouchers.map((v) => (
            <li key={v.id} className="flex flex-wrap gap-2">
              <FileCheck2 className="size-3.5 text-success" aria-hidden />
              <span className="font-mono">{String(v.data.number)}</span>
              <span>{String(v.data.signatory)}</span>
              <span className="text-muted-foreground">
                {String(v.data.issuedOn)} → {String(v.data.validUntil)}
              </span>
              {v.version === 0 && <Badge variant="muted">{t('pending')}</Badge>}
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-xl bg-muted/50 p-3">
        <summary className="cursor-pointer font-medium">{t('voucher')}</summary>
        <form
          className="mt-2 grid gap-2 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () => {
              await dispatch('referral_voucher.register', {
                patientId,
                contractId,
                beneficiaryId,
                number: voucher.number.trim(),
                signatory: voucher.signatory.trim(),
                issuedOn: voucher.issuedOn,
                validUntil: voucher.validUntil,
                encounterId,
                registeredAt: new Date().toISOString(),
              });
              setVoucher({ number: '', signatory: '', issuedOn: today, validUntil: today });
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="voucher-number">{t('voucherNumber')}</Label>
            <Input
              id="voucher-number"
              value={voucher.number}
              onChange={(e) => setVoucher({ ...voucher, number: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="voucher-signatory">{t('signatory')}</Label>
            <Input
              id="voucher-signatory"
              value={voucher.signatory}
              onChange={(e) => setVoucher({ ...voucher, signatory: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="voucher-issued">{t('issuedOn')}</Label>
            <Input
              id="voucher-issued"
              type="date"
              value={voucher.issuedOn}
              onChange={(e) => setVoucher({ ...voucher, issuedOn: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="voucher-until">{t('validUntil')}</Label>
            <Input
              id="voucher-until"
              type="date"
              value={voucher.validUntil}
              onChange={(e) => setVoucher({ ...voucher, validUntil: e.target.value })}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="justify-self-start"
            disabled={busy || !voucher.number.trim() || voucher.signatory.trim().length < 2}
          >
            {t('saveVoucher')}
          </Button>
        </form>
      </details>
      <details className="rounded-xl bg-muted/50 p-3">
        <summary className="cursor-pointer font-medium">{t('emergency')}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            aria-label={t('emergencyReason')}
            placeholder={t('emergencyReason')}
            className="min-w-0 flex-1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              void run(async () => {
                const at = new Date();
                await dispatch('coverage.emergency_override', {
                  patientId,
                  contractId,
                  encounterId,
                  reason: reason.trim(),
                  recordedAt: at.toISOString(),
                  dueBy: new Date(at.getTime() + grace * 3_600_000).toISOString(),
                });
                setReason('');
              })
            }
          >
            <Siren />
            {t('saveEmergency')}
          </Button>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
