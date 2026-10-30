'use client';

import { grantChanges, isPrivilegedRole, templateGrants, type RoleGrant } from '@medhub/domain';
import {
  PERMISSION_CATALOG,
  PRIVILEGED_PERMISSIONS,
  RESOURCE_SCOPES,
  type PermissionScope,
} from '@medhub/shared';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useStepUp } from '@/features/auth/step-up';
import { cn } from '@/lib/utils';

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPrivileged: boolean;
  requiresMfa: boolean;
  templateCode: string | null;
  version: number;
  members: number;
  grants: RoleGrant[];
};

type Overview = { roles: Role[]; canManage: boolean };
type Selection = { kind: 'new'; copyFrom: string | null } | { kind: 'role'; id: string } | null;
type Run = <T>(path: string, body: unknown) => Promise<T | null>;

const KNOWN_ERRORS = new Set([
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
  'ROLE_CODE_TAKEN',
  'USER_LAST_ADMIN',
]);

/** Resources grouped as in the application menu. */
const GROUPS: { key: string; resources: string[] }[] = [
  {
    key: 'care',
    resources: [
      'patient',
      'encounter',
      'appointment',
      'queue',
      'triage',
      'clinical_record',
      'vital_sign',
      'diagnosis',
      'prescription',
      'medication_administration',
    ],
  },
  { key: 'lab', resources: ['lab_order', 'lab_result'] },
  { key: 'pharmacy', resources: ['dispensation', 'stock', 'controlled_substance'] },
  {
    key: 'finance',
    resources: [
      'invoice',
      'payment',
      'cash_session',
      'price',
      'contract',
      'beneficiary',
      'prior_authorization',
      'payer_invoice',
    ],
  },
  {
    key: 'administration',
    resources: [
      'form',
      'configuration',
      'user',
      'role',
      'device',
      'report',
      'audit',
      'approval',
      'account',
      'support',
    ],
  },
];

function PermissionGrid({
  grants,
  editable,
  onChange,
}: {
  grants: RoleGrant[];
  editable: boolean;
  onChange: (grants: RoleGrant[]) => void;
}) {
  const t = useTranslations('settings.roles');
  const byKey = new Map(grants.map((g) => [g.key, g.scope]));

  function toggle(key: string, on: boolean, scope: PermissionScope) {
    onChange(on ? [...grants, { key, scope }] : grants.filter((g) => g.key !== key));
  }

  function rescope(resource: string, scope: PermissionScope) {
    onChange(grants.map((g) => (g.key.startsWith(`${resource}:`) ? { ...g, scope } : g)));
  }

  return (
    <div className="grid gap-5">
      {GROUPS.map((group) => (
        <section key={group.key} className="grid gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t(`groups.${group.key}`)}
          </h4>
          <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
            {group.resources.map((resource) => {
              const actions = PERMISSION_CATALOG[resource] ?? [];
              const scopes = RESOURCE_SCOPES[resource] ?? ['tenant'];
              const granted = actions.filter((a) => byKey.has(`${resource}:${a}`));
              const first = granted[0];
              const scope: PermissionScope =
                (first ? byKey.get(`${resource}:${first}`) : undefined) ?? 'tenant';
              return (
                <li key={resource} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[11rem_1fr]">
                  <div className="grid content-start gap-1.5">
                    <span className="text-sm font-medium">{t(`resources.${resource}`)}</span>
                    {scopes.length > 1 && granted.length > 0 && (
                      <NativeSelect
                        aria-label={t('scopeOf', { resource: t(`resources.${resource}`) })}
                        value={scope}
                        disabled={!editable}
                        onChange={(e) => rescope(resource, e.target.value as PermissionScope)}
                        className="h-9 text-[13px]"
                      >
                        {scopes.map((s) => (
                          <option key={s} value={s}>
                            {t(`scopes.${s}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                  <div className="flex flex-wrap content-start gap-1.5">
                    {actions.map((action) => {
                      const key = `${resource}:${action}`;
                      const on = byKey.has(key);
                      return (
                        <label
                          key={key}
                          title={key}
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ring-1 ring-border transition-colors',
                            on
                              ? 'bg-accent text-accent-foreground ring-primary/40'
                              : 'hover:bg-muted/50',
                            !editable && 'cursor-not-allowed opacity-70',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[var(--primary)]"
                            checked={on}
                            disabled={!editable}
                            aria-label={`${t(`resources.${resource}`)} : ${t(`actions.${action}`)}`}
                            onChange={(e) => toggle(key, e.target.checked, scope)}
                          />
                          {t(`actions.${action}`)}
                          {PRIVILEGED_PERMISSIONS.has(key) && (
                            <ShieldCheck className="size-3.5 text-primary" aria-hidden />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RoleEditor({
  role,
  canManage,
  run,
  onSaved,
  onDuplicate,
}: {
  role: Role;
  canManage: boolean;
  run: Run;
  onSaved: () => void;
  onDuplicate: () => void;
}) {
  const t = useTranslations('settings.roles');
  const online = useOnline();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [requiresMfa, setRequiresMfa] = useState(role.requiresMfa);
  const [grants, setGrants] = useState<RoleGrant[]>(role.grants);
  const [busy, setBusy] = useState(false);
  const privileged = isPrivilegedRole(
    role.templateCode,
    grants.map((g) => g.key),
  );
  const changes = grantChanges(role.grants, grants);
  const pending = changes.added.length + changes.removed.length + changes.rescoped.length;
  const template = templateGrants(role.templateCode);
  const templateDiff = template ? grantChanges(template, grants) : null;
  const templateDifferences = templateDiff
    ? templateDiff.added.length + templateDiff.removed.length + templateDiff.rescoped.length
    : 0;
  const dirty =
    pending > 0 ||
    name !== role.name ||
    description !== (role.description ?? '') ||
    requiresMfa !== role.requiresMfa;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const ok = await run('/api/v1/roles/update', {
        roleId: role.id,
        name,
        description,
        requiresMfa: privileged || requiresMfa,
        grants,
      });
      if (ok) onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="role-name">{t('fields.name')}</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="role-code">{t('fields.code')}</Label>
          <Input id="role-code" value={role.code} disabled />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="role-description">{t('fields.description')}</Label>
          <Textarea
            id="role-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canManage}
            rows={2}
          />
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--primary)]"
          checked={privileged || requiresMfa}
          disabled={!canManage || privileged}
          onChange={(e) => setRequiresMfa(e.target.checked)}
        />
        <span>
          <span className="font-medium">{t('fields.requiresMfa')}</span>
          <span className="block text-xs text-muted-foreground">
            {privileged ? t('privilegedHint') : t('requiresMfaHint')}
          </span>
        </span>
      </label>

      {template && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1">
            {templateDifferences === 0
              ? t('template.same')
              : t('template.differs', { count: templateDifferences })}
          </span>
          {canManage && templateDifferences > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setGrants(template)}>
              <RotateCcw />
              {t('template.restore')}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">{t('permissionsTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('permissionsHint')}</p>
      </div>
      <PermissionGrid grants={grants} editable={canManage} onChange={setGrants} />

      {canManage && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-card px-1 py-3">
          <Button type="submit" disabled={busy || !online || !dirty || name.trim().length < 2}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {t('save')}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setName(role.name);
                setDescription(role.description ?? '');
                setRequiresMfa(role.requiresMfa);
                setGrants(role.grants);
              }}
            >
              {t('reset')}
            </Button>
          )}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {pending > 0 &&
              t('pending', {
                added: changes.added.length,
                removed: changes.removed.length,
                rescoped: changes.rescoped.length,
              })}
          </span>
          <Button type="button" variant="secondary" className="ml-auto" onClick={onDuplicate}>
            <Copy />
            {t('duplicate')}
          </Button>
        </div>
      )}
    </form>
  );
}

function NewRoleForm({
  roles,
  copyFrom,
  run,
  onCreated,
}: {
  roles: Role[];
  copyFrom: string | null;
  run: Run;
  onCreated: (roleId: string) => void;
}) {
  const t = useTranslations('settings.roles');
  const online = useOnline();
  const source = roles.find((r) => r.id === copyFrom);
  const [code, setCode] = useState(source ? `${source.code}_copie` : '');
  const [name, setName] = useState(source ? `${source.name} (copie)` : '');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState(copyFrom ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await run<{ roleId: string }>('/api/v1/roles', {
        code,
        name,
        description,
        requiresMfa: false,
        copyFromRoleId: from || null,
      });
      if (created) onCreated(created.roleId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="new-role-name">{t('fields.name')}</Label>
          <Input id="new-role-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-role-code">{t('fields.code')}</Label>
          <Input
            id="new-role-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="new-role-code-hint"
          />
          <p id="new-role-code-hint" className="text-xs text-muted-foreground">
            {t('codeHint')}
          </p>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="new-role-from">{t('fields.copyFrom')}</Label>
          <NativeSelect id="new-role-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{t('emptyRole')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="new-role-description">{t('fields.description')}</Label>
          <Textarea
            id="new-role-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>
      <Button
        type="submit"
        className="justify-self-start"
        disabled={busy || !online || name.trim().length < 2 || code.trim().length < 2}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        {t('create')}
      </Button>
    </form>
  );
}

/** Online-only screen: roles of the structure and their permission grid. */
export function RolesSettings() {
  const t = useTranslations('settings');
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? t(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : t('errors.NETWORK'),
    [t],
  );

  const refresh = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>('/api/v1/roles'));
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
      setSaved(false);
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

  const selected =
    selection?.kind === 'role' ? (overview.roles.find((r) => r.id === selection.id) ?? null) : null;

  return (
    <div className="grid gap-4">
      {dialog}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {t('roles.saved')}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Card className={cn(selection && 'hidden lg:block')}>
          <CardHeader>
            <div>
              <CardTitle>{t('roles.listTitle', { count: overview.roles.length })}</CardTitle>
              <CardDescription className="mt-1">{t('roles.listText')}</CardDescription>
            </div>
            {overview.canManage && (
              <Button
                size="sm"
                disabled={!online}
                onClick={() => setSelection({ kind: 'new', copyFrom: null })}
              >
                <Plus />
                {t('roles.new')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
              {overview.roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(false);
                      setSelection({ kind: 'role', id: role.id });
                    }}
                    aria-current={selection?.kind === 'role' && selection.id === role.id}
                    className={cn(
                      'grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                      selection?.kind === 'role' && selection.id === role.id && 'bg-accent',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{role.name}</span>
                      <span className="flex gap-1">
                        {role.requiresMfa && <Badge variant="info">2FA</Badge>}
                        {role.templateCode && (
                          <Badge variant="muted">{t('roles.template.badge')}</Badge>
                        )}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {role.code} ·{' '}
                      {t('roles.counts', {
                        members: role.members,
                        permissions: role.grants.length,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {selection && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" aria-hidden />
                  {selected ? selected.name : t('roles.newTitle')}
                </CardTitle>
                <CardDescription className="mt-1">
                  {selected
                    ? t('roles.version', { version: selected.version, members: selected.members })
                    : t('roles.newText')}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelection(null)}>
                {t('roles.close')}
              </Button>
            </CardHeader>
            <CardContent>
              {selected ? (
                <RoleEditor
                  key={`${selected.id}-${selected.version}`}
                  role={selected}
                  canManage={overview.canManage}
                  run={run}
                  onSaved={() => {
                    setSaved(true);
                    void refresh();
                  }}
                  onDuplicate={() => setSelection({ kind: 'new', copyFrom: selected.id })}
                />
              ) : (
                <NewRoleForm
                  key={selection.kind === 'new' ? (selection.copyFrom ?? 'empty') : 'x'}
                  roles={overview.roles}
                  copyFrom={selection.kind === 'new' ? selection.copyFrom : null}
                  run={run}
                  onCreated={(roleId) => {
                    setSelection({ kind: 'role', id: roleId });
                    void refresh();
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
