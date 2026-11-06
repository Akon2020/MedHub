'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CashDeskHome, PatientBilling } from '@/features/billing/cash-desk';

function CashDesk() {
  const patientId = useSearchParams().get('patient') ?? '';
  return patientId ? <PatientBilling key={patientId} patientId={patientId} /> : <CashDeskHome />;
}

export default function CashDeskPage() {
  return (
    <Suspense>
      <CashDesk />
    </Suspense>
  );
}
