/**
 * Deterministic JSON used for signatures and the audit hash chain:
 * object keys sorted, no whitespace, undefined members dropped.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : normalize(item)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const member = (value as Record<string, unknown>)[key];
    if (member !== undefined) out[key] = normalize(member);
  }
  return out;
}
