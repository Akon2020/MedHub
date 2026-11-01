'use client';

import { RECORD_ACCESS_INTERVAL_MS, type RecordAccessPayload } from '@medhub/domain';
import { useEffect } from 'react';
import { useRuntime } from '@/client/runtime';

const last = new Map<string, number>();

/**
 * Writes the opening of a record to the access journal, offline included: the
 * entry travels with the next synchronisation (rule 10 of CLAUDE.md).
 */
export function useRecordAccess(patientId: string, screen: RecordAccessPayload['screen']): void {
  const { dispatch, identity } = useRuntime();
  const allowed = identity?.permissions.includes('patient:read') ?? false;
  useEffect(() => {
    if (!patientId || !allowed) return;
    const key = `${identity?.userId}:${patientId}:${screen}`;
    const now = Date.now();
    if (now - (last.get(key) ?? 0) < RECORD_ACCESS_INTERVAL_MS) return;
    last.set(key, now);
    void dispatch('record_access.log', {
      patientId,
      screen,
      at: new Date(now).toISOString(),
    }).catch(() => last.delete(key));
  }, [patientId, screen, allowed, dispatch, identity?.userId]);
}
