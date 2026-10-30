'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { PatientView } from './patient-helpers';

const VARIANT = { synced: 'success', pending: 'warning', rejected: 'danger' } as const;

export function SyncBadge({ state }: { state: PatientView['syncState'] }) {
  const t = useTranslations('patients.state');
  return (
    <Badge variant={VARIANT[state]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(state)}
    </Badge>
  );
}
