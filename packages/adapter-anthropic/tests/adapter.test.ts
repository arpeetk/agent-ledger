import { describe, it, expect } from 'vitest';
import { createToolProcessor } from '../src/index.js';
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

const sampleDefinition = {
  name: 'send_email',
  description: 'Send an email',
  input_schema: {
    type: 'object' as const,
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
    },
    required: ['to', 'subject'],
  },
};

const sampleToolUse = {
  type: 'tool_use' as const,
  id: 'tu_123',
  name: 'send_email',
  input: { to: 'alice@example.com', subject: 'Hello' },
};

describe('createToolProcessor (Anthropic adapter)', () => {
  it('definitions() returns tool definitions', () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async () => ({ sent: true }),
      },
    });

    const defs = processor.definitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual(sampleDefinition);
  });

  it('process() returns tool_result block with content', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async (args) => ({ sent: true, to: args.to }),
      },
    });

    const result = await processor.process(sampleToolUse);

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('tu_123');
    expect(result.is_error).toBeUndefined();

    const content = JSON.parse(result.content);
    expect(content.sent).toBe(true);
    expect(content.to).toBe('alice@example.com');
  });

  it('process() with denied tool and onDenied="message" returns denial message', async () => {
    const error = new LedgerDeniedError('send_email', 'receipt-789', 'external recipient');
    const ledger = createThrowingLedger(error);
    const processor = createToolProcessor(
      ledger,
      {
        send_email: {
          definition: sampleDefinition,
          handler: async () => ({ sent: true }),
        },
      },
      { onDenied: 'message' },
    );

    const result = await processor.process(sampleToolUse);

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('tu_123');
    expect(result.is_error).toBeUndefined();

    const content = JSON.parse(result.content);
    expect(content.status).toBe('denied');
    expect(content.reason).toBe('external recipient');
    expect(content.message).toContain('denied by policy');
  });

  it('process() with unknown tool returns error', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async () => ({ sent: true }),
      },
    });

    const unknownToolUse = {
      type: 'tool_use' as const,
      id: 'tu_456',
      name: 'unknown_tool',
      input: {},
    };

    const result = await processor.process(unknownToolUse);

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('tu_456');
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown tool: unknown_tool');
  });

  it('processAll() processes multiple tool uses in parallel', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async (args) => ({ sent: true, to: args.to }),
      },
    });

    const toolUses = [
      { ...sampleToolUse, id: 'tu_1' },
      { ...sampleToolUse, id: 'tu_2' },
    ];

    const results = await processor.processAll(toolUses);

    expect(results).toHaveLength(2);
    expect(results[0].tool_use_id).toBe('tu_1');
    expect(results[1].tool_use_id).toBe('tu_2');
    expect(results[0].type).toBe('tool_result');
    expect(results[1].type).toBe('tool_result');
  });

  it('processAll({ sequential: true }) processes sequentially', async () => {
    const executionOrder: string[] = [];
    const ledger = {
      wrap: (
        _name: string,
        fn: (args: Record<string, unknown>) => unknown | Promise<unknown>,
        _opts?: Record<string, unknown>,
      ): WrappedFn => {
        return async (args: Record<string, unknown>) => {
          executionOrder.push(String(args._id));
          await new Promise((r) => setTimeout(r, 10));
          const result = await fn(args);
          return { status: 'executed', receiptId: 'r', result } as LedgerResult;
        };
      },
    } as unknown as AgentLedger;

    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async (args) => ({ processed: args._id }),
      },
    });

    const toolUses = [
      { ...sampleToolUse, id: 'tu_1', input: { ...sampleToolUse.input, _id: 'first' } },
      { ...sampleToolUse, id: 'tu_2', input: { ...sampleToolUse.input, _id: 'second' } },
    ];

    const results = await processor.processAll(toolUses, { sequential: true });

    expect(results).toHaveLength(2);
    expect(executionOrder).toEqual(['first', 'second']);
  });

  it('process() returns string result as-is without double-encoding', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async () => 'plain text result',
      },
    });

    const result = await processor.process(sampleToolUse);
    expect(result.content).toBe('plain text result');
  });

  it('process() returns "{}" for undefined result', async () => {
    const ledger = createMockLedger({ callOriginal: true });
    const processor = createToolProcessor(ledger, {
      send_email: {
        definition: sampleDefinition,
        handler: async () => undefined,
      },
    });

    const result = await processor.process(sampleToolUse);
    expect(result.content).toBe('{}');
  });
});
