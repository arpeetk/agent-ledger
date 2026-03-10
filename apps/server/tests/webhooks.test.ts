import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must set env before importing
process.env.WEBHOOK_URL_1 = 'https://hooks.example.com/test1';
process.env.WEBHOOK_SECRET_1 = 'test-secret-1';
process.env.WEBHOOK_EVENTS_1 = 'receipt.denied,receipt.pending_approval';

process.env.WEBHOOK_URL_2 = 'https://hooks.example.com/test2';

import { loadWebhookConfig, emitWebhook, hasWebhooks, webhookCount } from '../src/lib/webhooks.js';
import type { WebhookPayload } from '../src/lib/webhooks.js';

describe('webhooks', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    loadWebhookConfig();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads webhook config from env vars', () => {
    expect(hasWebhooks()).toBe(true);
    expect(webhookCount()).toBe(2);
  });

  it('delivers to all matching endpoints', async () => {
    const payload: WebhookPayload = {
      event: 'receipt.denied',
      timestamp: '2024-01-01T00:00:00Z',
      data: {
        receiptId: 'r-1',
        toolName: 'public.post',
        capability: 'PUBLIC_POST',
        riskLevel: 'high',
        policyDecision: 'deny',
        sessionId: 's-1',
        agentId: 'agent-1',
        policyExplanation: 'No public posting',
      },
    };

    emitWebhook(payload);

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 50));

    // Both endpoints should receive (denied is in endpoint 1's event list, endpoint 2 has no filter)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('filters by event type', async () => {
    const payload: WebhookPayload = {
      event: 'receipt.executed',
      timestamp: '2024-01-01T00:00:00Z',
      data: {
        receiptId: 'r-2',
        toolName: 'gmail.send',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
        policyDecision: 'allow',
        sessionId: 's-1',
        agentId: 'agent-1',
      },
    };

    emitWebhook(payload);

    await new Promise((r) => setTimeout(r, 50));

    // Only endpoint 2 should receive (endpoint 1 filters to denied+pending only)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://hooks.example.com/test2', expect.any(Object));
  });

  it('includes HMAC signature when secret is configured', async () => {
    const payload: WebhookPayload = {
      event: 'receipt.pending_approval',
      timestamp: '2024-01-01T00:00:00Z',
      data: {
        receiptId: 'r-3',
        toolName: 'gmail.send',
        capability: 'EMAIL_SEND',
        riskLevel: 'medium',
        policyDecision: 'require_approval',
        sessionId: 's-1',
        agentId: 'agent-1',
      },
    };

    emitWebhook(payload);

    await new Promise((r) => setTimeout(r, 50));

    // Endpoint 1 has a secret, so should include X-Ledger-Signature
    const call1 = fetchSpy.mock.calls.find(
      (c: unknown[]) => c[0] === 'https://hooks.example.com/test1',
    );
    expect(call1).toBeDefined();
    expect(call1[1].headers['X-Ledger-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]+$/);

    // Endpoint 2 has no secret, so no signature
    const call2 = fetchSpy.mock.calls.find(
      (c: unknown[]) => c[0] === 'https://hooks.example.com/test2',
    );
    expect(call2).toBeDefined();
    expect(call2[1].headers['X-Ledger-Signature']).toBeUndefined();
  });

  it('handles fetch errors gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const payload: WebhookPayload = {
      event: 'receipt.denied',
      timestamp: '2024-01-01T00:00:00Z',
      data: {
        receiptId: 'r-4',
        toolName: 'test',
        capability: 'READ_ONLY',
        riskLevel: 'low',
        policyDecision: 'deny',
        sessionId: 's-1',
        agentId: 'agent-1',
      },
    };

    // Should not throw
    emitWebhook(payload);

    await new Promise((r) => setTimeout(r, 50));

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('sends JSON body with correct content type', async () => {
    const payload: WebhookPayload = {
      event: 'receipt.pending_approval',
      timestamp: '2024-01-01T00:00:00Z',
      data: {
        receiptId: 'r-5',
        toolName: 'gmail.send',
        capability: 'EMAIL_SEND',
        riskLevel: 'medium',
        policyDecision: 'require_approval',
        sessionId: 's-1',
        agentId: 'agent-1',
      },
    };

    emitWebhook(payload);

    await new Promise((r) => setTimeout(r, 50));

    const call = fetchSpy.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call[1].body)).toEqual(payload);
  });
});
