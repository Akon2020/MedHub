'use client';

import { Laptop, Loader2, Monitor, Smartphone, Tablet, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStepUp } from '@/features/auth/step-up';

type Device = {
  id: string;
  deviceCode: string;
  name: string;
  kind: 'desktop' | 'laptop' | 'tablet' | 'phone';
  user: string | null;
  status: 'active' | 'revoked' | 'lost';
  registeredAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  appVersion: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  current: boolean;
};

const KIND_ICONS = { desktop: Monitor, laptop: Laptop, tablet: Tablet, phone: Smartphone };
const STATUS_BADGES = { active: 'success', revoked: 'muted', lost: 'danger' } as const;
const KNOWN_ERRORS = new Set([
  'DEVICE_IS_CURRENT',
  'DEVICE_ALREADY_REVOKED',
  'PERMISSION_DENIED',
  'VALIDATION_FAILED',
  'AUTH_STEP_UP_REQUIRED',
]);

function RevokeForm({
  device,
  mode,
  onDone,
  onCancel,
  guard,
}: {
  device: Device;
  mode: 'revoked' | 'lost';
  onDone: () => Promise<void>;
  onCancel: () => void;
  guard: <T>(task: () => Promise<T>) => Promise<T>;
}) {
  const t = useTranslations('settings.devices');
  const te = useTranslations('settings.errors');
  const [reason, setReason] = useState('');
  const [allowFinalPush, setAllowFinalPush] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await guard(() =>
        apiFetch('/api/v1/devices/revoke', {
          method: 'POST',
          body: JSON.stringify({
            deviceId: device.id,
            status: mode,
            reason,
            allowFinalPush: mode === 'revoked' && allowFinalPush,
          }),
        }),
      );
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? KNOWN_ERRORS.has(err.code)
            ? t(`errors.${err.code}`)
            : te('UNKNOWN')
          : te('NETWORK'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 grid gap-3 rounded-xl bg-muted/50 p-4 ring-1 ring-border"
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        {mode === 'lost' ? t('lostWarning') : t('revokeWarning')}
      </p>
      <div className="grid gap-2">
        <Label htmlFor={`reason-${device.id}`}>{t('reason')}</Label>
        <Textarea
          id={`reason-${device.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-16"
          autoFocus
        />
      </div>
      {mode === 'revoked' && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={allowFinalPush}
            onChange={(e) => setAllowFinalPush(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          {t('allowFinalPush')}
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={mode === 'lost' ? 'destructive' : 'default'}
          disabled={busy || reason.trim().length < 3}
        >
          {busy && <Loader2 className="animate-spin" />}
          {mode === 'lost' ? t('confirmLost') : t('confirmRevoke')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Online-only list of the structure's devices, with retirement and loss declaration. */
export function DevicesSettings() {
  const t = useTranslations('settings.devices');
  const ts = useTranslations('settings');
  const format = useFormatter();
  const online = useOnline();
  const { identity } = useRuntime();
  const canRevoke = identity?.permissions.includes('device:revoke') ?? false;
  const { guard, dialog } = useStepUp();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; mode: 'revoked' | 'lost' } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDevices((await apiFetch<{ devices: Device[] }>('/api/v1/devices')).devices);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PERMISSION_DENIED'
          ? ts('errors.PERMISSION_DENIED')
          : ts('errors.NETWORK'),
      );
    }
  }, [ts]);

  useEffect(() => {
    if (!online) return;
    // Loading on mount and on reconnection is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [online, refresh]);

  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : t('never');

  if (!online && !devices) {
    return (
      <div className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{ts('offline')}</p>
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!devices) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  return (
    <Card>
      {dialog}
      <CardContent className="pt-5">
        <p className="mb-2 text-sm text-muted-foreground">{t('diskHint')}</p>
        <ul className="divide-y divide-border">
          {devices.map((device) => {
            const Icon = KIND_ICONS[device.kind] ?? Monitor;
            return (
              <li key={device.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {device.deviceCode}
                      </span>
                      {device.name}
                      {device.current && (
                        <Badge variant="info" className="ml-2 align-middle">
                          {t('current')}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        device.user,
                        t('lastSync', { date: when(device.lastSyncAt) }),
                        device.appVersion ? `v${device.appVersion}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {device.revokedReason && (
                      <p className="text-xs text-muted-foreground">
                        {t('revokedOn', { date: when(device.revokedAt) })} : {device.revokedReason}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_BADGES[device.status]}>
                    {t(`status.${device.status}`)}
                  </Badge>
                  {canRevoke && device.status === 'active' && !device.current && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!online}
                        onClick={() => setEditing({ id: device.id, mode: 'revoked' })}
                      >
                        {t('revoke')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        disabled={!online}
                        onClick={() => setEditing({ id: device.id, mode: 'lost' })}
                      >
                        {t('lost')}
                      </Button>
                    </div>
                  )}
                </div>
                {editing?.id === device.id && (
                  <RevokeForm
                    device={device}
                    mode={editing.mode}
                    guard={guard}
                    onCancel={() => setEditing(null)}
                    onDone={async () => {
                      setEditing(null);
                      await refresh();
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
