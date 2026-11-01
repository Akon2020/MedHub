'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CallScreen } from '@/features/visits/call-screen';

function Screen() {
  const queueId = useSearchParams().get('queue') ?? '';
  return <CallScreen queueId={queueId} />;
}

export default function CallScreenPage() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
