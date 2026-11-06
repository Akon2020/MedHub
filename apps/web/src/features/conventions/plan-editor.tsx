'use client';

import {
  BILLING_MODES,
  COVERAGES,
  OPEN_CLINIC_PLANS,
  planRules,
  type CoverageRule,
  type PlanRulesInput,
} from '@medhub/conventions';
import { SERVICE_CATEGORIES } from '@medhub/domain';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';

type Rule = PlanRulesInput['rules'] extends (infer R)[] | undefined ? R : never;

const toMajor = (n: number | undefined) => (n === undefined ? '' : String(n / 100));
const toMinor = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};
const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
};

/** Rules of a plan as a table (docs/modules/conv.md: no JSON editing for the user). */
export function PlanEditor({
  value,
  onChange,
}: {
  value: PlanRulesInput;
  onChange: (value: PlanRulesInput) => void;
}) {
  const t = useTranslations('conventions.plan');
  const rules = (value.rules ?? []) as Rule[];
  const set = (patch: Partial<PlanRulesInput>) => onChange({ ...value, ...patch });
  const setRule = (i: number, patch: Partial<CoverageRule>) =>
    set({ rules: rules.map((r, k) => (k === i ? ({ ...r, ...patch } as Rule) : r)) });
  const parsed = planRules.safeParse(value);

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">{t('fromModel')}</span>
        {OPEN_CLINIC_PLANS.map((p) => (
          <Button
            key={p.code}
            size="sm"
            variant="ghost"
            onClick={() => onChange(structuredClone(p))}
          >
            {p.code} · {p.name}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id="plan-code"
          label={t('code')}
          value={value.code}
          onChange={(v) => set({ code: v.toUpperCase() })}
        />
        <Field
          id="plan-name"
          label={t('name')}
          value={value.name}
          onChange={(v) => set({ name: v })}
        />
        <div className="grid gap-1">
          <Label htmlFor="plan-billing">{t('billing')}</Label>
          <NativeSelect
            id="plan-billing"
            value={value.billing}
            onChange={(e) => set({ billing: e.target.value as PlanRulesInput['billing'] })}
          >
            {BILLING_MODES.map((b) => (
              <option key={b} value={b}>
                {t(`billings.${b}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Field
          id="plan-price"
          label={t('price', { currency: value.currency })}
          value={toMajor(value.price)}
          onChange={(v) => set({ price: toMinor(v) })}
        />
        <Field
          id="plan-guarantee"
          label={t('guarantee', { currency: value.currency })}
          value={toMajor(value.guaranteePerWorker)}
          onChange={(v) => set({ guaranteePerWorker: toMinor(v) })}
        />
        <Field
          id="plan-days"
          label={t('packageDays')}
          value={String(value.hospitalization?.packageDays ?? '')}
          onChange={(v) =>
            set({
              hospitalization:
                v.trim() === ''
                  ? undefined
                  : {
                      packageDays: Math.max(0, Math.trunc(Number(v) || 0)),
                      justificationRequired: true,
                    },
            })
          }
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={value.voucherRequired ?? true}
            onChange={(e) => set({ voucherRequired: e.target.checked })}
          />
          {t('voucherRequired')}
        </label>
        <Field
          id="plan-grace"
          label={t('graceHours')}
          value={String(value.voucherGraceHours ?? 72)}
          onChange={(v) => set({ voucherGraceHours: Math.max(1, Math.trunc(Number(v) || 72)) })}
        />
        <div className="grid gap-1">
          <Label htmlFor="plan-default">{t('default')}</Label>
          <NativeSelect
            id="plan-default"
            value={`${value.default?.coverage ?? 'excluded'}:${value.default?.action ?? 'warn'}`}
            onChange={(e) => {
              const [coverage, action] = e.target.value.split(':') as [
                'included' | 'excluded',
                'block' | 'warn',
              ];
              set({ default: { coverage, action } });
            }}
          >
            {['excluded:warn', 'excluded:block', 'included:warn'].map((k) => (
              <option key={k} value={k}>
                {t(`defaults.${k.replace(':', '_')}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="p-1">{t('rule')}</th>
              <th className="p-1">{t('services')}</th>
              <th className="p-1">{t('category')}</th>
              <th className="p-1">{t('coverage')}</th>
              <th className="p-1">{t('percent')}</th>
              <th className="p-1">{t('priorAuthorization')}</th>
              <th className="p-1">{t('action')}</th>
              <th className="p-1" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="p-1">
                  <Input
                    aria-label={t('rule')}
                    className="h-9 w-32"
                    value={r.id}
                    onChange={(e) => setRule(i, { id: e.target.value })}
                  />
                </td>
                <td className="p-1">
                  <Input
                    aria-label={t('services')}
                    className="h-9 w-48 font-mono"
                    value={(r.match.serviceCodes ?? []).join(' ')}
                    onChange={(e) => {
                      const codes = e.target.value
                        .toUpperCase()
                        .split(/[\s,;]+/)
                        .filter(Boolean);
                      setRule(i, {
                        match: { ...r.match, serviceCodes: codes.length ? codes : undefined },
                      });
                    }}
                  />
                </td>
                <td className="p-1">
                  <NativeSelect
                    aria-label={t('category')}
                    className="h-9"
                    value={r.match.category ?? ''}
                    onChange={(e) =>
                      setRule(i, { match: { ...r.match, category: e.target.value || undefined } })
                    }
                  >
                    <option value="">-</option>
                    {SERVICE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1">
                  <NativeSelect
                    aria-label={t('coverage')}
                    className="h-9"
                    value={r.coverage}
                    onChange={(e) =>
                      setRule(i, { coverage: e.target.value as CoverageRule['coverage'] })
                    }
                  >
                    {COVERAGES.map((c) => (
                      <option key={c} value={c}>
                        {t(`coverages.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1">
                  <Input
                    aria-label={t('percent')}
                    className="h-9 w-16"
                    disabled={r.coverage !== 'percent'}
                    value={r.percent?.toString() ?? ''}
                    onChange={(e) =>
                      setRule(i, {
                        percent:
                          e.target.value === ''
                            ? undefined
                            : Math.min(100, Math.max(0, Math.trunc(Number(e.target.value) || 0))),
                      })
                    }
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    type="checkbox"
                    aria-label={t('priorAuthorization')}
                    className="size-4 accent-[var(--primary)]"
                    checked={r.priorAuthorization === true}
                    onChange={(e) =>
                      setRule(i, { priorAuthorization: e.target.checked || undefined })
                    }
                  />
                </td>
                <td className="p-1">
                  <NativeSelect
                    aria-label={t('action')}
                    className="h-9"
                    value={r.action ?? 'warn'}
                    onChange={(e) => setRule(i, { action: e.target.value as 'block' | 'warn' })}
                  >
                    <option value="warn">{t('actions.warn')}</option>
                    <option value="block">{t('actions.block')}</option>
                  </NativeSelect>
                </td>
                <td className="flex p-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('up')}
                    onClick={() => set({ rules: move(rules, i, -1) })}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('down')}
                    onClick={() => set({ rules: move(rules, i, 1) })}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('remove')}
                    onClick={() => set({ rules: rules.filter((_, k) => k !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="justify-self-start"
        onClick={() =>
          set({
            rules: [
              ...rules,
              {
                id: `regle-${rules.length + 1}`,
                match: { category: 'consultation' },
                coverage: 'included',
              } as Rule,
            ],
          })
        }
      >
        <Plus />
        {t('addRule')}
      </Button>
      {!parsed.success && (
        <ul className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {parsed.error.issues.slice(0, 8).map((i, n) => (
            <li key={n}>
              {i.path.join('.')} :{' '}
              {t.has(`errors.${i.message}`) ? t(`errors.${i.message}`) : t('errors.invalid')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
