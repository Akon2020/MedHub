/**
 * Monthly family packages (docs/modules/conv.md section 5): every month begun
 * is due, paid in arrears and billed at the end of the month.
 */
export type Enrolment = { validFrom: string; validUntil: string | null };

/** YYYY-MM of a day. */
const month = (dayIso: string) => dayIso.slice(0, 7);

/** A family is due for a month when its coverage overlaps any day of it. */
export function monthDue(enrolment: Enrolment, period: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('CONV_PERIOD_INVALID');
  if (month(enrolment.validFrom) > period) return false;
  return enrolment.validUntil === null || month(enrolment.validUntil) >= period;
}

/** Number of families due for a period and the amount of the packages. */
export function packagesDue(
  families: readonly Enrolment[],
  period: string,
  pricePerFamily: number,
): { families: number; amount: number } {
  const due = families.filter((f) => monthDue(f, period)).length;
  return { families: due, amount: due * pricePerFamily };
}

/** The day the monthly payer invoice is generated (25 by default, configurable). */
export function isGenerationDay(today: string, generationDay: number): boolean {
  const d = Number(today.slice(8, 10));
  const lastDay = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0),
  ).getUTCDate();
  return d === Math.min(generationDay, lastDay);
}
