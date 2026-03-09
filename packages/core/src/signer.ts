import nacl from 'tweetnacl';
import { stableStringify } from './stable-stringify.js';
import type { ActionReceipt } from './types.js';

// Use Node.js Buffer for base64/utf8 conversion instead of tweetnacl-util (CJS compat)
function encodeBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString('base64');
}

function decodeBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

function decodeUTF8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'utf-8'));
}

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyId: string;
}

/**
 * Generate a new ed25519 signing key pair.
 */
export function generateKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  const publicKeyId = encodeBase64(kp.publicKey).slice(0, 16);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyId,
  };
}

/**
 * Load a key pair from base64-encoded strings.
 */
export function loadKeyPair(publicKeyB64: string, secretKeyB64: string): KeyPair {
  const publicKey = decodeBase64(publicKeyB64);
  const secretKey = decodeBase64(secretKeyB64);
  const publicKeyId = publicKeyB64.slice(0, 16);
  return { publicKey, secretKey, publicKeyId };
}

/**
 * Sign a receipt. Returns a new receipt with the signature field.
 */
export function signReceipt(receipt: ActionReceipt, keyPair: KeyPair): ActionReceipt {
  // Remove any existing signature before signing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _, ...receiptWithoutSig } = receipt;
  const canonical = stableStringify(receiptWithoutSig);
  const messageBytes = decodeUTF8(canonical);
  const sig = nacl.sign.detached(messageBytes, keyPair.secretKey);

  return {
    ...receipt,
    signature: {
      alg: 'ed25519',
      public_key_id: keyPair.publicKeyId,
      signature_b64: encodeBase64(sig),
    },
  };
}

/**
 * Verify a signed receipt.
 */
export function verifyReceipt(receipt: ActionReceipt, publicKey: Uint8Array): boolean {
  if (!receipt.signature) return false;

  const { signature, ...receiptWithoutSig } = receipt;
  const canonical = stableStringify(receiptWithoutSig);
  const messageBytes = decodeUTF8(canonical);
  const sigBytes = decodeBase64(signature.signature_b64);

  return nacl.sign.detached.verify(messageBytes, sigBytes, publicKey);
}
