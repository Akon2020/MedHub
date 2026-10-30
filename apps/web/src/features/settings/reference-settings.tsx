'use client';

import type { ChoiceItemInput, ImportError } from '@medhub/domain';
import { Check, Download, FileUp, ListPlus, Loader2, Plus, Upload, WifiOff } from 'lucide-react';
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
import { useStepUp } from '@/features/auth/step-up';
import { cn } from '@/lib/utils';

type Item = ChoiceItemInput & { id?: string };
type ChoiceList = {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
  version: number;
  items: Item[];
};
type Overview = {
  choiceLists: ChoiceList[];
  currencies: { code: string; nameFr: string; nameEn: string; minorUnit: number; symbol: string }[];
  units: { code: string; kind: string; symbol: string; labelFr: string; labelEn: string }[];
  areas: { level: number; kind: string; count: number }[];
  provinces: { code: string; name: string }[];
  canEdit: boolean;
};
type Run = <T>(path: string, body: unknown) => Promise<T | null>;

const KNOWN_ERRORS = new Set([
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
  'REF_LIST_CODE_TAKEN',
]);

const TEMPLATE = 'code;libelle;libelle_en;ordre\nEXEMPLE;Libellé en français;English label;10\n';

/** Template with French headers and one example line (docs/06-configuration.md section 7). */
function downloadTemplate() {
  const blob = new Blob([`\uFEFF${TEMPLATE}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modele-liste-de-choix.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/** Imported lines replace the items with the same code; the others are added. */
function merge(current: Item[], imported: Item[]): Item[] {
  const byCode = new Map(current.map((i) => [i.code, i]));
  for (const item of imported) byCode.set(item.code, { ...byCode.get(item.code), ...item });
  return [...byCode.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function ImportPanel({
  listId,
  run,
  onImported,
}: {
  listId: string;
  run: Run;
  onImported: (items: Item[]) => void;
}) {
  const t = useTranslations('settings.reference.import');
  const online = useOnline();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<{ items: Item[]; errors: ImportError[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function simulate() {
    setBusy(true);
    try {
      setResult(
        await run<{ items: Item[]; errors: ImportError[] }>('/api/v1/choice-lists/import', {
          listId,
          csv,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl p-3 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{t('title')}</h4>
        <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
          <Download />
          {t('template')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium ring-1 ring-border hover:bg-muted">
          <FileUp className="size-4" aria-hidden />
          {t('chooseFile')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                setCsv(await file.text());
                setResult(null);
              }
            }}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || !online || csv.trim().length === 0}
          onClick={() => void simulate()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {t('simulate')}
        </Button>
      </div>
      <textarea
        aria-label={t('paste')}
        placeholder={t('paste')}
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setResult(null);
        }}
        rows={4}
        className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs"
      />
      {result && (
        <div className="grid gap-2 text-sm" role="status">
          <p>{t('summary', { valid: result.items.length, errors: result.errors.length })}</p>
          {result.errors.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {result.errors.map((e) => (
                <li key={`${e.line}-${e.field}-${e.problem}`}>
                  {t('error', {
                    line: e.line,
                    field: e.field,
                    problem: t(`problems.${e.problem}`),
                  })}
                </li>
              ))}
            </ul>
          )}
          {result.items.length > 0 && result.errors.length === 0 && (
            <Button
              type="button"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                onImported(result.items);
                setCsv('');
                setResult(null);
              }}
            >
              <Check />
              {t('apply', { count: result.items.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ListEditor({
  list,
  canEdit,
  run,
  onSaved,
}: {
  list: ChoiceList;
  canEdit: boolean;
  run: Run;
  onSaved: (notice: string) => Promise<void>;
}) {
  const t = useTranslations('settings.reference');
  const online = useOnline();
  const [nameFr, setNameFr] = useState(list.nameFr);
  const [nameEn, setNameEn] = useState(list.nameEn ?? '');
  const [active, setActive] = useState(list.isActive);
  const [items, setItems] = useState<Item[]>(list.items);
  const [busy, setBusy] = useState(false);
  const existing = new Set(list.items.map((i) => i.code));

  const setItem = (index: number, patch: Partial<Item>) =>
    setItems((all) => all.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const header =
        nameFr !== list.nameFr || nameEn !== (list.nameEn ?? '') || active !== list.isActive
          ? await run('/api/v1/choice-lists/update', {
              listId: list.id,
              nameFr,
              nameEn,
              description: list.description ?? '',
              isActive: active,
            })
          : true;
      if (!header) return;
      const saved = await run<{ added: number; updated: number; deactivated: number }>(
        '/api/v1/choice-lists/items',
        {
          listId: list.id,
          items: items.map(({ code, labelFr, labelEn, sortOrder, isActive }) => ({
            code: code.trim(),
            labelFr,
            labelEn: labelEn ?? '',
            sortOrder: Number(sortOrder) || 0,
            isActive,
          })),
        },
      );
      if (saved) await onSaved(t('saved', saved));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="list-name-fr">{t('fields.nameFr')}</Label>
          <Input
            id="list-name-fr"
            value={nameFr}
            onChange={(e) => setNameFr(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="list-name-en">{t('fields.nameEn')}</Label>
          <Input
            id="list-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            disabled={!canEdit}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={active}
          disabled={!canEdit}
          onChange={(e) => setActive(e.target.checked)}
        />
        {t('fields.listActive')}
      </label>

      <div className="overflow-x-auto rounded-xl ring-1 ring-border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t('fields.code')}</th>
              <th className="px-3 py-2 font-medium">{t('fields.labelFr')}</th>
              <th className="px-3 py-2 font-medium">{t('fields.labelEn')}</th>
              <th className="w-24 px-3 py-2 font-medium">{t('fields.order')}</th>
              <th className="w-16 px-3 py-2 font-medium">{t('fields.active')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, index) => (
              <tr key={item.id ?? `new-${index}`} className={cn(!item.isActive && 'opacity-60')}>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={t('fields.code')}
                    value={item.code}
                    onChange={(e) => setItem(index, { code: e.target.value })}
                    disabled={!canEdit || existing.has(item.code)}
                    className="h-9 font-mono text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={t('fields.labelFr')}
                    value={item.labelFr}
                    onChange={(e) => setItem(index, { labelFr: e.target.value })}
                    disabled={!canEdit}
                    className="h-9"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={t('fields.labelEn')}
                    value={item.labelEn ?? ''}
                    onChange={(e) => setItem(index, { labelEn: e.target.value })}
                    disabled={!canEdit}
                    className="h-9"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={t('fields.order')}
                    type="number"
                    value={item.sortOrder}
                    onChange={(e) => setItem(index, { sortOrder: Number(e.target.value) })}
                    disabled={!canEdit}
                    className="h-9"
                  />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    aria-label={t('fields.active')}
                    className="size-4 accent-[var(--primary)]"
                    checked={item.isActive}
                    disabled={!canEdit}
                    onChange={(e) => setItem(index, { isActive: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {t('noItems')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('itemsHint')}</p>

      {canEdit && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              setItems((all) => [
                ...all,
                {
                  code: '',
                  labelFr: '',
                  labelEn: null,
                  sortOrder: (all.at(-1)?.sortOrder ?? 0) + 10,
                  isActive: true,
                },
              ])
            }
          >
            <Plus />
            {t('addItem')}
          </Button>
          <ImportPanel
            listId={list.id}
            run={run}
            onImported={(imported) => setItems((all) => merge(all, imported))}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !online || nameFr.trim().length < 2}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t('save')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function NewListForm({ run, onCreated }: { run: Run; onCreated: (id: string) => Promise<void> }) {
  const t = useTranslations('settings.reference');
  const online = useOnline();
  const [code, setCode] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await run<{ listId: string }>('/api/v1/choice-lists', {
        code: code.trim(),
        nameFr,
      });
      if (created) await onCreated(created.listId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl p-3 ring-1 ring-border" noValidate>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="new-list-name">{t('fields.nameFr')}</Label>
          <Input id="new-list-name" value={nameFr} onChange={(e) => setNameFr(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-list-code">{t('fields.listCode')}</Label>
          <Input
            id="new-list-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
          />
        </div>
      </div>
      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={busy || !online || nameFr.trim().length < 2 || code.trim().length < 1}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ListPlus />}
        {t('createList')}
      </Button>
    </form>
  );
}

function PlatformCatalogs({ overview }: { overview: Overview }) {
  const t = useTranslations('settings.reference.platform');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="mt-1">{t('text')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <section className="grid gap-2">
          <h4 className="font-semibold">{t('areas')}</h4>
          <div className="flex flex-wrap gap-2">
            {overview.areas.map((a) => (
              <Badge key={`${a.level}-${a.kind}`} variant="muted">
                {t(`kinds.${a.kind}`)} : {a.count}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('areasHint')}</p>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">
              {t('provinces', { count: overview.provinces.length })}
            </summary>
            <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {overview.provinces.map((p) => (
                <li key={p.code}>
                  <span className="font-mono text-muted-foreground">{p.code}</span> {p.name}
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section className="grid gap-2">
          <h4 className="font-semibold">{t('currencies')}</h4>
          <ul className="grid gap-1">
            {overview.currencies.map((c) => (
              <li key={c.code}>
                <span className="font-mono">{c.code}</span> · {c.nameFr} ({c.symbol}),{' '}
                {t('minorUnit', { digits: c.minorUnit })}
              </li>
            ))}
          </ul>
        </section>
        <section className="grid gap-2">
          <h4 className="font-semibold">{t('units')}</h4>
          <div className="flex flex-wrap gap-1.5">
            {overview.units.map((u) => (
              <Badge key={u.code} variant="outline" title={u.labelFr}>
                {u.symbol}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('unitsHint')}</p>
        </section>
      </CardContent>
    </Card>
  );
}

/** Online-only screen: pick lists of the structure and the platform catalogs. */
export function ReferenceSettings() {
  const t = useTranslations('settings');
  const online = useOnline();
  const { reloadCatalogs } = useRuntime();
  const { guard, dialog } = useStepUp();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? t(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : t('errors.NETWORK'),
    [t],
  );

  const refresh = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>('/api/v1/reference'));
      setError(null);
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

  const run: Run = useCallback(
    async <T,>(path: string, body: unknown): Promise<T | null> => {
      setError(null);
      try {
        return await guard(() => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }));
      } catch (err) {
        setError(describe(err));
        return null;
      }
    },
    [guard, describe],
  );

  if (!online && !overview) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!overview) {
    return error ? (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }

  const list = overview.choiceLists.find((l) => l.id === selected) ?? null;
  const afterChange = async () => {
    await refresh();
    await reloadCatalogs();
  };

  return (
    <div className="grid gap-4">
      {dialog}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {notice}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('reference.listsTitle')}</CardTitle>
              <CardDescription className="mt-1">{t('reference.listsText')}</CardDescription>
            </div>
            {overview.canEdit && (
              <Button size="sm" disabled={!online} onClick={() => setCreating((v) => !v)}>
                <Plus />
                {t('reference.newList')}
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {creating && (
              <NewListForm
                run={run}
                onCreated={async (id) => {
                  setCreating(false);
                  setSelected(id);
                  await afterChange();
                }}
              />
            )}
            <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
              {overview.choiceLists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setSelected(l.id);
                    }}
                    aria-current={selected === l.id}
                    className={cn(
                      'grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                      selected === l.id && 'bg-accent',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{l.nameFr}</span>
                      {!l.isActive && <Badge variant="muted">{t('inactive')}</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{l.code}</span> ·{' '}
                      {t('reference.itemCount', {
                        count: l.items.filter((i) => i.isActive).length,
                      })}
                    </span>
                  </button>
                </li>
              ))}
              {overview.choiceLists.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {t('reference.noLists')}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        {list ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{list.nameFr}</CardTitle>
                <CardDescription className="mt-1">
                  <span className="font-mono">{list.code}</span> ·{' '}
                  {t('reference.version', { version: list.version })}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                {t('reference.close')}
              </Button>
            </CardHeader>
            <CardContent>
              <ListEditor
                key={`${list.id}-${list.version}`}
                list={list}
                canEdit={overview.canEdit}
                run={run}
                onSaved={async (message) => {
                  setNotice(message);
                  await afterChange();
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <PlatformCatalogs overview={overview} />
        )}
      </div>
    </div>
  );
}
