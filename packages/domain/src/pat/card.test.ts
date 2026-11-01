import { describe, expect, it } from 'vitest';
import { formatCardToken, normalizeCardToken } from './card';

describe('patient card token', () => {
  it('is opaque, fixed length and read back from a scanner', () => {
    const token = formatCardToken(new Uint8Array(32).map((_, i) => i * 7));
    expect(token).toMatch(/^MHC1-[A-Z0-9]{20}$/);
    expect(normalizeCardToken(` ${token.toLowerCase()} `)).toBe(token);
  });

  it('rejects anything else, including record numbers', () => {
    expect(normalizeCardToken('KIN-AA-26-00001')).toBeNull();
    expect(normalizeCardToken('MHC1-SHORT')).toBeNull();
    expect(() => formatCardToken(new Uint8Array(4))).toThrow();
  });
});
