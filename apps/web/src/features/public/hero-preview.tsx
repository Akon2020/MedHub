import {
  Activity,
  Bell,
  CloudOff,
  FlaskConical,
  LayoutGrid,
  Pill,
  Search,
  Stethoscope,
  Users,
  Wallet,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/brand/logo';

/** Purely illustrative product preview; every figure in it is fictitious and labelled so. */
const WEEK = [38, 52, 47, 61, 58, 72, 66];
const CURVE = [52, 48, 55, 50, 62, 58, 66, 61, 70, 64, 74, 69, 80, 76, 84, 79, 90];

function sparkPath(values: number[], width: number, height: number): string {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / (max - min || 1)) * (height - 8) - 4;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export async function HeroPreview() {
  const t = await getTranslations('public.preview');
  const nav = await getTranslations('app.nav');
  const common = await getTranslations('common');
  const line = sparkPath(CURVE, 360, 120);

  const stats = [
    { icon: Users, label: t('queue'), value: '24', tone: 'text-primary' },
    { icon: Activity, label: t('inProgress'), value: '7', tone: 'text-info' },
    { icon: Stethoscope, label: t('consultation'), value: '18', tone: 'text-primary' },
    { icon: Wallet, label: t('cashier'), value: '31', tone: 'text-success' },
  ];

  return (
    <div className="relative mx-auto mt-14 w-full max-w-5xl [perspective:1800px]">
      <div className="glass rounded-[28px] p-2 [transform:rotateX(8deg)] sm:p-3">
        <div className="overflow-hidden rounded-[22px] bg-[#f7fafb] ring-1 ring-black/5">
          <div className="flex">
            <aside className="hidden w-48 shrink-0 border-r border-border bg-white p-4 lg:block">
              <div className="mb-6 flex items-center gap-2">
                <LogoMark className="size-6" />
                <span className="font-display text-sm font-semibold">MedHub</span>
              </div>
              <ul className="space-y-1 text-[13px] text-slate-ink">
                {[
                  { icon: LayoutGrid, label: nav('dashboard'), active: true },
                  { icon: Users, label: nav('patients') },
                  { icon: Stethoscope, label: nav('consultations') },
                  { icon: FlaskConical, label: nav('laboratory') },
                  { icon: Pill, label: nav('pharmacy') },
                  { icon: Wallet, label: nav('billing') },
                ].map(({ icon: Icon, label, active }) => (
                  <li
                    key={label}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${active ? 'bg-accent font-medium text-accent-foreground' : ''}`}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="truncate">{label}</span>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="min-w-0 flex-1 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-white px-3 text-xs text-muted-foreground ring-1 ring-border">
                  <Search className="size-3.5" aria-hidden />
                  <span className="truncate">{t('search')}</span>
                </div>
                <span className="hidden items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-medium text-warning sm:inline-flex">
                  <CloudOff className="size-3" aria-hidden />
                  {t('offline')}
                </span>
                <span className="grid size-9 place-items-center rounded-full bg-white ring-1 ring-border">
                  <Bell className="size-4 text-slate-ink" aria-hidden />
                </span>
              </div>

              <div className="mt-5 flex items-end justify-between">
                <div>
                  <p className="font-display text-lg font-semibold">{t('title')}</p>
                  <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {common('fictitiousData')}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {stats.map(({ icon: Icon, label, value, tone }) => (
                  <div key={label} className="rounded-2xl bg-white p-3.5 ring-1 ring-border">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden />
                      {label}
                    </div>
                    <p className={`mt-2 font-display text-2xl font-semibold ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-border md:col-span-3">
                  <p className="text-[13px] font-semibold">{t('activity')}</p>
                  <svg viewBox="0 0 360 120" className="mt-3 h-28 w-full" aria-hidden>
                    <defs>
                      <linearGradient id="hp-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#6aafba" stopOpacity="0.45" />
                        <stop offset="1" stopColor="#6aafba" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`${line} L360,120 L0,120 Z`} fill="url(#hp-fill)" />
                    <path
                      d={line}
                      fill="none"
                      stroke="#0f6b6b"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="rounded-2xl bg-white p-4 ring-1 ring-border md:col-span-2">
                  <p className="text-[13px] font-semibold">{t('queue')}</p>
                  <div className="mt-3 flex h-28 items-end gap-2">
                    {WEEK.map((v, i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-t-lg ${i === 5 ? 'bg-primary' : 'bg-teal-soft/70'}`}
                        style={{ height: `${v}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
