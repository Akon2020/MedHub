import {
  CalendarClock,
  FileHeart,
  FlaskConical,
  Gauge,
  HandCoins,
  LayoutGrid,
  Pill,
  Settings,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Roadmap week when the module is not built yet. */
  soon?: string;
  permission?: string;
};

export type NavGroup = { key: string | null; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  { key: null, items: [{ key: 'dashboard', href: '/app', icon: LayoutGrid }] },
  {
    key: 'clinical',
    items: [
      { key: 'patients', href: '/app/patients', icon: Users, permission: 'patient:read' },
      { key: 'appointments', href: '/app/bientot?m=appointments', icon: CalendarClock, soon: 'S7' },
      {
        key: 'consultations',
        href: '/app/bientot?m=consultations',
        icon: Stethoscope,
        soon: 'S8-S9',
      },
    ],
  },
  {
    key: 'diagnostics',
    items: [
      { key: 'laboratory', href: '/app/bientot?m=laboratory', icon: FlaskConical, soon: 'S13' },
    ],
  },
  {
    key: 'operations',
    items: [{ key: 'pharmacy', href: '/app/bientot?m=pharmacy', icon: Pill, soon: 'S12' }],
  },
  {
    key: 'finance',
    items: [
      { key: 'billing', href: '/app/bientot?m=billing', icon: HandCoins, soon: 'S10' },
      { key: 'contracts', href: '/app/bientot?m=contracts', icon: FileHeart, soon: 'S11' },
    ],
  },
  {
    key: 'system',
    items: [
      {
        key: 'settings',
        href: '/app/parametres',
        icon: Settings,
        permission: 'configuration:read',
      },
      { key: 'diagnostic', href: '/app/diagnostic', icon: Gauge },
    ],
  },
];

export const SOON_WEEKS: Record<string, string> = Object.fromEntries(
  NAVIGATION.flatMap((g) => g.items)
    .filter((i) => i.soon)
    .map((i) => [i.key, i.soon as string]),
);
