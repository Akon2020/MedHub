/**
 * Patient card token (docs/modules/pat.md, capability 4): what the QR code of
 * the printed card holds. Opaque and random, never a name or a record number:
 * it only means something to a MedHub device of the structure.
 */
export const CARD_TOKEN_PREFIX = 'MHC1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const TOKEN_LENGTH = 20;
const CARD_TOKEN = new RegExp(`^${CARD_TOKEN_PREFIX}[${ALPHABET}]{${TOKEN_LENGTH}}$`);

/** 20 characters from 32: 100 random bits, given by the caller (WebCrypto on devices). */
export function formatCardToken(random: Uint8Array): string {
  if (random.length < TOKEN_LENGTH) throw new Error('not enough random bytes');
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) out += ALPHABET[(random[i] ?? 0) % ALPHABET.length];
  return `${CARD_TOKEN_PREFIX}${out}`;
}

/** Scanners type what they read: case and surrounding spaces are tolerated. */
export function normalizeCardToken(input: string): string | null {
  const value = input.trim().toUpperCase();
  return CARD_TOKEN.test(value) ? value : null;
}
