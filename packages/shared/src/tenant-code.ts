/** Structure code format `[A-Z]{3}-[A-Z]{3}-[0-9]{4}`, typed case-insensitively. */
const TENANT_CODE = /^[A-Z]{3}-[A-Z]{3}-\d{4}$/;

export function normalizeTenantCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
}

export function isTenantCode(input: string): boolean {
  return TENANT_CODE.test(normalizeTenantCode(input));
}
