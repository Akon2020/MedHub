'use client';

import { planRules, type PlanRulesInput } from '@medhub/conventions';
import { PAYER_KINDS } from '@medhub/domain';
import { Check, FileUp, Loader2, Plus, Send, Upload, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { useStepUp } from '@/features/auth/step-up';
import { GuaranteesCard } from './guarantees-card';
import { PlanEditor } from './plan-editor';

type Payer = { id: string; code: string; name: string; kind: string };
type Contract = {
  id: string;
  payerId: string;
  code: string;
  name: string;
  status: string;
  currency: string;
  validFrom: string;
  invoiceDay: number;
  beneficiaries: number;
};
type Plan = {
  id: string;
  contractId: string;
  code: string;
  version: number;
  status: string;
  rules: PlanRulesInput;
};
type Overview = {
  payers: Payer[];
  contracts: Contract[];
  plans: Plan[];
  permissions: { create: boolean; update: boolean; activate: boolean; import: boolean };
};
type ImportReport = {
  errors: { line: number; message: string }[];
  entries: number;
  changes: number;
  exits: number;
  total: number;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Contracts of the structure (docs/modules/conv.md, écrans), online: payers,
 * contracts, plans edited as a table and published as versions, activation,
 * beneficiary lists imported with a report of the differences.
 */
export function ConventionsSettings() {
  const t = useTranslations('conventions');
  const tErr = useTranslations('errors');
  const online = useOnline();
  const { reloadCatalogs } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [view, setView] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [payer, setPayer] = useState({ code: '', name: '', kind: 'company' });
  const [contract, setContract] = useState({
    payerId: '',
    code: '',
    name: '',
    currency: 'USD',
    validFrom: today(),
    invoiceDay: '25',
  });
  const [draft, setDraft] = useState<PlanRulesInput | null>(null);
  const [csv, setCsv] = useState('');
  const [complete, setComplete] = useState(false);
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const describe = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      return tErr.has(code) ? tErr(code) : tErr('UNKNOWN');
    },
    [tErr],
  );
  const refresh = useCallback(async () => {
    try {
      const out = await apiFetch<Overview>('/api/v1/contracts');
      setView(out);
      setSelected((s) => s ?? out.contracts[0]?.id ?? null);
    } catch (err) {
      setError(describe(err));
    }
  }, [describe]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function send<T>(
    path: string,
    body: unknown,
    done: string,
    stepUp = false,
  ): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const call = () => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
      const out = stepUp ? await guard(call) : await call();
      setNotice(done);
      await refresh();
      return out;
    } catch (err) {
      setError(describe(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!online && !view) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!view)
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin" aria-hidden />
    );

  const current = view.contracts.find((c) => c.id === selected) ?? null;
  const plans = view.plans.filter((p) => p.contractId === current?.id);
  const codes = [...new Set(plans.map((p) => p.code))];

  return (
    <div className="grid gap-6">
      {notice && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('payers.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ul className="grid gap-1">
            {view.payers.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{p.code}</span>{' '}
                <Badge variant="muted">{t(`payers.kinds.${p.kind}`)}</Badge>
              </li>
            ))}
          </ul>
          {view.permissions.create && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send('/api/v1/payers', payer, t('saved'));
              }}
            >
              <Small
                id="payer-code"
                label={t('code')}
                value={payer.code}
                onChange={(v) => setPayer({ ...payer, code: v })}
              />
              <Small
                id="payer-name"
                label={t('name')}
                value={payer.name}
                onChange={(v) => setPayer({ ...payer, name: v })}
                wide
              />
              <div className="grid gap-1">
                <Label htmlFor="payer-kind">{t('payers.kind')}</Label>
                <NativeSelect
                  id="payer-kind"
                  value={payer.kind}
                  onChange={(e) => setPayer({ ...payer, kind: e.target.value })}
                >
                  {PAYER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`payers.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || payer.code.trim() === '' || payer.name.trim().length < 2}
              >
                <Plus />
                {t('payers.add')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('contracts.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {view.contracts.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={c.id === selected ? 'default' : 'secondary'}
                onClick={() => setSelected(c.id)}
              >
                {c.name} · {t(`contracts.status.${c.status}`)}
              </Button>
            ))}
          </div>
          {view.permissions.create && view.payers.length > 0 && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send(
                  '/api/v1/contracts',
                  {
                    ...contract,
                    payerId: contract.payerId || view.payers[0]!.id,
                    invoiceDay: Number(contract.invoiceDay) || 25,
                  },
                  t('saved'),
                );
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="contract-payer">{t('contracts.payer')}</Label>
                <NativeSelect
                  id="contract-payer"
                  value={contract.payerId}
                  onChange={(e) => setContract({ ...contract, payerId: e.target.value })}
                >
                  {view.payers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Small
                id="contract-code"
                label={t('code')}
                value={contract.code}
                onChange={(v) => setContract({ ...contract, code: v })}
              />
              <Small
                id="contract-name"
                label={t('name')}
                value={contract.name}
                onChange={(v) => setContract({ ...contract, name: v })}
                wide
              />
              <Small
                id="contract-currency"
                label={t('contracts.currency')}
                value={contract.currency}
                onChange={(v) => setContract({ ...contract, currency: v.toUpperCase() })}
              />
              <div className="grid gap-1">
                <Label htmlFor="contract-from">{t('contracts.from')}</Label>
                <Input
                  id="contract-from"
                  type="date"
                  value={contract.validFrom}
                  onChange={(e) => setContract({ ...contract, validFrom: e.target.value })}
                />
              </div>
              <Small
                id="contract-day"
                label={t('contracts.invoiceDay')}
                value={contract.invoiceDay}
                onChange={(v) => setContract({ ...contract, invoiceDay: v })}
              />
              <Button
                type="submit"
                size="sm"
                disabled={busy || contract.code.trim() === '' || contract.name.trim().length < 2}
              >
                <Plus />
                {t('contracts.add')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {current.name}
              <Badge variant={current.status === 'active' ? 'info' : 'muted'}>
                {t(`contracts.status.${current.status}`)}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t('contracts.summary', {
                beneficiaries: current.beneficiaries,
                day: current.invoiceDay,
                currency: current.currency,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {view.permissions.activate && current.status !== 'terminated' && (
              <div className="flex flex-wrap gap-2">
                {current.status !== 'active' && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        '/api/v1/contracts/status',
                        { id: current.id, status: 'active' },
                        t('saved'),
                        true,
                      ).then(() => reloadCatalogs())
                    }
                  >
                    {t('contracts.activate')}
                  </Button>
                )}
                {current.status === 'active' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        '/api/v1/contracts/status',
                        { id: current.id, status: 'suspended' },
                        t('saved'),
                        true,
                      )
                    }
                  >
                    {t('contracts.suspend')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      '/api/v1/contracts/status',
                      { id: current.id, status: 'terminated' },
                      t('saved'),
                      true,
                    )
                  }
                >
                  {t('contracts.terminate')}
                </Button>
              </div>
            )}

            <div className="grid gap-2">
              <p className="font-medium">{t('plans.title')}</p>
              <ul className="grid gap-1">
                {codes.map((code) => {
                  const versions = plans.filter((p) => p.code === code);
                  const published = versions.find((v) => v.status === 'published');
                  const pending = versions.find((v) => v.status === 'draft');
                  return (
                    <li key={code} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{code}</span>
                      <span>{(published ?? pending)?.rules.name}</span>
                      {published && (
                        <Badge variant="info">
                          {t('plans.published', { version: published.version })}
                        </Badge>
                      )}
                      {pending && (
                        <Badge variant="warning">
                          {t('plans.draft', { version: pending.version })}
                        </Badge>
                      )}
                      {view.permissions.update && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDraft(structuredClone((pending ?? published)!.rules))}
                        >
                          {t('plans.edit')}
                        </Button>
                      )}
                      {pending && view.permissions.activate && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void send(
                              '/api/v1/contracts/plans/publish',
                              { contractId: current.id, code },
                              t('saved'),
                              true,
                            ).then(() => reloadCatalogs())
                          }
                        >
                          <Send />
                          {t('plans.publish')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {view.permissions.update && !draft && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="justify-self-start"
                  onClick={() =>
                    setDraft({
                      code: 'N',
                      name: t('plans.newName'),
                      currency: current.currency,
                      billing: 'per_act',
                      rules: [],
                      default: { coverage: 'excluded', action: 'warn' },
                    })
                  }
                >
                  <Plus />
                  {t('plans.add')}
                </Button>
              )}
              {draft && (
                <div className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
                  <PlanEditor value={draft} onChange={setDraft} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !planRules.safeParse(draft).success}
                      onClick={() =>
                        void send(
                          '/api/v1/contracts/plans',
                          {
                            contractId: current.id,
                            rules: { ...draft, currency: current.currency },
                          },
                          t('plans.draftSaved'),
                        ).then((out) => out && setDraft(null))
                      }
                    >
                      <Check />
                      {t('plans.saveDraft')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {view.permissions.import && (
              <div className="grid gap-2 rounded-xl bg-muted/50 p-3">
                <p className="font-medium">{t('beneficiaries.import')}</p>
                <p className="text-xs text-muted-foreground">{t('beneficiaries.hint')}</p>
                <label className="inline-flex cursor-pointer items-center gap-2 justify-self-start rounded-full px-3.5 py-2 text-[13px] font-medium ring-1 ring-border hover:bg-muted">
                  <FileUp className="size-4" aria-hidden />
                  {t('beneficiaries.chooseFile')}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setCsv(await file.text());
                        setReport(null);
                      }
                    }}
                  />
                </label>
                <textarea
                  aria-label={t('beneficiaries.paste')}
                  placeholder={t('beneficiaries.paste')}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs"
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setReport(null);
                  }}
                />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={complete}
                      onChange={(e) => setComplete(e.target.checked)}
                    />
                    {t('beneficiaries.complete')}
                  </label>
                  <div className="grid gap-1">
                    <Label htmlFor="effective-on">{t('beneficiaries.effectiveOn')}</Label>
                    <Input
                      id="effective-on"
                      type="date"
                      value={effectiveOn}
                      onChange={(e) => setEffectiveOn(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || csv.trim() === ''}
                    onClick={() =>
                      void send<ImportReport>(
                        '/api/v1/beneficiaries/import',
                        {
                          contractId: current.id,
                          csv,
                          apply: false,
                          completeList: complete,
                          effectiveOn,
                        },
                        t('beneficiaries.checked'),
                      ).then((out) => out && setReport(out))
                    }
                  >
                    <Upload />
                    {t('beneficiaries.check')}
                  </Button>
                </div>
                {report && (
                  <div className="grid gap-2" role="status">
                    <p>
                      {t('beneficiaries.report', {
                        entries: report.entries,
                        changes: report.changes,
                        exits: report.exits,
                        errors: report.errors.length,
                      })}
                    </p>
                    {report.errors.length > 0 && (
                      <ul className="max-h-40 overflow-auto rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                        {report.errors.map((e) => (
                          <li key={`${e.line}-${e.message}`}>
                            {t('beneficiaries.error', {
                              line: e.line,
                              problem: tErr.has(e.message) ? tErr(e.message) : e.message,
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                    {report.errors.length === 0 &&
                      report.entries + report.changes + report.exits > 0 && (
                        <Button
                          size="sm"
                          className="justify-self-start"
                          disabled={busy}
                          onClick={() =>
                            void send(
                              '/api/v1/beneficiaries/import',
                              {
                                contractId: current.id,
                                csv,
                                apply: true,
                                completeList: complete,
                                effectiveOn,
                              },
                              t('beneficiaries.applied'),
                            ).then(async (out) => {
                              if (out) {
                                setCsv('');
                                setReport(null);
                                await reloadCatalogs();
                              }
                            })
                          }
                        >
                          <Check />
                          {t('beneficiaries.apply')}
                        </Button>
                      )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {current && (
        <GuaranteesCard
          key={current.id}
          contractId={current.id}
          currency={current.currency}
          guard={guard}
        />
      )}
      {dialog}
    </div>
  );
}

function Small({
  id,
  label,
  value,
  onChange,
  wide = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'grid min-w-48 flex-1 gap-1' : 'grid gap-1'}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={wide ? undefined : 'w-32'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
