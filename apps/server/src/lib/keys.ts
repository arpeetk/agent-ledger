import { generateKeyPair, loadKeyPair } from '@agent-ledger/core';
import type { KeyPair } from '@agent-ledger/core';

let _keyPair: KeyPair | null = null;

export function getKeyPair(): KeyPair {
  if (_keyPair) return _keyPair;

  const pubEnv = process.env.SIGNING_PUBLIC_KEY;
  const privEnv = process.env.SIGNING_PRIVATE_KEY;

  if (pubEnv && privEnv) {
    _keyPair = loadKeyPair(pubEnv, privEnv);
  } else {
    console.log('No signing keys found in env, generating ephemeral key pair...');
    _keyPair = generateKeyPair();
    console.log(`Public key: ${Buffer.from(_keyPair.publicKey).toString('base64')}`);
  }

  return _keyPair;
}
