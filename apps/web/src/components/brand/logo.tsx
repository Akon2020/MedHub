import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7', className)}>
      <defs>
        <linearGradient id="mh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a8a8a" />
          <stop offset="1" stopColor="#0b5656" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#mh-g)" />
      <path
        d="M13.4 7.5h5.2a1 1 0 0 1 1 1v4.9h4.9a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1h-4.9v4.9a1 1 0 0 1-1 1h-5.2a1 1 0 0 1-1-1v-4.9H7.5a1 1 0 0 1-1-1v-5.2a1 1 0 0 1 1-1h4.9V8.5a1 1 0 0 1 1-1Z"
        fill="#fff"
      />
      <circle cx="16" cy="16.9" r="2.2" fill="#6aafba" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!compact && (
        <span className="font-display text-[19px] font-semibold tracking-tight text-foreground">
          Med<span className="text-primary">Hub</span>
        </span>
      )}
    </span>
  );
}
