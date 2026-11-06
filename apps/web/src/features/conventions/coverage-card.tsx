'use client';

import { searchBeneficiaries } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import { Link2, Loader2, ShieldCheck, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** Active coverage of a patient: link, contract, plan and member, from the local copy. */
export function useCoverage(patientId: string) {
  const { catalogs } = useRuntime();
  const conventions = catalogs?.snapshot.conventions;
  const { data } = useLocalQuery(
    async (store) =>
      (await store.readEntitiesByPatient('patient_coverage', patientId)).filter(
        (e) => !e.rejected && e.data.status === 'active',
      ),
    [patientId],
  );
  const link = data?.[0] ?? null;
  const member = link
    ? (conventions?.beneficiaries.find((b) => b.id === link.data.beneficiaryId) ?? null)
    : null;
  const contract = link
    ? (conventions?.contracts.find((c) => c.id === link.data.contractId) ?? null)
    : null;
  const plan =
    member && contract
      ? (conventions?.plans.find(
          (p) => p.contractId === contract.id && p.code === member.planCode,
        ) ?? null)
      : null;
  return { link, member, contract, plan };
}

/**
 * Coverage card of the record (docs/modules/conv.md): the desk links the
 * patient to a beneficiary of an active contract, offline included; the
 * coverage then applies at the cash desk.
 */
export function CoverageCard({ patientId }: { patientId: string }) {
  const t = useTranslations('conventions.coverage');
  const tErr = useTranslations('errors');
  const { dispatch, catalogs, identity } = useRuntime();
  const { link, member, contract, plan } = useCoverage(patientId);
  const beneficiaries = catalogs?.snapshot.conventions?.beneficiaries ?? [];
  const contracts = catalogs?.snapshot.conventions?.contracts ?? [];
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLink = identity?.permissions.includes('beneficiary:read') ?? false;
  if (!canLink || (contracts.length === 0 && !link)) return null;
  const matches = searchBeneficiaries(beneficiaries, query);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {link ? (
          <div className="grid gap-1">
            <p className="font-medium">{contract?.payerName ?? t('unknownContract')}</p>
            <p>
              {member?.fullName} · <span className="font-mono text-xs">{member?.memberNumber}</span>
            </p>
            <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {plan && (
                <Badge variant="info">
                  {t('plan', { code: plan.code, name: String(plan.rules.name ?? '') })}
                </Badge>
              )}
              {member && <span>{t(`roles.${member.role}`)}</span>}
              {member?.isDayLaborer && <Badge variant="warning">{t('dayLaborer')}</Badge>}
              {link.version === 0 && <Badge variant="muted">{t('pending')}</Badge>}
            </p>
            {!ending ? (
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                onClick={() => setEnding(true)}
              >
                <Unlink />
                {t('end')}
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label={t('reason')}
                  placeholder={t('reason')}
                  className="min-w-0 flex-1"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    void run(async () => {
                      await dispatch(
                        'patient_coverage.end',
                        { status: 'ended', unlinkReason: reason.trim() },
                        { entityId: link.id },
                      );
                      setEnding(false);
                      setReason('');
                    })
                  }
                >
                  {t('confirmEnd')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-muted-foreground">{t('none')}</p>
            <Input
              aria-label={t('search')}
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {matches.length > 0 && (
              <ul className="grid gap-1">
                {matches.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() =>
                        void run(() =>
                          dispatch('patient_coverage.link', {
                            patientId,
                            contractId: b.contractId,
                            beneficiaryId: b.id,
                            linkedAt: new Date().toISOString(),
                          }),
                        )
                      }
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Link2 className="size-3.5" aria-hidden />
                      )}
                      <span className="font-medium">{b.fullName}</span>
                      <span className="font-mono text-xs">{b.memberNumber}</span>
                      <span className="text-xs text-muted-foreground">
                        {contracts.find((c) => c.id === b.contractId)?.payerName} · {b.planCode}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
