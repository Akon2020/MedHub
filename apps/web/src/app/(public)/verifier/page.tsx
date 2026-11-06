import { AppError } from '@medhub/shared';
import { CheckCircle2, CircleSlash, SearchX } from 'lucide-react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { verifyPrescription, type PrescriptionCheck } from '@/server/platform/verification';

export const dynamic = 'force-dynamic';

/** Verification page reached from the QR code of a printed prescription. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const t = await getTranslations('verify');
  const { code = '' } = await searchParams;
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
  let result: PrescriptionCheck | 'limited' = { found: false };
  try {
    result = code ? await verifyPrescription(code, ip) : { found: false };
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') result = 'limited';
    else throw err;
  }

  return (
    <main className="mx-auto grid max-w-lg gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <form className="flex gap-2" method="get">
        <input
          name="code"
          defaultValue={code}
          aria-label={t('code')}
          placeholder={t('code')}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono uppercase"
        />
        <button
          type="submit"
          className="h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {t('check')}
        </button>
      </form>
      {code && result === 'limited' && (
        <p role="alert" className="rounded-xl bg-warning-soft p-4 text-sm text-warning">
          {t('limited')}
        </p>
      )}
      {code && result !== 'limited' && !result.found && (
        <p role="alert" className="flex gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
          <SearchX className="size-5 shrink-0" aria-hidden />
          {t('notFound')}
        </p>
      )}
      {result !== 'limited' && result.found && (
        <div
          role="status"
          className={
            result.status === 'cancelled'
              ? 'flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-warning'
              : 'flex gap-3 rounded-xl bg-success-soft p-4 text-sm text-success'
          }
        >
          {result.status === 'cancelled' ? (
            <CircleSlash className="size-5 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          )}
          <div className="grid gap-1">
            <p className="font-medium">
              {result.status === 'cancelled' ? t('cancelled') : t('authentic')}
            </p>
            <p>{t('issued', { structure: result.structure, date: result.issuedOn })}</p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>
    </main>
  );
}
