import { describe, expect, it } from 'vitest';
import { generateSupportKeyPair, openForSupport, sealForSupport } from '../src/support';

describe('support envelope', () => {
  it('is readable with the support private key only', async () => {
    const support = generateSupportKeyPair();
    const other = generateSupportKeyPair();
    const envelope = await sealForSupport('{"pending":3}', support.publicKey);
    expect(envelope.ct).not.toContain('pending');
    expect(await openForSupport(envelope, support.privateKey)).toBe('{"pending":3}');
    await expect(openForSupport(envelope, other.privateKey)).rejects.toThrow();
    const tampered = `${envelope.ct.startsWith('A') ? 'B' : 'A'}${envelope.ct.slice(1)}`;
    await expect(
      openForSupport({ ...envelope, ct: tampered }, support.privateKey),
    ).rejects.toThrow();
  });
});
