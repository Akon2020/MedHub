'use client';

import {
  GraduationCap,
  Lock,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRuntime } from '@/client/runtime';
import { Logo, LogoMark } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NAVIGATION, type NavItem } from './navigation';
import { SyncIndicator } from './sync-indicator';

function isActive(item: NavItem, pathname: string, moduleKey: string | null): boolean {
  if (item.href === '/app') return pathname === '/app';
  if (item.href.startsWith('/app/bientot'))
    return pathname === '/app/bientot' && moduleKey === item.key;
  return pathname.startsWith(item.href);
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useTranslations('app.nav');
  const pathname = usePathname();
  const params = useSearchParams();
  const { identity } = useRuntime();
  const permissions = new Set(identity?.permissions ?? []);
  const moduleKey = params.get('m');

  return (
    <nav aria-label="MedHub" className="grid gap-5">
      {NAVIGATION.map((group) => {
        const items = group.items.filter((i) => !i.permission || permissions.has(i.permission));
        if (items.length === 0) return null;
        return (
          <div key={group.key ?? 'root'}>
            {group.key && !collapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                {t(group.key)}
              </p>
            )}
            <ul className="grid gap-0.5">
              {items.map((item) => {
                const active = isActive(item, pathname, moduleKey);
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? t(item.key) : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                        active
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-slate-ink hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      {!collapsed && <span className="flex-1 truncate">{t(item.key)}</span>}
                      {!collapsed && item.soon && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('soon')}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('app');
  const router = useRouter();
  const pathname = usePathname();
  const { identity, lock, signOut, device } = useRuntime();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock]);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    router.push(`/app/patients?q=${encodeURIComponent(query.trim())}`);
  }

  if (!identity) return null;

  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-white px-3 py-5 transition-[width] lg:flex',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'mb-7 flex items-center px-2',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {collapsed ? <LogoMark /> : <Logo />}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(true)}
              aria-label={t('nav.collapse')}
            >
              <PanelLeftClose />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense>
            <SidebarNav collapsed={collapsed} />
          </Suspense>
        </div>
        {collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mx-auto"
            onClick={() => setCollapsed(false)}
            aria-label={t('nav.expand')}
          >
            <PanelLeftOpen />
          </Button>
        )}
        {!collapsed && device && (
          <div className="mt-4 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">{identity.tenantName}</p>
            <p className="mt-0.5">
              {identity.tenantCode} · {identity.siteCode ?? ''} · {device.deviceCode}
            </p>
          </div>
        )}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30"
            aria-label={t('nav.collapse')}
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col bg-white px-3 py-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label={t('nav.collapse')}
              >
                <X />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Suspense>
                <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </Suspense>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {identity.isTraining && (
          <div className="flex items-center justify-center gap-2 bg-info px-4 py-1.5 text-xs font-medium text-white">
            <GraduationCap className="size-3.5" aria-hidden />
            {t('training')}
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t('header.menu')}
          >
            <Menu />
          </Button>
          <form onSubmit={onSearch} className="relative max-w-md flex-1" role="search">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="global-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('header.search')}
              aria-label={t('header.search')}
              className="h-10 w-full rounded-full border border-border bg-muted/60 pl-10 pr-10 text-sm outline-none transition focus:border-ring focus:bg-white focus:ring-[3px] focus:ring-ring/20"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-white px-1.5 text-[11px] text-muted-foreground sm:block">
              /
            </kbd>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <SyncIndicator />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-muted"
              >
                <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initials(identity.displayName)}
                </span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-medium">
                    {identity.title ? `${identity.title} ` : ''}
                    {identity.displayName}
                  </span>
                  <span className="block text-xs text-muted-foreground">{identity.username}</span>
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-50 w-60 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-border"
                >
                  <div className="px-2 py-2">
                    <LocaleSwitcher />
                  </div>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      lock();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
                  >
                    <Lock className="size-4" aria-hidden />
                    {t('header.lock')}
                    <kbd className="ml-auto text-[11px] text-muted-foreground">Alt+L</kbd>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void signOut().then(() => router.replace('/connexion'));
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft"
                  >
                    <LogOut className="size-4" aria-hidden />
                    {t('header.signOut')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
