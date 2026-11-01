'use client';

import type { PatientScopeRule } from '@medhub/domain';
import { Check, Loader2, Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';

type View = {
  defaultRule: PatientScopeRule | null;
  roles: { roleId: string; name: string; rule: PatientScopeRule | null }[];
  builtIn: PatientScopeRule;
  canEdit: boolean;
};

type Choice = '' | 'all' | 'scoped';

function RuleRow({
  label,
  rule,
  inherit,
  canEdit,
  onSave,
}: {
  label: string;
  rule: PatientScopeRule | null;
  inherit: string;
  canEdit: boolean;
  onSave: (rule: PatientScopeRule | null) => Promise<void>;
}) {
  const t = useTranslations('settings.scope');
  const [mode, setMode] = useState<Choice>(rule?.mode ?? '');
  const [days, setDays] = useState(String(rule?.recentDays ?? 30));
  const [busy, setBusy] = useState(false);
  const next: PatientScopeRule | null =
    mode === '' ? null : { mode, recentDays: Math.min(365, Math.max(1, Number(days) || 30)) };
  const dirty = JSON.stringify(next) !== JSON.stringify(rule);

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_14rem_7rem_auto] sm:items-center">
      <span className="font-medium">{label}</span>
      <NativeSelect
        aria-label={t('mode')}
        value={mode}
        disabled={!canEdit}
        onChange={(e) => setMode(e.target.value as Choice)}
      >
        <option value="">{inherit}</option>
        <option value="all">{t('modes.all')}</option>
        <option value="scoped">{t('modes.scoped')}</option>
      </NativeSelect>
      <Input
        aria-label={t('recentDays')}
        inputMode="numeric"
        value={mode === 'scoped' ? days : ''}
        disabled={!canEdit || mode !== 'scoped'}
        placeholder={t('days')}
        onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
      />
      {canEdit && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(next);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {t('save')}
        </Button>
      )}
    </li>
  );
}

/**
 * Which patients each workstation keeps (docs/02-offline-sync.md section 8):
 * the whole structure, or a scope made of the patients created on the device,
 * the user's favourites, those opened from a server search and recent activity.
 */
export function SyncScopeSettings() {
  const t = useTranslations('settings.scope');
  const ts = useTranslations('settings');
  const online = useOnline();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await apiFetch<View>('/api/v1/sync/scope'));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PERMISSION_DENIED'
          ? ts('errors.PERMISSION_DENIED')
          : ts('errors.UNKNOWN'),
      );
    }
  }, [ts]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  async function save(roleId: string | null, rule: PatientScopeRule | null) {
    setNotice(null);
    try {
      await apiFetch('/api/v1/sync/scope', {
        method: 'POST',
        body: JSON.stringify({ roleId, rule }),
      });
      setNotice(t('saved'));
      await refresh();
    } catch {
      setError(ts('errors.UNKNOWN'));
    }
  }

  const builtIn = view ? t('builtIn', { rule: t(`modes.${view.builtIn.mode}`) }) : '';

  return (
    <Card className="mt-6">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radar className="size-4 text-primary" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription className="mt-1">{t('subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!online && <p className="text-muted-foreground">{ts('offline')}</p>}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-success">
            {notice}
          </p>
        )}
        {view && (
          <>
            <p className="text-muted-foreground">{t('hint')}</p>
            <ul className="divide-y divide-border">
              <RuleRow
                key={`default-${JSON.stringify(view.defaultRule)}`}
                label={t('default')}
                rule={view.defaultRule}
                inherit={builtIn}
                canEdit={view.canEdit}
                onSave={(rule) => save(null, rule)}
              />
              {view.roles.map((role) => (
                <RuleRow
                  key={`${role.roleId}-${JSON.stringify(role.rule)}`}
                  label={role.name}
                  rule={role.rule}
                  inherit={t('inherit')}
                  canEdit={view.canEdit}
                  onSave={(rule) => save(role.roleId, rule)}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
