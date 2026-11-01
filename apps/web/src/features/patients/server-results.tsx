'use client';

import { applyRemote } from '@medhub/sync/client';
import { CloudDownload, Loader2, Server } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/client/api';
import { useOnline } from '@/client/browser-state';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Hit = {
  id: string;
  mrn: string;
  name: string;
  sex: string;
  birthDate: string | null;
  birthDateEstimated: boolean;
  phone: string | null;
  place: string | null;
};

/**
 * Online complement of the local search: patients known to the server but not
 * (yet) on this device. Opening one stores it locally like a pulled change, so
 * the record works offline afterwards.
 */
export function ServerResults({ query }: { query: string }) {
  const t = useTranslations('patients.server');
  const tp = useTranslations('patients');
  const online = useOnline();
  const router = useRouter();
  const { store } = useRuntime();
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    if (!online || query.length < 2) {
      // Clearing the results when the query is too short is part of this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    setLoading(true);
    apiFetch<{ hits: Hit[] }>(`/api/v1/patients?q=${encodeURIComponent(query)}`)
      .then(async (r) => {
        // Only what this device does not hold yet; the local list shows the rest.
        const missing: Hit[] = [];
        for (const hit of r.hits) {
          if (!store || !(await store.readEntity('patient', hit.id))) missing.push(hit);
        }
        if (current === request.current) setHits(missing);
      })
      .catch(() => {
        if (current === request.current) setHits([]);
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [online, query, store]);

  async function open(hit: Hit) {
    if (!store) return;
    setOpening(hit.id);
    setError(null);
    try {
      const state = await apiFetch<{ id: string; version: number; data: Record<string, unknown> }>(
        `/api/v1/patients/state?id=${hit.id}`,
      );
      await store.transaction((tx) =>
        applyRemote(tx, 'patient', state.id, state.version, state.data),
      );
      router.push(`/app/patients/fiche?id=${hit.id}`);
    } catch {
      setError(t('error'));
      setOpening(null);
    }
  }

  const outside = hits;
  if (!online || query.length < 2 || (outside.length === 0 && !loading)) return null;
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Server className="size-4 text-primary" aria-hidden />
        <h2 className="font-medium">{t('title')}</h2>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">{t('hint')}</span>
      </div>
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border">
        {outside.map((hit) => (
          <li key={hit.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{hit.name}</span>
              <span className="block text-xs text-muted-foreground">
                {hit.mrn} · {tp(`sex.${hit.sex === 'M' || hit.sex === 'F' ? hit.sex : 'U'}`)}
                {hit.birthDate
                  ? ` · ${hit.birthDateEstimated ? hit.birthDate.slice(0, 4) : hit.birthDate}`
                  : ''}
                {hit.place ? ` · ${hit.place}` : ''}
              </span>
            </span>
            <Badge variant="info">{t('badge')}</Badge>
            <Button
              size="sm"
              variant="secondary"
              disabled={opening !== null}
              onClick={() => void open(hit)}
            >
              {opening === hit.id ? <Loader2 className="animate-spin" /> : <CloudDownload />}
              {t('open')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
