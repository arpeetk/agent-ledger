import { describe, it, expect, vi } from 'vitest';
import { createMcpServer } from '../src/index.js';
import type { LedgerMcpTool } from '../src/index.js';
import { LedgerDeniedError } from '@agent-ledger/sdk';

// Mock AgentLedger for unit tests
function createMockLedger(behavior: 'allow' | 'deny' | 'pending' = 'allow') {
  const wrapped = vi.fn();

  if (behavior === 'allow') {
    wrapped.mockResolvedValue({
      status: 'executed',
      receiptId: 'receipt-123',
      result: { sent: true },
      decision: 'allow',
    });
  } else if (behavior === 'deny') {
    wrapped.mockRejectedValue(
      new LedgerDeniedError('test_tool', 'receipt-deny-1', 'No public posting.'),
    );
  } else if (behavior === 'pending') {
    wrapped.mockResolvedValue({
      status: 'pending_approval',
      receiptId: 'receipt-pending-1',
      decision: 'require_approval',
      riskLevel: 'high',
      policyExplanation: 'External recipients require approval.',
    });
  }

  const wrappedTool = Object.assign(wrapped, {
    original: vi.fn(),
    toolName: 'test_tool',
  });

  return {
    wrap: vi.fn().mockReturnValue(wrappedTool),
    wrapAll: vi.fn(),
    evaluate: vi.fn(),
    execute: vi.fn(),
    getReceipt: vi.fn(),
    listReceipts: vi.fn(),
    verifyReceipt: vi.fn(),
    health: vi.fn().mockResolvedValue(true),
    report: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session'),
  };
}

const testTool: LedgerMcpTool = {
  description: 'Send an email',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
    },
    required: ['to', 'subject'],
  },
  handler: async (args: Record<string, unknown>) => ({
    sent: true,
    to: args.to,
  }),
};

describe('createMcpServer', () => {
  it('creates an MCP server with tools registered', () => {
    const ledger = createMockLedger();
    const { server } = createMcpServer(ledger as never, { test_email: testTool });

    expect(server).toBeDefined();
    expect(ledger.wrap).toHaveBeenCalledWith('test_email', testTool.handler, expect.any(Object));
  });

  it('returns a start function', () => {
    const ledger = createMockLedger();
    const { start } = createMcpServer(ledger as never, { test_email: testTool });

    expect(typeof start).toBe('function');
  });

  it('registers multiple tools', () => {
    const ledger = createMockLedger();
    const secondTool: LedgerMcpTool = {
      description: 'Create a calendar event',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      handler: async () => ({ created: true }),
    };

    createMcpServer(ledger as never, {
      send_email: testTool,
      create_event: secondTool,
    });

    expect(ledger.wrap).toHaveBeenCalledTimes(2);
    expect(ledger.wrap).toHaveBeenCalledWith('send_email', testTool.handler, expect.any(Object));
    expect(ledger.wrap).toHaveBeenCalledWith(
      'create_event',
      secondTool.handler,
      expect.any(Object),
    );
  });

  it('passes custom server name and version', () => {
    const ledger = createMockLedger();
    const { server } = createMcpServer(
      ledger as never,
      { test_email: testTool },
      {
        name: 'my-server',
        version: '1.2.3',
      },
    );

    expect(server).toBeDefined();
  });

  it('maps onApproval "error" to SDK "throw"', () => {
    const ledger = createMockLedger();
    createMcpServer(ledger as never, { test_email: testTool }, { onApproval: 'error' });

    expect(ledger.wrap).toHaveBeenCalledWith('test_email', testTool.handler, {
      onApproval: 'throw',
    });
  });

  it('maps onApproval "message" to SDK "skip"', () => {
    const ledger = createMockLedger();
    createMcpServer(ledger as never, { test_email: testTool }, { onApproval: 'message' });

    expect(ledger.wrap).toHaveBeenCalledWith('test_email', testTool.handler, {
      onApproval: 'skip',
    });
  });

  it('maps onApproval "wait" to SDK "wait"', () => {
    const ledger = createMockLedger();
    createMcpServer(ledger as never, { test_email: testTool }, { onApproval: 'wait' });

    expect(ledger.wrap).toHaveBeenCalledWith('test_email', testTool.handler, {
      onApproval: 'wait',
    });
  });

  it('passes wrapOptions through', () => {
    const ledger = createMockLedger();
    createMcpServer(
      ledger as never,
      { test_email: testTool },
      { wrapOptions: { intent: 'test intent' } },
    );

    expect(ledger.wrap).toHaveBeenCalledWith('test_email', testTool.handler, {
      intent: 'test intent',
      onApproval: 'wait',
    });
  });
});
