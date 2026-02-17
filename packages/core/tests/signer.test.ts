import { describe, it, expect } from 'vitest';
import { generateKeyPair, signReceipt, verifyReceipt } from '../src/signer.js';
import type { ActionReceipt } from '../src/types.js';

function makeReceipt(): ActionReceipt {
  return {
    receipt_version: '0.1',
    receipt_id: 'test-receipt-001',
    timestamp: '2025-01-01T00:00:00.000Z',
    session: {
      sessionId: 'session-001',
      agentId: 'agent-001',
    },
    request: {
      tool_name: 'gmail.send',
      capability: 'EMAIL_SEND',
      risk: { level: 'low', reasons: [] },
      args_hash: 'abc123',
      redacted_args: { to: ['alice@mycompany.com'], subject: 'Test' },
    },
    policy: {
      policy_id: 'test-v1',
      decision: 'allow',
      matched_rules: ['allow_internal_email'],
      explanation: 'Internal emails are auto-allowed.',
    },
    execution: {
      status: 'success',
      attempts: 1,
      idempotency_key: 'idem-001',
      latency_ms: 10,
    },
    redaction: { fields_redacted: ['body'] },
  };
}

describe('Receipt signing', () => {
  it('signs and verifies a receipt', () => {
    const keyPair = generateKeyPair();
    const receipt = makeReceipt();
    const signed = signReceipt(receipt, keyPair);

    expect(signed.signature).toBeDefined();
    expect(signed.signature!.alg).toBe('ed25519');
    expect(signed.signature!.signature_b64).toBeTruthy();

    const valid = verifyReceipt(signed, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it('detects tampering', () => {
    const keyPair = generateKeyPair();
    const receipt = makeReceipt();
    const signed = signReceipt(receipt, keyPair);

    // Tamper with the receipt
    const tampered = { ...signed, receipt_id: 'tampered-id' };
    const valid = verifyReceipt(tampered, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it('fails verification with wrong key', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    const receipt = makeReceipt();
    const signed = signReceipt(receipt, keyPair1);

    const valid = verifyReceipt(signed, keyPair2.publicKey);
    expect(valid).toBe(false);
  });

  it('returns false for unsigned receipt', () => {
    const keyPair = generateKeyPair();
    const receipt = makeReceipt();
    const valid = verifyReceipt(receipt, keyPair.publicKey);
    expect(valid).toBe(false);
  });
});
