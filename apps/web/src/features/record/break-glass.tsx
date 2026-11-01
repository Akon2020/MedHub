'use client';

import {
  BREAK_GLASS_REASONS,
  sensitivityAllowed,
  type BreakGlassGrant,
  type BreakGlassReason,
} from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { Loader2, LockKeyhole, Siren } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function toGrant(entity: LocalEntity): BreakGlassGrant {
  return {
    patientId: String(entity.data.patientId ?? ''),
    // Rows created here carry their author in createdBy, rows pulled back in data.
    userId: typeof entity.data.userId === 'string' ? entity.data.userId : entity.createdBy,
    startedAt: String(entity.data.startedAt ?? ''),
    endsAt: String(entity.data.endsAt ?? ''),
  };
}

/** Whether names and details of this record may show in lists for the current user. */
export function useRecordVisibility(): (data: Record<string, unknown>) => boolean {
  const { identity } = useRuntime();
  const max = identity?.sensitivityMax ?? 'normal';
  return (data) => sensitivityAllowed(data.sensitivity ?? 'normal', max);
}

/**
 * Emergency access form: reason mandatory, limited duration, works offline;
 * the access is reviewed afterwards by the person in charge.
 */
export function BreakGlassForm({
  patientId,
  onStarted,
}: {
  patientId: string;
  onStarted?: () => void;
}) {
  const t = useTranslations('record.breakGlass');
  const tErr = useTranslations('errors');
  const { dispatch, identity, breakGlassHours } = useRuntime();
  const [reason, setReason] = useState<BreakGlassReason>('life_threatening');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = identity?.permissions.includes('clinical_record:break_glass') ?? false;

  if (!allowed) return <p className="text-sm text-muted-foreground">{t('notAllowed')}</p>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      await dispatch('break_glass.start', {
        patientId,
        reasonCode: reason,
        reasonText: text.trim(),
        startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + breakGlassHours * 3_600_000).toISOString(),
      });
      onStarted?.();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setError(tErr.has(code) ? tErr(code) : tErr('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 text-sm" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="break-glass-reason">{t('reason')}</Label>
        <NativeSelect
          id="break-glass-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as BreakGlassReason)}
        >
          {BREAK_GLASS_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="break-glass-text">{t('details')}</Label>
        <Textarea
          id="break-glass-text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="destructive" disabled={busy || text.trim().length < 5}>
          {busy ? <Loader2 className="animate-spin" /> : <Siren />}
          {t('open', { hours: breakGlassHours })}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </form>
  );
}

/** What a user sees instead of a record above their level, until an emergency access. */
export function LockedRecord({ patientId, mrn }: { patientId: string; mrn: string }) {
  const t = useTranslations('record.breakGlass');
  return (
    <section className="card-surface mx-auto grid max-w-xl gap-4 p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <LockKeyhole className="size-5 text-danger" aria-hidden />
        {t('lockedTitle')}
      </h1>
      <p className="font-mono text-sm text-slate-ink">{mrn}</p>
      <p className="text-sm text-muted-foreground">{t('lockedText')}</p>
      <BreakGlassForm patientId={patientId} />
    </section>
  );
}

export function EmergencyBanner({ endsAt }: { endsAt: string }) {
  const t = useTranslations('record.breakGlass');
  const format = useFormatter();
  return (
    <p
      role="status"
      className="mb-6 flex items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      <Siren className="size-4 shrink-0" aria-hidden />
      {t('active', {
        time: format.dateTime(new Date(endsAt), { hour: '2-digit', minute: '2-digit' }),
      })}
    </p>
  );
}
