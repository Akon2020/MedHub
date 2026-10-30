import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalJson } from '@medhub/shared';
import type { Operation, UnsignedOperation } from './protocol';

const encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function operationSigningBytes(op: UnsignedOperation | Operation): Uint8Array {
  const { signature: _signature, ...unsigned } = op as Operation;
  return encoder.encode(canonicalJson(unsigned));
}

export type DeviceKeyPair = { secretKey: Uint8Array; publicKey: Uint8Array };

export function generateDeviceKeyPair(): DeviceKeyPair {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function signOperation(op: UnsignedOperation, secretKey: Uint8Array): Operation {
  const signature = bytesToBase64(ed25519.sign(operationSigningBytes(op), secretKey));
  return { ...op, signature };
}

export function verifyOperation(op: Operation, publicKeyBase64: string): boolean {
  try {
    return ed25519.verify(
      base64ToBytes(op.signature),
      operationSigningBytes(op),
      base64ToBytes(publicKeyBase64),
    );
  } catch {
    return false;
  }
}
