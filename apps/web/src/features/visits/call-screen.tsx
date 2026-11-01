'use client';

import { Maximize, Volume2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useOnline } from '@/client/browser-state';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Button } from '@/components/ui/button';
import { todayTickets } from './visit-helpers';

/** Local re-reading period (docs/modules/rdv.md, capability 8). */
const REFRESH_MS = 5_000;
/** Calls made on other workstations arrive with a synchronisation. */
const SYNC_MS = 15_000;

function chime(context: AudioContext): void {
  const now = context.currentTime;
  for (const [i, frequency] of [880, 660].entries()) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.35 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.3);
    osc.connect(gain).connect(context.destination);
    osc.start(now + i * 0.35);
    osc.stop(now + i * 0.35 + 0.32);
  }
}

/**
 * Waiting-room display (television or tablet). It shows the numbers called,
 * never a patient name, re-reads the local copy every five seconds and asks
 * for a synchronisation regularly when the network is there.
 */
export function CallScreen({ queueId }: { queueId: string }) {
  const t = useTranslations('visits.screen');
  const format = useFormatter();
  const online = useOnline();
  const { catalogs, syncNow } = useRuntime();
  const queue = catalogs?.snapshot.queues?.find((q) => q.id === queueId);
  const [tick, setTick] = useState(0);
  const [sound, setSound] = useState<AudioContext | null>(null);
  const lastCall = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => syncNow(), SYNC_MS);
    return () => clearInterval(timer);
  }, [online, syncNow]);

  const { data } = useLocalQuery(
    async (store) => {
      const tickets = todayTickets(await store.readEntities('queue_ticket')).filter(
        (x) => x.queueId === queueId,
      );
      const called = tickets
        .filter((x) => x.calledAt && (x.status === 'called' || x.status === 'in_service'))
        .sort((a, b) => (b.calledAt ?? '').localeCompare(a.calledAt ?? ''));
      return { called, waiting: tickets.filter((x) => x.status === 'waiting').length };
    },
    [queueId, tick],
  );
  const latest = data?.called[0] ?? null;

  useEffect(() => {
    const key = latest ? `${latest.id}:${latest.calledAt}` : null;
    if (key && lastCall.current && key !== lastCall.current && sound) chime(sound);
    lastCall.current = key;
  }, [latest, sound]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-6 sm:p-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-widest text-muted-foreground">{t('title')}</p>
          <h1 className="text-3xl font-semibold">{queue?.name ?? ''}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={sound !== null}
            onClick={() => setSound((s) => s ?? new AudioContext())}
          >
            <Volume2 />
            {sound ? t('soundOn') : t('soundOff')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void document.documentElement.requestFullscreen?.()}
          >
            <Maximize />
            {t('fullscreen')}
          </Button>
        </div>
      </header>
      <main className="grid flex-1 place-items-center">
        {latest ? (
          <div className="text-center" aria-live="polite">
            <p className="text-2xl text-muted-foreground">{t('nowCalling')}</p>
            <p className="font-mono text-[clamp(4rem,14vw,11rem)] font-bold leading-none text-primary">
              {latest.number}
            </p>
            {latest.room && <p className="mt-4 text-4xl font-medium">{latest.room}</p>}
          </div>
        ) : (
          <p className="text-2xl text-muted-foreground">{t('noCall')}</p>
        )}
      </main>
      <footer className="grid gap-3">
        {data && data.called.length > 1 && (
          <ul className="flex flex-wrap justify-center gap-3">
            {data.called.slice(1, 7).map((x) => (
              <li
                key={x.id}
                className="rounded-xl bg-muted px-4 py-2 font-mono text-2xl font-semibold"
              >
                {x.number}
                {x.room ? <span className="ml-2 text-base font-normal">{x.room}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-center text-muted-foreground">
          {t('waiting', { count: data?.waiting ?? 0 })} ·{' '}
          {format.dateTime(new Date(), { hour: '2-digit', minute: '2-digit' })}
        </p>
      </footer>
    </div>
  );
}
