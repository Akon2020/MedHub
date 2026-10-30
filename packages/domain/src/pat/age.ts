/** Completed years between an ISO civil date and a reference instant. */
export function ageInYears(birthDate: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Estimated age typed at the front desk ("35 ans") becomes a civil date on
 * 1 January of the derived year, flagged as estimated.
 */
export function birthDateFromEstimatedAge(years: number, now: Date): string {
  return `${String(now.getUTCFullYear() - years).padStart(4, '0')}-01-01`;
}
