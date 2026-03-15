import { describe, it, expect } from 'vitest';
import { withLedger } from '../src/index.js';
import { LedgerDeniedError } from '@agent-ledger/sdk';
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

describe('withLedger (Vercel AI adapter)', () => {
  it('wraps tools that have execute, passes through tools without execute', () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tools = {
      withExecute: {
        description: 'has execute',
        parameters: {},
        execute: async () => 'original',
      },
      withoutExecute: {
        description: 'no execute',
        parameters: {},
      },
    };

    const wrapped = withLedger(ledger, tools);

    expect(wrapped.withExecute.execute).toBeDefined();
    expect(wrapped.withExecute.execute).not.toBe(tools.withExecute.execute);
    expect(wrapped.withoutExecute.execute).toBeUndefined();
    expect(wrapped.withoutExecute.description).toBe('no execute');
  });

  it('executed tool returns the result from the wrapped function', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tools = {
      myTool: {
        description: 'test',
        parameters: {},
        execute: async (args: Record<string, unknown>) => ({ echo: args.input }),
      },
    };

    const wrapped = withLedger(ledger, tools);
    const result = await wrapped.myTool.execute!({ input: 'hello' });
    expect(result).toEqual({ echo: 'hello' });
  });

  it('denied tool with onDenied="message" returns message object instead of throwing', async () => {
    const error = new LedgerDeniedError('myTool', 'receipt-123', 'policy forbids this');
    const ledger = createThrowingLedger(error);
    const tools = {
      myTool: {
        description: 'test',
        parameters: {},
        execute: async () => 'should not reach',
      },
    };

    const wrapped = withLedger(ledger, tools, { onDenied: 'message' });
    const result = await wrapped.myTool.execute!({});

    expect(result).toEqual({
      _ledger: {
        status: 'denied',
        receiptId: 'receipt-123',
        message: 'This action was denied by policy: policy forbids this',
      },
    });
  });

  it('denied tool with onDenied="throw" throws LedgerDeniedError', async () => {
    const error = new LedgerDeniedError('myTool', 'receipt-123', 'not allowed');
    const ledger = createThrowingLedger(error);
    const tools = {
      myTool: {
        description: 'test',
        parameters: {},
        execute: async () => 'nope',
      },
    };

    const wrapped = withLedger(ledger, tools, { onDenied: 'throw' });
    await expect(wrapped.myTool.execute!({})).rejects.toThrow(LedgerDeniedError);
  });

  it('pending approval with onApproval="message" returns message object', async () => {
    const ledger = createMockLedger({
      status: 'pending_approval',
      receiptId: 'receipt-456',
      riskLevel: 'high',
      policyExplanation: 'Requires manager approval',
    });
    const tools = {
      myTool: {
        description: 'test',
        parameters: {},
        execute: async () => 'nope',
      },
    };

    const wrapped = withLedger(ledger, tools, { onApproval: 'message' });
    const result = (await wrapped.myTool.execute!({})) as {
      _ledger: { status: string; receiptId: string; message: string };
    };

    expect(result._ledger.status).toBe('pending_approval');
    expect(result._ledger.receiptId).toBe('receipt-456');
    expect(result._ledger.message).toContain('requires human approval');
    expect(result._ledger.message).toContain('receipt-456');
    expect(result._ledger.message).toContain('high');
  });

  it('defaults: onApproval="wait", onDenied="throw"', () => {
    let capturedOpts: Record<string, unknown> | undefined;
    const ledger = {
      wrap: (
        _name: string,
        fn: (args: Record<string, unknown>) => unknown | Promise<unknown>,
        opts?: Record<string, unknown>,
      ): WrappedFn => {
        capturedOpts = opts;
        return async (args: Record<string, unknown>) => {
          const result = await fn(args);
          return { status: 'executed', receiptId: 'r', result } as LedgerResult;
        };
      },
    } as unknown as AgentLedger;

    const tools = {
      myTool: {
        description: 'test',
        parameters: {},
        execute: async () => 'ok',
      },
    };

    withLedger(ledger, tools);
    expect(capturedOpts?.onApproval).toBe('wait');
  });

  it('preserves tool description and parameters', () => {
    const ledger = createMockLedger({ callOriginal: true });
    const tools = {
      myTool: {
        description: 'A useful tool',
        parameters: { type: 'object', properties: { x: { type: 'number' } } },
        execute: async () => 42,
      },
    };

    const wrapped = withLedger(ledger, tools);
    expect(wrapped.myTool.description).toBe('A useful tool');
    expect(wrapped.myTool.parameters).toEqual({
      type: 'object',
      properties: { x: { type: 'number' } },
    });
  });
});
