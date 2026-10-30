'use client';

import {
  Building2,
  ChevronRight,
  Database,
  KeyRound,
  MonitorCog,
  ShieldAlert,
  Smartphone,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRuntime } from '@/client/runtime';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/features/shell/page-header';

type Entry = {
  key: string;
  icon: LucideIcon;
  href?: string;
  permission: string;
  soon?: string;
};

const ENTRIES: Entry[] = [
  {
    key: 'organization',
    icon: Building2,
    href: '/app/parametres/organisation',
    permission: 'configuration:read',
  },
  {
    key: 'security',
    icon: ShieldAlert,
    href: '/app/parametres/securite',
    permission: 'audit:review',
  },
  { key: 'account', icon: UserCog, href: '/app/compte', permission: '' },
  {
    key: 'workstations',
    icon: MonitorCog,
    href: '/app/parametres/synchronisation',
    permission: 'configuration:read',
  },
  { key: 'users', icon: Users, href: '/app/parametres/utilisateurs', permission: 'user:read' },
  { key: 'roles', icon: KeyRound, href: '/app/parametres/roles', permission: 'role:read' },
  {
    key: 'devices',
    icon: Smartphone,
    href: '/app/parametres/appareils',
    permission: 'device:read',
  },
  {
    key: 'reference',
    icon: Database,
    href: '/app/parametres/referentiels',
    permission: 'configuration:read',
  },
];

/** Settings hub: online-only configuration screens, filtered by permission. */
export default function SettingsPage() {
  const t = useTranslations('settings');
  const { identity } = useRuntime();
  const permissions = new Set(identity?.permissions ?? []);
  const entries = ENTRIES.filter((e) => !e.permission || permissions.has(e.permission));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const body = (
            <>
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(`hub.${entry.key}.title`)}</span>
                <span className="block text-sm text-muted-foreground">
                  {t(`hub.${entry.key}.text`)}
                </span>
              </span>
              {entry.soon ? (
                <Badge variant="muted">{t('soon', { week: entry.soon })}</Badge>
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              )}
            </>
          );
          return (
            <li key={entry.key}>
              {entry.href ? (
                <Link
                  href={entry.href}
                  className="card-surface flex items-center gap-4 p-4 transition-colors hover:bg-muted/40"
                >
                  {body}
                </Link>
              ) : (
                <div className="card-surface flex items-center gap-4 p-4 opacity-75">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
