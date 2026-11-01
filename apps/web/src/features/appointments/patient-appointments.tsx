'use client';

import { UPCOMING_STATUSES, noShowCount } from '@medhub/domain';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useLocalQuery, useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Next appointments of the patient and missed ones (docs/modules/rdv.md,
 * capability 4), read from the device.
 */
export function PatientAppointments({ patientId }: { patientId: string }) {
  const t = useTranslations('appointments');
  const format = useFormatter();
  const { catalogs, identity } = useRuntime();
  const snapshot = catalogs?.snapshot;
  const timeZone = snapshot?.timeZone ?? 'Africa/Kinshasa';
  const canRead = identity?.permissions.includes('appointment:read') ?? false;

  const { data } = useLocalQuery(
    async (store) => {
      const rows = (await store.readEntitiesByPatient('appointment', patientId)).map((a) => ({
        id: a.id,
        startsAt: String(a.data.startsAt),
        status: String(a.data.status),
        resourceId: String(a.data.resourceId),
      }));
      const now = Date.now();
      return {
        upcoming: rows
          .filter(
            (r) =>
              (UPCOMING_STATUSES as readonly string[]).includes(r.status) &&
              Date.parse(r.startsAt) >= now,
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
        missed: noShowCount(rows),
      };
    },
    [patientId],
  );

  if (!canRead) return null;
  const label = (resourceId: string) =>
    snapshot?.staff?.find((s) => s.id === resourceId)?.displayName ??
    snapshot?.departments.find((d) => d.id === resourceId)?.name ??
    '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          {t('patientTitle')}
        </CardTitle>
        {identity?.permissions.includes('appointment:create') && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/app/rendez-vous?patient=${patientId}`}>
              <CalendarPlus />
              {t('take')}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {(data?.missed ?? 0) > 0 && (
          <p>
            <Badge variant="warning">{t('missed', { count: data?.missed ?? 0 })}</Badge>
          </p>
        )}
        {(data?.upcoming ?? []).length === 0 ? (
          <p className="text-muted-foreground">{t('noneUpcoming')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {data?.upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2">
                <span className="font-medium">
                  {format.dateTime(new Date(a.startsAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone,
                  })}
                </span>
                <span className="text-muted-foreground">{label(a.resourceId)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
