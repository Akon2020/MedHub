'use client';

import { MERGE_FIELDS, type MergeField } from '@medhub/domain';
import { GitMerge, Loader2, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type MergeRecord = {
  id: string;
  mrn: string;
  familyName: string;
  middleName: string | null;
  givenName: string | null;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  createdAt: string;
};

type Side = 'survivor' | 'merged';

function fieldValue(record: MergeRecord, field: MergeField): string {
  if (field === 'birthDate') {
    if (!record.birthDate) return '';
    return record.birthDateEstimated ? `${record.birthDate.slice(0, 4)} (~)` : record.birthDate;
  }
  return record[field] ?? '';
}

/**
 * Side-by-side choice of the record to keep and of each differing value. The
 * other record is not erased: it points to the survivor and can be restored.
 */
export function MergePanel({
  a,
  b,
  candidateId,
  run,
  onCancel,
}: {
  a: MergeRecord;
  b: MergeRecord;
  candidateId: string;
  run: (path: string, body: unknown) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useTranslations('patients.merge');
  const tq = useTranslations('patients.queue');
  const online = useOnline();
  // The record registered first is kept by default: it usually carries the history.
  const [survivorIsA, setSurvivorIsA] = useState(a.createdAt <= b.createdAt);
  const survivor = survivorIsA ? a : b;
  const merged = survivorIsA ? b : a;
  const differing = MERGE_FIELDS.filter((f) => fieldValue(a, f) !== fieldValue(b, f));
  const [keep, setKeep] = useState<Partial<Record<MergeField, Side>>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // An empty value on the survivor takes the other record's value by default.
  const sideOf = (field: MergeField): Side =>
    keep[field] ?? (fieldValue(survivor, field) === '' ? 'merged' : 'survivor');

  async function submit() {
    setBusy(true);
    try {
      await run('/api/v1/patients/merge', {
        survivorId: survivor.id,
        mergedId: merged.id,
        keep: Object.fromEntries(differing.map((f) => [f, sideOf(f)])),
        reason,
        candidateId,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 rounded-xl p-4 ring-1 ring-primary/40">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('survivor')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[a, b].map((record, i) => (
            <label
              key={record.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-border',
                record.id === survivor.id && 'bg-accent ring-primary/40',
              )}
            >
              <input
                type="radio"
                name={`survivor-${candidateId}`}
                className="accent-[var(--primary)]"
                checked={record.id === survivor.id}
                onChange={() => {
                  setSurvivorIsA(i === 0);
                  setKeep({});
                }}
              />
              {tq(i === 0 ? 'recordA' : 'recordB')} ·{' '}
              <span className="font-mono text-xs">{record.mrn}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {differing.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t('values')}</p>
          {differing.map((field) => (
            <div key={field} className="grid gap-1.5 sm:grid-cols-[9rem_1fr_1fr] sm:items-center">
              <span className="text-xs text-muted-foreground">{t(`fields.${field}`)}</span>
              {(['survivor', 'merged'] as const).map((side) => {
                const record = side === 'survivor' ? survivor : merged;
                return (
                  <label
                    key={side}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-border',
                      sideOf(field) === side && 'bg-accent ring-primary/40',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${candidateId}-${field}`}
                      aria-label={`${t(`fields.${field}`)} : ${fieldValue(record, field) || t('empty')}`}
                      className="accent-[var(--primary)]"
                      checked={sideOf(field) === side}
                      onChange={() => setKeep((k) => ({ ...k, [field]: side }))}
                    />
                    {fieldValue(record, field) || (
                      <span className="text-muted-foreground">{t('empty')}</span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('identical')}</p>
      )}

      <p className="text-xs text-muted-foreground">{t('effect')}</p>
      <div className="grid gap-2">
        <Label htmlFor={`merge-reason-${candidateId}`}>{tq('reason')}</Label>
        <Input
          id={`merge-reason-${candidateId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('reasonPlaceholder')}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !online || reason.trim().length < 3}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <GitMerge />}
          {t('confirm')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {tq('cancel')}
        </Button>
      </div>
    </div>
  );
}

type MergeView = {
  id: string;
  status: 'active' | 'undone';
  survivor: { id: string; name: string; mrn: string };
  merged: { id: string; name: string; mrn: string };
  fields: string[];
  reason: string;
  createdAt: string;
  undoneAt: string | null;
};

/** Recent merges of the structure; an active one can be undone with a reason. */
export function RecentMerges({
  version,
  run,
}: {
  version: number;
  run: (path: string, body: unknown) => Promise<boolean>;
}) {
  const t = useTranslations('patients.merge');
  const tq = useTranslations('patients.queue');
  const format = useFormatter();
  const online = useOnline();
  const [merges, setMerges] = useState<MergeView[]>([]);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setMerges((await apiFetch<{ merges: MergeView[] }>('/api/v1/patients/merges')).merges);
    } catch {
      setMerges([]);
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    // Reloaded after every merge or undo (version) and on reconnection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [online, load, version]);

  if (merges.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recentTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {merges.map((m) => (
            <li key={m.id} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.merged.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{m.merged.mrn}</span>
                  {' → '}
                  <span className="font-medium">{m.survivor.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{m.survivor.mrn}</span>
                </span>
                <Badge variant={m.status === 'active' ? 'success' : 'muted'}>
                  {t(`status.${m.status}`)}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {format.dateTime(new Date(m.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                {' · '}
                {m.reason}
              </span>
              {m.status === 'active' &&
                (undoing === m.id ? (
                  <div className="grid gap-2 rounded-lg p-3 ring-1 ring-border">
                    <Label htmlFor={`undo-${m.id}`}>{tq('reason')}</Label>
                    <Input
                      id={`undo-${m.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!online || reason.trim().length < 3}
                        onClick={async () => {
                          if (await run('/api/v1/patients/unmerge', { mergeId: m.id, reason })) {
                            setUndoing(null);
                            setReason('');
                          }
                        }}
                      >
                        <Undo2 />
                        {t('undoConfirm')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setUndoing(null)}>
                        {tq('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    disabled={!online}
                    onClick={() => setUndoing(m.id)}
                  >
                    <Undo2 />
                    {t('undo')}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
