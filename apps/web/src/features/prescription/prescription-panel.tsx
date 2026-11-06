'use client';

import {
  checkPrescription,
  computeQuantity,
  drugLabel,
  FREQUENCY_CODES,
  newVerificationCode,
  searchDrugs,
  unresolvedBlocking,
  type DrugInfo,
  type Frequency,
  type PatientFacts,
  type PrescriptionAlert,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import {
  AlertTriangle,
  FileSignature,
  Loader2,
  Pill,
  Plus,
  Printer,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type CatalogDrug = DrugInfo & { id: string };
type Line = {
  key: number;
  drug: CatalogDrug | null;
  label: string;
  doseValue: string;
  doseUnit: string;
  frequency: Frequency;
  durationDays: string;
  instructions: string;
  substitutionAllowed: boolean;
  justifications: Record<string, string>;
};

const SEVERITY_STYLE = {
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  blocking: 'bg-danger-soft text-danger',
} as const;

let nextKey = 1;
const emptyLine = (): Line => ({
  key: nextKey++,
  drug: null,
  label: '',
  doseValue: '',
  doseUnit: '',
  frequency: '3x/d',
  durationDays: '',
  instructions: '',
  substitutionAllowed: true,
  justifications: {},
});
const num = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Active lines of the patient's other prescriptions, for duplicates and interactions. */
export function currentMedications(prescriptions: readonly LocalEntity[]) {
  return prescriptions
    .filter((p) => !p.rejected && p.data.status === 'active')
    .flatMap((p) =>
      (Array.isArray(p.data.items) ? (p.data.items as Record<string, unknown>[]) : []).map((i) => ({
        label: String(i.label ?? ''),
        atcCode: typeof i.atcCode === 'string' ? i.atcCode : null,
      })),
    );
}

/**
 * Prescription (docs/modules/dpi.md 5, docs/07-ui-ux.md 5.3): lines from the
 * imported catalogue or typed freely, checked live by the shared rules,
 * offline included. A blocking alert is either avoided (change the drug) or
 * overridden with the permission and a written justification.
 */
export function PrescriptionPanel({
  patientId,
  encounterId,
  facts,
  canBePregnant,
  prescriptions,
  onPrint,
}: {
  patientId: string;
  encounterId: string | null;
  facts: PatientFacts;
  /** Shows the pregnancy box (pregnancy follow-up arrives with MAT in phase 2). */
  canBePregnant: boolean;
  prescriptions: LocalEntity[];
  onPrint?: (prescription: LocalEntity) => void;
}) {
  const t = useTranslations('prescription');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { dispatch, identity, catalogs } = useRuntime();
  const drugs = (catalogs?.snapshot.drugs ?? []) as CatalogDrug[];
  const rules = catalogs?.snapshot.interactionRules ?? [];
  const [lines, setLines] = useState<Line[]>([]);
  const [queries, setQueries] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [pregnant, setPregnant] = useState(facts.pregnant);
  const perms = identity?.permissions ?? [];
  const canPrescribe = perms.includes('prescription:create');
  const canOverride = perms.includes('prescription:override_alert');
  const canCancel = perms.includes('prescription:cancel');

  const own = prescriptions.filter((p) => !p.rejected);
  const checked = lines.map((l) => ({
    label: l.drug ? drugLabel(l.drug) : l.label,
    drug: l.drug,
    atcCode: l.drug?.atcCode ?? null,
    doseValue: num(l.doseValue) ?? 0,
    doseUnit: l.doseUnit,
    frequency: l.frequency,
  }));
  const alerts = checkPrescription(
    checked,
    { ...facts, pregnant },
    rules,
    currentMedications(prescriptions),
  );
  const blocked = lines.some((l, i) => {
    const open = unresolvedBlocking(alerts, i, []).filter(
      (a) => !canOverride || (l.justifications[a.code] ?? '').trim().length < 5,
    );
    return open.length > 0;
  });
  const incomplete = lines.some(
    (l) =>
      !(l.drug || l.label.trim().length >= 2) || num(l.doseValue) === null || !l.doseUnit.trim(),
  );

  const update = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function alertText(a: PrescriptionAlert): string {
    return t(`alerts.${a.code}`, a.params as Record<string, string | number>);
  }

  async function sign() {
    setBusy(true);
    setMessage(null);
    try {
      await dispatch('prescription.create', {
        patientId,
        encounterId,
        kind: 'outpatient',
        prescribedAt: new Date().toISOString(),
        verificationCode: newVerificationCode((n) => crypto.getRandomValues(new Uint8Array(n))),
        items: lines.map((l, i) => {
          const dose = num(l.doseValue) ?? 0;
          const duration = num(l.durationDays);
          return {
            drugId: l.drug?.id ?? null,
            drugCode: l.drug?.code ?? null,
            label: l.drug ? drugLabel(l.drug) : l.label.trim(),
            atcCode: l.drug?.atcCode ?? null,
            doseValue: dose,
            doseUnit: l.doseUnit.trim(),
            route: l.drug?.route ?? null,
            frequency: l.frequency,
            durationDays: duration,
            quantity: computeQuantity(dose, l.frequency, duration),
            instructions: l.instructions.trim() || null,
            substitutionAllowed: l.substitutionAllowed,
            alertsAcknowledged: alerts
              .filter((a) => a.item === i && a.severity === 'blocking')
              .map((a) => ({
                code: a.code,
                severity: a.severity,
                justification: (l.justifications[a.code] ?? '').trim(),
              })),
          };
        }),
      });
      setLines([]);
      setQueries({});
      setMessage({ ok: true, text: t('signed') });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await dispatch(
        'prescription.cancel',
        { status: 'cancelled', cancelReason: cancelReason.trim() },
        { entityId: id },
      );
      setCancelling(null);
      setCancelReason('');
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  const visitPrescriptions = own
    .filter((p) => (encounterId ? p.data.encounterId === encounterId : true))
    .sort((a, b) => String(b.data.prescribedAt).localeCompare(String(a.data.prescribedAt)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pill className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {canPrescribe && canBePregnant && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={pregnant}
              onChange={(e) => setPregnant(e.target.checked)}
            />
            {t('pregnant')}
          </label>
        )}
        {canPrescribe && (
          <div className="grid gap-3">
            {lines.map((l, i) => {
              const matches = l.drug ? [] : searchDrugs(drugs, queries[l.key] ?? '');
              const lineAlerts = alerts.filter((a) => a.item === i);
              const quantity = computeQuantity(
                num(l.doseValue) ?? 0,
                l.frequency,
                num(l.durationDays),
              );
              return (
                <div key={l.key} className="grid gap-2 rounded-xl p-3 ring-1 ring-border">
                  <div className="flex items-start gap-2">
                    <div className="grid flex-1 gap-1.5">
                      <Label htmlFor={`rx-drug-${l.key}`}>{t('drug')}</Label>
                      <Input
                        id={`rx-drug-${l.key}`}
                        autoComplete="off"
                        value={l.drug ? drugLabel(l.drug) : (queries[l.key] ?? '')}
                        onChange={(e) => {
                          setQueries({ ...queries, [l.key]: e.target.value });
                          update(l.key, { drug: null, label: e.target.value });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('removeLine')}
                      onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {matches.length > 0 && (
                    <ul className="grid gap-1">
                      {matches.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                            onClick={() =>
                              update(l.key, {
                                drug: d,
                                label: drugLabel(d),
                                doseUnit: l.doseUnit || d.doseUnit || '',
                              })
                            }
                          >
                            {drugLabel(d)}{' '}
                            <span className="font-mono text-xs text-muted-foreground">
                              {d.atcCode}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {drugs.length === 0 && i === 0 && (
                    <p className="text-xs text-muted-foreground">{t('noCatalog')}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="grid gap-1">
                      <Label htmlFor={`rx-dose-${l.key}`}>{t('dose')}</Label>
                      <Input
                        id={`rx-dose-${l.key}`}
                        inputMode="decimal"
                        value={l.doseValue}
                        onChange={(e) => update(l.key, { doseValue: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`rx-unit-${l.key}`}>{t('unit')}</Label>
                      <Input
                        id={`rx-unit-${l.key}`}
                        value={l.doseUnit}
                        onChange={(e) => update(l.key, { doseUnit: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`rx-freq-${l.key}`}>{t('frequency')}</Label>
                      <NativeSelect
                        id={`rx-freq-${l.key}`}
                        value={l.frequency}
                        onChange={(e) => update(l.key, { frequency: e.target.value as Frequency })}
                      >
                        {FREQUENCY_CODES.map((f) => (
                          <option key={f} value={f}>
                            {t(`frequencies.${f.replace('/', '_')}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`rx-days-${l.key}`}>{t('days')}</Label>
                      <Input
                        id={`rx-days-${l.key}`}
                        inputMode="numeric"
                        value={l.durationDays}
                        onChange={(e) => update(l.key, { durationDays: e.target.value })}
                      />
                    </div>
                  </div>
                  <Input
                    aria-label={t('instructions')}
                    placeholder={t('instructions')}
                    value={l.instructions}
                    onChange={(e) => update(l.key, { instructions: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {quantity !== null && (
                      <span>{t('quantity', { quantity, unit: l.doseUnit })}</span>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={l.substitutionAllowed}
                        onChange={(e) => update(l.key, { substitutionAllowed: e.target.checked })}
                      />
                      {t('substitution')}
                    </label>
                  </div>
                  {lineAlerts.map((a, n) => (
                    <div
                      key={`${a.code}-${n}`}
                      role={a.severity === 'blocking' ? 'alert' : 'status'}
                      className={cn('grid gap-2 rounded-lg px-3 py-2', SEVERITY_STYLE[a.severity])}
                    >
                      <p className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>
                          <span className="font-medium">{t(`severity.${a.severity}`)} : </span>
                          {alertText(a)}
                        </span>
                      </p>
                      {a.severity === 'blocking' &&
                        (canOverride ? (
                          <Input
                            aria-label={t('justification')}
                            placeholder={t('justification')}
                            className="bg-card"
                            value={l.justifications[a.code] ?? ''}
                            onChange={(e) =>
                              update(l.key, {
                                justifications: { ...l.justifications, [a.code]: e.target.value },
                              })
                            }
                          />
                        ) : (
                          <p className="text-xs">{t('changeDrug')}</p>
                        ))}
                    </div>
                  ))}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLines([...lines, emptyLine()])}
              >
                <Plus />
                {t('addLine')}
              </Button>
              {lines.length > 0 && (
                <Button
                  size="sm"
                  disabled={busy || blocked || incomplete}
                  onClick={() => void sign()}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <FileSignature />}
                  {t('sign')}
                </Button>
              )}
            </div>
          </div>
        )}
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-success' : 'text-danger'}
          >
            {message.text}
          </p>
        )}
        {visitPrescriptions.length > 0 && (
          <ul className="grid gap-3">
            {visitPrescriptions.map((p) => {
              const items = (Array.isArray(p.data.items) ? p.data.items : []) as Record<
                string,
                unknown
              >[];
              const status = String(p.data.status ?? 'active');
              return (
                <li key={p.id} className="grid gap-1.5 rounded-xl p-3 ring-1 ring-border">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {format.dateTime(new Date(String(p.data.prescribedAt)), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="font-mono">{String(p.data.verificationCode ?? '')}</span>
                    <Badge variant={status === 'active' ? 'info' : 'muted'}>
                      {t(`status.${status}`)}
                    </Badge>
                    {p.version === 0 && <Badge variant="muted">{t('pending')}</Badge>}
                  </p>
                  <ul
                    className={cn(
                      'grid gap-0.5',
                      status === 'cancelled' && 'line-through opacity-60',
                    )}
                  >
                    {items.map((i, n) => (
                      <li key={n}>
                        <span className="font-medium">{String(i.label)}</span>{' '}
                        {t('posology', {
                          dose: Number(i.doseValue),
                          unit: String(i.doseUnit),
                          frequency: t(`frequencies.${String(i.frequency).replace('/', '_')}`),
                          days: typeof i.durationDays === 'number' ? i.durationDays : 0,
                        })}
                        {Array.isArray(i.alertsAcknowledged) && i.alertsAcknowledged.length > 0 && (
                          <span className="ml-1 text-xs text-warning">{t('overridden')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {status === 'active' && (
                    <div className="flex flex-wrap gap-2">
                      {onPrint && (
                        <Button size="sm" variant="secondary" onClick={() => onPrint(p)}>
                          <Printer />
                          {t('print')}
                        </Button>
                      )}
                      {canCancel && cancelling !== p.id && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(p.id)}>
                          <XCircle />
                          {t('cancel')}
                        </Button>
                      )}
                    </div>
                  )}
                  {cancelling === p.id && (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label={t('cancelReason')}
                        placeholder={t('cancelReason')}
                        className="max-w-80"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || cancelReason.trim().length < 3}
                        onClick={() => void cancel(p.id)}
                      >
                        {t('confirmCancel')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
