import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppGate } from '@/features/shell/gate';

export const metadata: Metadata = {
  title: 'Application',
  robots: { index: false, follow: false },
};

/**
 * Operational shell: no structure data is rendered on the server. Everything
 * comes from the encrypted local database once the workstation is unlocked.
 */
export default function OperationalLayout({ children }: { children: ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
