'use client';

import { NOTE_SECTIONS, type NoteSection } from '@medhub/domain';
import { AppError } from '@medhub/shared';
import type { LocalEntity } from '@medhub/sync/client';
import { FileSignature, Loader2, PenLine } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Sections = Record<NoteSection, string>;
const EMPTY: Sections = { complaint: '', history: '', examination: '', assessment: '', plan: '' };
/** docs/07-ui-ux.md section 7: no typing is lost, a draft every five seconds. */
const DRAFT_EVERY_MS = 5_000;

const sectionsOf = (e: LocalEntity): Sections => {
  const raw = (e.data.sections ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    NOTE_SECTIONS.map((k) => [k, typeof raw[k] === 'string' ? (raw[k] as string) : '']),
  ) as Sections;
};

/**
 * Consultation note (docs/07-ui-ux.md 5.3): written as an encrypted local
 * draft, signed in one action (offline included). A signed note is locked; a
 * correction is a new signed version, the previous one stays readable.
 */
export function NoteEditor({
  patientId,
  encounterId,
  notes,
  onSigned,
}: {
  patientId: string;
  encounterId: string | null;
  notes: LocalEntity[];
  onSigned?: () => Promise<void>;
}) {
  const t = useTranslations('consultation.note');
  const tErr = useTranslations('errors');
  const format = useFormatter();
  const { store, dispatch, identity, catalogs } = useRuntime();
  const draftKey = `note:${patientId}:${encounterId ?? 'none'}`;
  const [sections, setSections] = useState<Sections>(EMPTY);
  const [correcting, setCorrecting] = useState<LocalEntity | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const loaded = useRef(false);
  const canSign = identity?.permissions.includes('clinical_record:sign') ?? false;
  const staff = catalogs?.snapshot.staff ?? [];

  useEffect(() => {
    if (!store || loaded.current) return;
    loaded.current = true;
    void store.loadDraft<Sections>(draftKey).then((draft) => {
      // Restoring the draft of an interrupted session is the purpose of this effect.
      if (draft) setSections({ ...EMPTY, ...draft });
    });
  }, [store, draftKey]);

  useEffect(() => {
    if (!store) return;
    const timer = setInterval(() => {
      const empty = NOTE_SECTIONS.every((k) => sections[k].trim() === '');
      void (empty ? store.deleteDraft(draftKey) : store.saveDraft(draftKey, sections));
    }, DRAFT_EVERY_MS);
    return () => clearInterval(timer);
  }, [store, draftKey, sections]);

  const signed = notes
    .filter((n) => !n.rejected)
    .sort((a, b) => String(b.data.signedAt).localeCompare(String(a.data.signedAt)));
  const filled = NOTE_SECTIONS.some((k) => sections[k].trim() !== '');

  async function sign() {
    setBusy(true);
    setMessage(null);
    try {
      await dispatch('clinical_note.sign', {
        patientId,
        encounterId,
        kind: 'consultation',
        sections: Object.fromEntries(
          NOTE_SECTIONS.map((k) => [k, sections[k].trim() || null]),
        ) as Record<NoteSection, string | null>,
        signedAt: new Date().toISOString(),
        supersedesId: correcting?.id ?? null,
        correctionReason: correcting ? reason.trim() : null,
      });
      await store?.deleteDraft(draftKey);
      await onSigned?.();
      setSections(EMPTY);
      setCorrecting(null);
      setReason('');
      setMessage({ ok: true, text: t('signed') });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: tErr.has(code) ? tErr(code) : tErr('UNKNOWN') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4 text-primary" aria-hidden />
          {correcting ? t('correctTitle') : t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {canSign ? (
          <div className="grid gap-3">
            {NOTE_SECTIONS.map((k) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`note-${k}`}>{t(`sections.${k}`)}</Label>
                <Textarea
                  id={`note-${k}`}
                  rows={k === 'complaint' ? 1 : 3}
                  value={sections[k]}
                  onChange={(e) => setSections({ ...sections, [k]: e.target.value })}
                />
              </div>
            ))}
            {correcting && (
              <div className="grid gap-1.5">
                <Label htmlFor="note-reason">{t('correctionReason')}</Label>
                <Input
                  id="note-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void sign()}
                disabled={busy || !filled || (correcting !== null && reason.trim().length < 3)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <FileSignature />}
                {t('sign')}
              </Button>
              {correcting && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCorrecting(null);
                    setSections(EMPTY);
                  }}
                >
                  {t('cancel')}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{t('draftHint')}</span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t('readOnly')}</p>
        )}
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-success' : 'text-danger'}
          >
            {message.text}
          </p>
        )}
        {signed.length > 0 && (
          <ul className="grid gap-3">
            {signed.map((n) => {
              const s = sectionsOf(n);
              const superseded = n.data.status === 'superseded';
              const author = staff.find((u) => u.id === (n.data.signedBy ?? n.createdBy));
              return (
                <li key={n.id} className="grid gap-1 rounded-xl p-3 ring-1 ring-border">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <FileSignature className="size-3.5" aria-hidden />
                    {t('signedBy', {
                      name: [author?.title, author?.displayName].filter(Boolean).join(' ') || '',
                      date: format.dateTime(new Date(String(n.data.signedAt)), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                    {superseded && <Badge variant="muted">{t('superseded')}</Badge>}
                    {n.version === 0 && <Badge variant="muted">{t('pending')}</Badge>}
                  </p>
                  {NOTE_SECTIONS.filter((k) => s[k]).map((k) => (
                    <p key={k} className={superseded ? 'text-muted-foreground line-through' : ''}>
                      <span className="font-medium">{t(`sections.${k}`)} : </span>
                      {s[k]}
                    </p>
                  ))}
                  {typeof n.data.correctionReason === 'string' && (
                    <p className="text-xs text-muted-foreground">
                      {t('correctedBecause', { reason: n.data.correctionReason })}
                    </p>
                  )}
                  {canSign && !superseded && !correcting && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="justify-self-start"
                      onClick={() => {
                        setCorrecting(n);
                        setSections(s);
                      }}
                    >
                      {t('correct')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
