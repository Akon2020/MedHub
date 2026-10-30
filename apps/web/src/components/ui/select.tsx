import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Native select: reliable on low-end tablets and phones, styled like Input. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-[15px] outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
