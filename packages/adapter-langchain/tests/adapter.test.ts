import { describe, it, expect } from 'vitest';
import { wrapLangChainTools, wrapLangChainTool } from '../src/index.js';
import { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';
import type { AgentLedger, LedgerResult } from '@agent-ledger/sdk';

type WrappedFn = (args: Record<string, unknown>) => Promise<LedgerResult>;

function createMockLedger(mockResult: Partial<LedgerResult> & { callOriginal?: boolean }) {
  return {
    wrap: (
      _name: string,
      fn: (args: Record<string, unknown>) => unknown | Promise<unknown>,
      _opts?: Record<string, unknown>,
    ): WrappedFn => {
      return async (args: Record<string, unknown>) => {
        if (mockResult.callOriginal) {
          const result = await fn(args);
          return { status: 'executed', receiptId: 'test-receipt', result } as LedgerResult;
        }
        return mockResult as LedgerResult;
      };
    },
  } as unknown as AgentLedger;
}

function createThrowingLedger(error: Error) {
  return {
    wrap: (
      _name: string,
      _fn: (args: Record<string, unknown>) => unknown,
      _opts?: Record<string, unknown>,
    ): WrappedFn => {
      return async () => {
        throw error;
      };
    },
  } as unknown as AgentLedger;
}

function createMockTool(
  overrides?: Partial<{ name: string; description: string; schema: unknown }>,
) {
  return {
    name: overrides?.name ?? 'send_email',
    description: overrides?.description ?? 'Send an email to a recipient',
    schema: overrides?.schema ?? { type: 'object', properties: { to: { type: 'string' } } },
    invoke: async (input: Record<string, unknown>) => JSON.stringify({ sent: true, to: input.to }),
  };
}

describe('wrapLangChainTools', () => {
  it('wrapped tool preserves name, description, and schema', () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tool = createMockTool({
      name: 'my_tool',
      description: 'Does something useful',
      schema: { type: 'object', properties: { x: { type: 'number' } } },
    });

    const [wrapped] = wrapLangChainTools(ledger, [tool]);

    expect(wrapped.name).toBe('my_tool');
    expect(wrapped.description).toBe('Does something useful');
    expect(wrapped.schema).toEqual({ type: 'object', properties: { x: { type: 'number' } } });
  });

  it('invoke returns JSON stringified result', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool]);
    const result = await wrapped.invoke({ to: 'bob@example.com' });

    const parsed = JSON.parse(result);
    expect(parsed.sent).toBe(true);
    expect(parsed.to).toBe('bob@example.com');
  });

  it('denied tool with onDenied="message" returns denial JSON', async () => {
    const error = new LedgerDeniedError('send_email', 'receipt-100', 'blocked by policy');
    const ledger = createThrowingLedger(error);
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool], { onDenied: 'message' });
    const result = await wrapped.invoke({});

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('denied');
    expect(parsed.reason).toBe('blocked by policy');
    expect(parsed.message).toContain('denied by policy');
  });

  it('denied tool with onDenied="throw" throws LedgerDeniedError', async () => {
    const error = new LedgerDeniedError('send_email', 'receipt-100', 'blocked');
    const ledger = createThrowingLedger(error);
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool], { onDenied: 'throw' });
    await expect(wrapped.invoke({})).rejects.toThrow(LedgerDeniedError);
  });

  it('pending approval with onApproval="message" returns pending JSON', async () => {
    const ledger = createMockLedger({
      status: 'pending_approval',
      receiptId: 'receipt-200',
      riskLevel: 'medium',
      policyExplanation: 'Needs review',
    });
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool], { onApproval: 'message' });
    const result = await wrapped.invoke({});

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('pending_approval');
    expect(parsed.receiptId).toBe('receipt-200');
    expect(parsed.message).toContain('requires human approval');
    expect(parsed.message).toContain('receipt-200');
  });

  it('ApprovalRequiredError with onApproval="message" returns message', async () => {
    const error = new ApprovalRequiredError('send_email', 'receipt-300');
    const ledger = createThrowingLedger(error);
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool], { onApproval: 'message' });
    const result = await wrapped.invoke({});

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('pending_approval');
    expect(parsed.receiptId).toBe('receipt-300');
    expect(parsed.message).toContain('requires human approval');
  });

  it('wraps multiple tools', () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tools = [
      createMockTool({ name: 'tool_a', description: 'A' }),
      createMockTool({ name: 'tool_b', description: 'B' }),
    ];

    const wrapped = wrapLangChainTools(ledger, tools);

    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].name).toBe('tool_a');
    expect(wrapped[1].name).toBe('tool_b');
  });

  it('returns "{}" for undefined result', async () => {
    const ledger = {
      wrap: (
        _name: string,
        fn: (args: Record<string, unknown>) => unknown | Promise<unknown>,
        _opts?: Record<string, unknown>,
      ): WrappedFn => {
        return async (args: Record<string, unknown>) => {
          await fn(args);
          return { status: 'executed', receiptId: 'r', result: undefined } as LedgerResult;
        };
      },
    } as unknown as AgentLedger;
    const tool = createMockTool();

    const [wrapped] = wrapLangChainTools(ledger, [tool]);
    const result = await wrapped.invoke({});
    expect(result).toBe('{}');
  });
});

describe('wrapLangChainTool', () => {
  it('wraps a single tool', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tool = createMockTool({ name: 'single_tool', description: 'A single tool' });

    const wrapped = wrapLangChainTool(ledger, tool);

    expect(wrapped.name).toBe('single_tool');
    expect(wrapped.description).toBe('A single tool');

    const result = await wrapped.invoke({ to: 'test@example.com' });
    const parsed = JSON.parse(result);
    expect(parsed.sent).toBe(true);
  });

  it('respects options passed to single tool wrapper', async () => {
    const error = new LedgerDeniedError('single_tool', 'r-1', 'nope');
    const ledger = createThrowingLedger(error);
    const tool = createMockTool({ name: 'single_tool' });

    const wrapped = wrapLangChainTool(ledger, tool, { onDenied: 'message' });
    const result = await wrapped.invoke({});

    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('denied');
  });
});
