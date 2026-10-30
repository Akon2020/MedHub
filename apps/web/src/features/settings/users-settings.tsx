'use client';

import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  Search,
  ShieldOff,
  UserCheck,
  UserPlus,
  UserX,
  WifiOff,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { useStepUp } from '@/features/auth/step-up';
import { cn } from '@/lib/utils';

type User = {
  id: string;
  username: string;
  displayName: string;
  title: string | null;
  professionalNumber: string | null;
  phone: string | null;
  email: string | null;
  locale: 'fr' | 'en';
  defaultSiteId: string | null;
  defaultDepartmentId: string | null;
  status: 'active' | 'disabled' | 'locked';
  lockedUntil: string | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roleIds: string[];
  self: boolean;
};

type Overview = {
  users: User[];
  roles: { id: string; code: string; name: string; isPrivileged: boolean; requiresMfa: boolean }[];
  sites: { id: string; code: string; name: string; isActive: boolean }[];
  departments: { id: string; siteId: string; code: string; name: string; isActive: boolean }[];
  can: { create: boolean; update: boolean; disable: boolean; resetPassword: boolean };
};

type Run = <T>(path: string, body: unknown) => Promise<T | null>;
type Selection = { kind: 'new' } | { kind: 'user'; id: string } | null;
type Revealed = { name: string; password: string };

const KNOWN_ERRORS = new Set([
  'VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'AUTH_STEP_UP_REQUIRED',
  'AUTH_MFA_NOT_ENROLLED',
  'USER_USERNAME_TAKEN',
  'USER_LAST_ADMIN',
  'USER_IS_SELF',
  'USER_ROLE_UNKNOWN',
]);

function StatusBadges({ user }: { user: User }) {
  const t = useTranslations('settings.users');
  return (
    <span className="flex flex-wrap gap-1">
      {user.status === 'disabled' ? (
        <Badge variant="muted">{t('status.disabled')}</Badge>
      ) : user.lockedUntil ? (
        <Badge variant="danger">{t('status.locked')}</Badge>
      ) : (
        <Badge variant="success">{t('status.active')}</Badge>
      )}
      {user.mfaEnabled && <Badge variant="info">{t('mfaOn')}</Badge>}
      {user.mustChangePassword && user.status !== 'disabled' && (
        <Badge variant="warning">{t('mustChange')}</Badge>
      )}
    </span>
  );
}

function TemporaryPassword({ revealed, onClose }: { revealed: Revealed; onClose: () => void }) {
  const t = useTranslations('settings.users.temporary');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(revealed.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="grid gap-3 rounded-xl bg-accent p-4 text-sm">
      <p className="font-medium">{t('title', { name: revealed.name })}</p>
      <p className="text-muted-foreground">{t('text')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid="temporary-password"
          className="rounded-lg bg-card px-3 py-2 font-mono text-base tracking-wider ring-1 ring-border"
        >
          {revealed.password}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}

type Draft = {
  username: string;
  displayName: string;
  title: string;
  professionalNumber: string;
  phone: string;
  email: string;
  locale: 'fr' | 'en';
  defaultSiteId: string;
  defaultDepartmentId: string;
  roleIds: string[];
};

function draftOf(user: User | null): Draft {
  return {
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    title: user?.title ?? '',
    professionalNumber: user?.professionalNumber ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    locale: user?.locale ?? 'fr',
    defaultSiteId: user?.defaultSiteId ?? '',
    defaultDepartmentId: user?.defaultDepartmentId ?? '',
    roleIds: user?.roleIds ?? [],
  };
}

function UserEditor({
  overview,
  user,
  run,
  onCreated,
  onSaved,
}: {
  overview: Overview;
  user: User | null;
  run: Run;
  onCreated: (revealed: Revealed, userId: string) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('settings.users');
  const online = useOnline();
  const [draft, setDraft] = useState<Draft>(() => draftOf(user));
  const [busy, setBusy] = useState(false);
  const editable = user ? overview.can.update : overview.can.create;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const departments = overview.departments.filter(
    (d) => d.isActive && (!draft.defaultSiteId || d.siteId === draft.defaultSiteId),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const fields = {
      displayName: draft.displayName,
      title: draft.title,
      professionalNumber: draft.professionalNumber,
      phone: draft.phone,
      email: draft.email,
      locale: draft.locale,
      defaultSiteId: draft.defaultSiteId || null,
      defaultDepartmentId: draft.defaultDepartmentId || null,
      roleIds: draft.roleIds,
    };
    try {
      if (user) {
        if (await run('/api/v1/users/update', { userId: user.id, ...fields })) onSaved();
      } else {
        const created = await run<{ userId: string; temporaryPassword: string }>('/api/v1/users', {
          username: draft.username,
          ...fields,
        });
        if (created) {
          onCreated(
            { name: draft.displayName, password: created.temporaryPassword },
            created.userId,
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const text = (
    key: 'displayName' | 'title' | 'professionalNumber' | 'phone' | 'email',
    extra: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`user-${key}`}>{t(`fields.${key}`)}</Label>
      <Input
        id={`user-${key}`}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        disabled={!editable}
        {...extra}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="user-username">{t('fields.username')}</Label>
          <Input
            id="user-username"
            value={draft.username}
            onChange={(e) => set('username', e.target.value.toLowerCase())}
            disabled={user !== null}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="user-username-hint"
          />
          <p id="user-username-hint" className="text-xs text-muted-foreground">
            {user ? t('usernameFixed') : t('usernameHint')}
          </p>
        </div>
        {text('displayName', { autoComplete: 'off' })}
        {text('title', { placeholder: t('titlePlaceholder') })}
        {text('professionalNumber')}
        {text('phone', { inputMode: 'tel', placeholder: '+243 81 000 0000' })}
        {text('email', { type: 'email' })}
        <div className="grid gap-2">
          <Label htmlFor="user-site">{t('fields.defaultSite')}</Label>
          <NativeSelect
            id="user-site"
            value={draft.defaultSiteId}
            onChange={(e) => {
              set('defaultSiteId', e.target.value);
              set('defaultDepartmentId', '');
            }}
            disabled={!editable}
          >
            <option value="">{t('none')}</option>
            {overview.sites
              .filter((s) => s.isActive || s.id === draft.defaultSiteId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="user-department">{t('fields.defaultDepartment')}</Label>
          <NativeSelect
            id="user-department"
            value={draft.defaultDepartmentId}
            onChange={(e) => set('defaultDepartmentId', e.target.value)}
            disabled={!editable}
          >
            <option value="">{t('none')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="user-locale">{t('fields.locale')}</Label>
          <NativeSelect
            id="user-locale"
            value={draft.locale}
            onChange={(e) => set('locale', e.target.value === 'en' ? 'en' : 'fr')}
            disabled={!editable}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </NativeSelect>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('fields.roles')}</legend>
        <p className="text-xs text-muted-foreground">{t('rolesHint')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {overview.roles.map((role) => {
            const checked = draft.roleIds.includes(role.id);
            return (
              <label
                key={role.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-border transition-colors',
                  checked ? 'bg-accent ring-primary/40' : 'hover:bg-muted/50',
                  !editable && 'cursor-not-allowed opacity-70',
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={checked}
                  disabled={!editable}
                  onChange={(e) =>
                    set(
                      'roleIds',
                      e.target.checked
                        ? [...draft.roleIds, role.id]
                        : draft.roleIds.filter((id) => id !== role.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1">{role.name}</span>
                {(role.isPrivileged || role.requiresMfa) && (
                  <Badge variant="info">{t('roleNeedsMfa')}</Badge>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      {editable && (
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={
              busy ||
              !online ||
              draft.displayName.trim().length < 2 ||
              draft.roleIds.length === 0 ||
              (!user && draft.username.trim().length < 3)
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : user ? <Check /> : <UserPlus />}
            {user ? t('save') : t('create')}
          </Button>
        </div>
      )}
    </form>
  );
}

function ReasonAction({
  id,
  label,
  confirmLabel,
  hint,
  icon: Icon,
  variant,
  onConfirm,
}: {
  id: string;
  label: string;
  confirmLabel: string;
  hint: string;
  icon: typeof UserX;
  variant: 'secondary' | 'destructive';
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const t = useTranslations('settings.users');
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon />
        {label}
      </Button>
    );
  }
  return (
    <form
      className="grid w-full gap-2 rounded-xl p-3 ring-1 ring-border"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onConfirm(reason.trim())
          .then((ok) => {
            if (ok) {
              setOpen(false);
              setReason('');
            }
          })
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm text-muted-foreground">{hint}</p>
      <Label htmlFor={`reason-${id}`}>{t('reason')}</Label>
      <Input
        id={`reason-${id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          variant={variant}
          disabled={busy || !online || reason.trim().length < 3}
        >
          {busy && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function UserActions({
  user,
  can,
  run,
  onReveal,
  onDone,
}: {
  user: User;
  can: Overview['can'];
  run: Run;
  onReveal: (revealed: Revealed) => void;
  onDone: () => void;
}) {
  const t = useTranslations('settings.users.actions');
  const online = useOnline();
  const [busy, setBusy] = useState<string | null>(null);

  if (user.self) return <p className="text-sm text-muted-foreground">{t('self')}</p>;

  async function simple(key: string, path: string, body: unknown) {
    setBusy(key);
    try {
      const result = await run<{ temporaryPassword?: string }>(path, body);
      if (result?.temporaryPassword) {
        onReveal({ name: user.displayName, password: result.temporaryPassword });
      }
      if (result) onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {can.resetPassword && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || !online}
          onClick={() =>
            void simple('password', '/api/v1/users/reset-password', { userId: user.id })
          }
        >
          {busy === 'password' ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {t('resetPassword')}
        </Button>
      )}
      {can.resetPassword && user.lockedUntil && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || !online}
          onClick={() => void simple('unlock', '/api/v1/users/unlock', { userId: user.id })}
        >
          {busy === 'unlock' ? <Loader2 className="animate-spin" /> : <Lock />}
          {t('unlock')}
        </Button>
      )}
      {can.resetPassword && user.mfaEnabled && (
        <ReasonAction
          id={`mfa-${user.id}`}
          label={t('resetMfa')}
          confirmLabel={t('resetMfaConfirm')}
          hint={t('resetMfaHint')}
          icon={ShieldOff}
          variant="destructive"
          onConfirm={async (reason) => {
            const ok = await run('/api/v1/users/reset-mfa', { userId: user.id, reason });
            if (ok) onDone();
            return ok !== null;
          }}
        />
      )}
      {can.disable &&
        (user.status === 'disabled' ? (
          <ReasonAction
            id={`enable-${user.id}`}
            label={t('enable')}
            confirmLabel={t('enableConfirm')}
            hint={t('enableHint')}
            icon={UserCheck}
            variant="secondary"
            onConfirm={async (reason) => {
              const ok = await run('/api/v1/users/status', {
                userId: user.id,
                status: 'active',
                reason,
              });
              if (ok) onDone();
              return ok !== null;
            }}
          />
        ) : (
          <ReasonAction
            id={`disable-${user.id}`}
            label={t('disable')}
            confirmLabel={t('disableConfirm')}
            hint={t('disableHint')}
            icon={UserX}
            variant="destructive"
            onConfirm={async (reason) => {
              const ok = await run('/api/v1/users/status', {
                userId: user.id,
                status: 'disabled',
                reason,
              });
              if (ok) onDone();
              return ok !== null;
            }}
          />
        ))}
    </div>
  );
}

/** Online-only screen: accounts of the structure, roles, resets and deactivation. */
export function UsersSettings() {
  const t = useTranslations('settings');
  const format = useFormatter();
  const online = useOnline();
  const { guard, dialog } = useStepUp();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [query, setQuery] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError
        ? t(`errors.${KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN'}`)
        : t('errors.NETWORK'),
    [t],
  );

  const refresh = useCallback(async () => {
    try {
      setOverview(await apiFetch<Overview>('/api/v1/users'));
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
        const result = await guard(() =>
          apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
        );
        return result;
      } catch (err) {
        setError(describe(err));
        return null;
      }
    },
    [guard, describe],
  );

  const roleNames = useMemo(
    () => new Map((overview?.roles ?? []).map((r) => [r.id, r.name])),
    [overview],
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

  const needle = query.trim().toLowerCase();
  const visible = overview.users.filter(
    (u) =>
      (showDisabled || u.status !== 'disabled') &&
      (!needle || u.displayName.toLowerCase().includes(needle) || u.username.includes(needle)),
  );
  const selected =
    selection?.kind === 'user' ? (overview.users.find((u) => u.id === selection.id) ?? null) : null;
  const disabledCount = overview.users.filter((u) => u.status === 'disabled').length;

  return (
    <div className="grid gap-4">
      {dialog}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {revealed && <TemporaryPassword revealed={revealed} onClose={() => setRevealed(null)} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className={cn(selection && 'hidden lg:block')}>
          <CardHeader>
            <div>
              <CardTitle>{t('users.listTitle', { count: overview.users.length })}</CardTitle>
              <CardDescription className="mt-1">{t('users.listText')}</CardDescription>
            </div>
            {overview.can.create && (
              <Button
                size="sm"
                onClick={() => {
                  setRevealed(null);
                  setSelection({ kind: 'new' });
                }}
                disabled={!online}
              >
                <UserPlus />
                {t('users.new')}
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t('users.search')}
                placeholder={t('users.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {disabledCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={showDisabled}
                  onChange={(e) => setShowDisabled(e.target.checked)}
                />
                {t('users.showDisabled', { count: disabledCount })}
              </label>
            )}
            <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
              {visible.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(null);
                      setSelection({ kind: 'user', id: user.id });
                    }}
                    aria-current={selection?.kind === 'user' && selection.id === user.id}
                    className={cn(
                      'grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                      selection?.kind === 'user' && selection.id === user.id && 'bg-accent',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {user.title ? `${user.title} ` : ''}
                        {user.displayName}
                        {user.self && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t('users.you')})
                          </span>
                        )}
                      </span>
                      <StatusBadges user={user} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {user.username} ·{' '}
                      {user.roleIds.map((id) => roleNames.get(id)).join(', ') || t('users.noRole')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {user.lastLoginAt
                        ? t('users.lastLogin', {
                            date: format.dateTime(new Date(user.lastLoginAt), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
                          })
                        : t('users.neverSignedIn')}
                    </span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {t('users.empty')}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        {selection && (
          <Card className="lg:sticky lg:top-4">
            <CardHeader>
              <div>
                <CardTitle>{selected ? selected.displayName : t('users.newTitle')}</CardTitle>
                <CardDescription className="mt-1">
                  {selected ? <StatusBadges user={selected} /> : t('users.newText')}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelection(null)}>
                {t('users.close')}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-6">
              <UserEditor
                key={selected?.id ?? 'new'}
                overview={overview}
                user={selected}
                run={run}
                onCreated={(value, userId) => {
                  setRevealed(value);
                  setSelection({ kind: 'user', id: userId });
                  void refresh();
                }}
                onSaved={() => void refresh()}
              />
              {selected && (
                <div className="grid gap-3 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">{t('users.actions.title')}</h3>
                  <UserActions
                    key={`${selected.id}-${selected.status}-${String(selected.mfaEnabled)}`}
                    user={selected}
                    can={overview.can}
                    run={run}
                    onReveal={setRevealed}
                    onDone={() => void refresh()}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
