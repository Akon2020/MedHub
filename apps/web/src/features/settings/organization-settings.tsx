'use client';

import {
  DEPARTMENT_KINDS,
  ORGANIZATION_CURRENCIES,
  ORGANIZATION_LOCALES,
  SITE_TIMEZONES,
} from '@medhub/domain';
import { Building2, Loader2, MapPin, Pencil, Plus, Power, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useStepUp } from '@/features/auth/step-up';

type Address = {
  province?: string | null;
  city?: string | null;
  commune?: string | null;
  quarter?: string | null;
  street?: string | null;
};

type Site = {
  id: string;
  code: string;
  name: string;
  address: Address;
  timezone: string;
  phone: string | null;
  isActive: boolean;
};

type Department = {
  id: string;
  siteId: string;
  code: string;
  name: string;
  kind: string;
  costCenterCode: string | null;
  isActive: boolean;
};

type Organization = {
  tenant: {
    code: string;
    type: string;
    status: string;
    isTraining: boolean;
    displayName: string;
    legalName: string;
    defaultLocale: string;
    defaultCurrency: string;
    timezone: string;
    contact: { phone?: string | null; email?: string | null; address?: Address };
    legalMentions: string | null;
  };
  sites: Site[];
  departments: Department[];
  canEdit: boolean;
};

const KNOWN_ERRORS = new Set([
  'ORG_SITE_CODE_TAKEN',
  'ORG_DEPARTMENT_CODE_TAKEN',
  'ORG_LAST_ACTIVE_SITE',
  'ORG_SITE_INACTIVE',
  'PERMISSION_DENIED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
]);

function useErrorText() {
  const t = useTranslations('settings.errors');
  return (error: unknown) =>
    error instanceof ApiError
      ? t(KNOWN_ERRORS.has(error.code) ? error.code : 'UNKNOWN')
      : t('NETWORK');
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {message}
    </p>
  );
}

function AddressFields({
  prefix,
  value,
  onChange,
  disabled,
}: {
  prefix: string;
  value: Address;
  onChange: (next: Address) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.address');
  const provinces = useRuntime().catalogs?.snapshot.provinces ?? [];
  const keys = ['province', 'city', 'commune', 'quarter', 'street'] as const;
  return (
    <>
      {keys.map((key) => (
        <Field key={key} id={`${prefix}-${key}`} label={t(key)}>
          {key === 'province' && provinces.length > 0 ? (
            <NativeSelect
              id={`${prefix}-${key}`}
              value={value.province ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, province: e.target.value })}
            >
              <option value="">{t('noProvince')}</option>
              {value.province && !provinces.some((p) => p.name === value.province) && (
                <option value={value.province}>{value.province}</option>
              )}
              {provinces.map((p) => (
                <option key={p.code} value={p.name}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={`${prefix}-${key}`}
              value={value[key] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </>
  );
}

function StructureCard({
  org,
  guard,
  onSaved,
}: {
  org: Organization;
  guard: <T>(task: () => Promise<T>) => Promise<T>;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.structure');
  const errorText = useErrorText();
  const online = useOnline();
  const [form, setForm] = useState(() => ({
    displayName: org.tenant.displayName,
    legalName: org.tenant.legalName,
    defaultLocale: org.tenant.defaultLocale,
    defaultCurrency: org.tenant.defaultCurrency,
    timezone: org.tenant.timezone,
    phone: org.tenant.contact.phone ?? '',
    email: org.tenant.contact.email ?? '',
    address: org.tenant.contact.address ?? {},
    legalMentions: org.tenant.legalMentions ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const readOnly = !org.canEdit;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await guard(() =>
        apiFetch('/api/v1/organization', {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: form.displayName,
            legalName: form.legalName,
            defaultLocale: form.defaultLocale,
            defaultCurrency: form.defaultCurrency,
            timezone: form.timezone,
            contact: { phone: form.phone, email: form.email, address: form.address },
            legalMentions: form.legalMentions,
          }),
        }),
      );
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription className="mt-1">{t('text')}</CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge variant="outline">{org.tenant.code}</Badge>
          {org.tenant.isTraining && <Badge variant="info">{t('training')}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field id="org-display" label={t('displayName')}>
            <Input
              id="org-display"
              value={form.displayName}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </Field>
          <Field id="org-legal" label={t('legalName')}>
            <Input
              id="org-legal"
              value={form.legalName}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </Field>
          <Field id="org-locale" label={t('defaultLocale')}>
            <NativeSelect
              id="org-locale"
              value={form.defaultLocale}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
            >
              {ORGANIZATION_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`locales.${l}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="org-currency" label={t('defaultCurrency')}>
            <NativeSelect
              id="org-currency"
              value={form.defaultCurrency}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })}
            >
              {ORGANIZATION_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="org-tz" label={t('timezone')}>
            <NativeSelect
              id="org-tz"
              value={form.timezone}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {SITE_TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {t(`timezones.${z.replace('Africa/', '')}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="org-phone" label={t('phone')}>
            <Input
              id="org-phone"
              type="tel"
              value={form.phone}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field id="org-email" label={t('email')}>
            <Input
              id="org-email"
              type="email"
              value={form.email}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <AddressFields
            prefix="org"
            value={form.address}
            disabled={readOnly}
            onChange={(address) => setForm({ ...form, address })}
          />
          <Field id="org-mentions" label={t('legalMentions')} className="sm:col-span-2">
            <Textarea
              id="org-mentions"
              value={form.legalMentions}
              disabled={readOnly}
              placeholder={t('legalMentionsHint')}
              onChange={(e) => setForm({ ...form, legalMentions: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:col-span-2">
            <ErrorLine message={error} />
            {saved && (
              <p
                role="status"
                className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success"
              >
                {t('saved')}
              </p>
            )}
            {!readOnly && (
              <div>
                <Button type="submit" disabled={busy || !online}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('save')}
                </Button>
              </div>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type SiteDraft = { code: string; name: string; timezone: string; phone: string; address: Address };

function SiteForm({
  initial,
  editing,
  onSubmit,
  onCancel,
}: {
  initial: SiteDraft;
  editing: boolean;
  onSubmit: (draft: SiteDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.sites');
  const ts = useTranslations('settings.structure');
  const errorText = useErrorText();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl bg-muted/50 p-4 ring-1 ring-border sm:grid-cols-2"
      noValidate
    >
      <Field id="site-code" label={t('code')}>
        <Input
          id="site-code"
          value={draft.code}
          maxLength={3}
          disabled={editing}
          autoCapitalize="characters"
          placeholder="LIM"
          onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
        />
      </Field>
      <Field id="site-name" label={t('name')}>
        <Input
          id="site-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <Field id="site-tz" label={ts('timezone')}>
        <NativeSelect
          id="site-tz"
          value={draft.timezone}
          onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
        >
          {SITE_TIMEZONES.map((z) => (
            <option key={z} value={z}>
              {ts(`timezones.${z.replace('Africa/', '')}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="site-phone" label={ts('phone')}>
        <Input
          id="site-phone"
          type="tel"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
      </Field>
      <AddressFields
        prefix="site"
        value={draft.address}
        onChange={(address) => setDraft({ ...draft, address })}
      />
      <div className="grid gap-3 sm:col-span-2">
        {!editing && <p className="text-xs text-muted-foreground">{t('codeHint')}</p>}
        <ErrorLine message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {editing ? t('save') : t('create')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </form>
  );
}

type DepartmentDraft = {
  siteId: string;
  code: string;
  name: string;
  kind: string;
  costCenterCode: string;
};

function DepartmentForm({
  sites,
  initial,
  editing,
  onSubmit,
  onCancel,
}: {
  sites: Site[];
  initial: DepartmentDraft;
  editing: boolean;
  onSubmit: (draft: DepartmentDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.departments');
  const errorText = useErrorText();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl bg-muted/50 p-4 ring-1 ring-border sm:grid-cols-2"
      noValidate
    >
      <Field id="dep-site" label={t('site')}>
        <NativeSelect
          id="dep-site"
          value={draft.siteId}
          disabled={editing}
          onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}
        >
          {sites
            .filter((s) => s.isActive || s.id === draft.siteId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field id="dep-code" label={t('code')}>
        <Input
          id="dep-code"
          value={draft.code}
          maxLength={8}
          disabled={editing}
          autoCapitalize="characters"
          placeholder="CONS"
          onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
        />
      </Field>
      <Field id="dep-name" label={t('name')}>
        <Input
          id="dep-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <Field id="dep-kind" label={t('kind')}>
        <NativeSelect
          id="dep-kind"
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
        >
          {DEPARTMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="dep-cost" label={t('costCenter')}>
        <Input
          id="dep-cost"
          value={draft.costCenterCode}
          onChange={(e) => setDraft({ ...draft, costCenterCode: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:col-span-2">
        <ErrorLine message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {editing ? t('save') : t('create')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function addressLine(address: Address): string {
  return [address.quarter, address.commune, address.city, address.province]
    .filter(Boolean)
    .join(', ');
}

/** Online-only screen: structure profile, sites and departments. */
export function OrganizationSettings() {
  const t = useTranslations('settings');
  const errorText = useErrorText();
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [siteEditor, setSiteEditor] = useState<Site | 'new' | null>(null);
  const [depEditor, setDepEditor] = useState<Department | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOrg(await apiFetch<Organization>('/api/v1/organization'));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [errorText]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
    await guard(() => apiFetch(path, { method, body: JSON.stringify(body) }));
    await refresh();
  }

  async function toggle(path: string, id: string, isActive: boolean) {
    setActionError(null);
    try {
      await send(path, 'PATCH', { id, isActive });
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  if (!online && !org) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t('offline')}</p>
      </div>
    );
  }
  if (!org) {
    return loadError ? (
      <ErrorLine message={loadError} />
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }

  const sitesById = new Map(org.sites.map((s) => [s.id, s]));
  const firstActiveSite = org.sites.find((s) => s.isActive);

  return (
    <div className="grid gap-6">
      {dialog}
      {!online && (
        <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('offline')}</p>
        </div>
      )}
      <StructureCard org={org} guard={guard} onSaved={refresh} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-primary" aria-hidden />
              {t('sites.title')}
            </CardTitle>
            <CardDescription className="mt-1">{t('sites.text')}</CardDescription>
          </div>
          {org.canEdit && siteEditor === null && (
            <Button size="sm" disabled={!online} onClick={() => setSiteEditor('new')}>
              <Plus />
              {t('sites.add')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {siteEditor !== null && (
            <SiteForm
              key={siteEditor === 'new' ? 'new' : siteEditor.id}
              editing={siteEditor !== 'new'}
              initial={
                siteEditor === 'new'
                  ? { code: '', name: '', timezone: org.tenant.timezone, phone: '', address: {} }
                  : {
                      code: siteEditor.code,
                      name: siteEditor.name,
                      timezone: siteEditor.timezone,
                      phone: siteEditor.phone ?? '',
                      address: siteEditor.address,
                    }
              }
              onCancel={() => setSiteEditor(null)}
              onSubmit={async (draft) => {
                if (siteEditor === 'new') await send('/api/v1/sites', 'POST', draft);
                else
                  await send('/api/v1/sites', 'PATCH', {
                    id: siteEditor.id,
                    name: draft.name,
                    timezone: draft.timezone,
                    phone: draft.phone,
                    address: draft.address,
                  });
                setSiteEditor(null);
              }}
            />
          )}
          <ErrorLine message={actionError} />
          <ul className="divide-y divide-border">
            {org.sites.map((site) => (
              <li key={site.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="grid h-9 min-w-12 place-items-center rounded-lg bg-accent px-2 font-mono text-xs font-semibold text-accent-foreground">
                  {site.code}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{site.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[addressLine(site.address), site.phone].filter(Boolean).join(' · ') ||
                      t('sites.noAddress')}
                  </p>
                </div>
                <Badge variant={site.isActive ? 'success' : 'muted'}>
                  {site.isActive ? t('active') : t('inactive')}
                </Badge>
                {org.canEdit && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!online}
                      onClick={() => setSiteEditor(site)}
                      aria-label={`${t('edit')} ${site.code}`}
                    >
                      <Pencil />
                      {t('edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!online}
                      onClick={() => void toggle('/api/v1/sites', site.id, !site.isActive)}
                    >
                      <Power />
                      {site.isActive ? t('deactivate') : t('reactivate')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('departments.title')}</CardTitle>
            <CardDescription className="mt-1">{t('departments.text')}</CardDescription>
          </div>
          {org.canEdit && depEditor === null && firstActiveSite && (
            <Button size="sm" disabled={!online} onClick={() => setDepEditor('new')}>
              <Plus />
              {t('departments.add')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {depEditor !== null && firstActiveSite && (
            <DepartmentForm
              key={depEditor === 'new' ? 'new' : depEditor.id}
              sites={org.sites}
              editing={depEditor !== 'new'}
              initial={
                depEditor === 'new'
                  ? {
                      siteId: firstActiveSite.id,
                      code: '',
                      name: '',
                      kind: 'clinical',
                      costCenterCode: '',
                    }
                  : {
                      siteId: depEditor.siteId,
                      code: depEditor.code,
                      name: depEditor.name,
                      kind: depEditor.kind,
                      costCenterCode: depEditor.costCenterCode ?? '',
                    }
              }
              onCancel={() => setDepEditor(null)}
              onSubmit={async (draft) => {
                if (depEditor === 'new') await send('/api/v1/departments', 'POST', draft);
                else
                  await send('/api/v1/departments', 'PATCH', {
                    id: depEditor.id,
                    name: draft.name,
                    kind: draft.kind,
                    costCenterCode: draft.costCenterCode,
                  });
                setDepEditor(null);
              }}
            />
          )}
          {org.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('departments.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {org.departments.map((dep) => (
                <li key={dep.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="grid h-9 min-w-14 place-items-center rounded-lg bg-muted px-2 font-mono text-xs font-semibold">
                    {dep.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{dep.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(`departments.kinds.${dep.kind}`)} · {sitesById.get(dep.siteId)?.code ?? ''}
                      {dep.costCenterCode ? ` · ${dep.costCenterCode}` : ''}
                    </p>
                  </div>
                  <Badge variant={dep.isActive ? 'success' : 'muted'}>
                    {dep.isActive ? t('active') : t('inactive')}
                  </Badge>
                  {org.canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!online}
                        onClick={() => setDepEditor(dep)}
                        aria-label={`${t('edit')} ${dep.code}`}
                      >
                        <Pencil />
                        {t('edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!online}
                        onClick={() => void toggle('/api/v1/departments', dep.id, !dep.isActive)}
                      >
                        <Power />
                        {dep.isActive ? t('deactivate') : t('reactivate')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
