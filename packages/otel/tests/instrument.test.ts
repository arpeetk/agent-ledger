import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instrument, LedgerAttributes } from '../src/index.js';
import type { LedgerLike } from '../src/index.js';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

// ── Mock spans and tracer ──

function createMockSpan() {
  return {
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
}

function createMockTracer() {
  const span = createMockSpan();
  return {
    span,
    tracer: {
      startActiveSpan: vi.fn((name: string, options: unknown, fn: (s: typeof span) => unknown) => {
        return fn(span);
      }),
    },
  };
}

// ── Mock ledger ──

function createMockLedger(): LedgerLike {
  return {
    getSessionId: vi.fn().mockReturnValue('session-123'),
    wrap: vi.fn().mockImplementation((toolName, fn) => {
      const wrapped = vi.fn().mockResolvedValue({
        status: 'executed',
        receiptId: 'receipt-abc',
        result: { sent: true },
        decision: 'allow',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
      });
      wrapped.original = fn;
      wrapped.toolName = toolName;
      return wrapped;
    }),
    wrapAll: vi.fn(),
    evaluate: vi.fn().mockResolvedValue({
      decision: 'allow',
      receiptId: 'receipt-eval-1',
      capability: 'EMAIL_SEND',
      riskLevel: 'low',
      riskReasons: [],
      matchedRules: ['allow_internal'],
      policyExplanation: 'Allowed by policy',
    }),
    execute: vi.fn().mockResolvedValue({
      status: 'executed',
      receiptId: 'receipt-exec-1',
      result: { done: true },
      decision: 'allow',
    }),
    getReceipt: vi.fn().mockResolvedValue({
      id: 'receipt-get-1',
      status: 'executed',
      toolName: 'test_tool',
    }),
    listReceipts: vi.fn().mockResolvedValue({
      data: [{ id: '1' }, { id: '2' }],
      cursor: null,
    }),
    verifyReceipt: vi.fn().mockResolvedValue({ valid: true }),
    health: vi.fn().mockResolvedValue(true),
    report: vi.fn().mockResolvedValue({ receiptId: 'receipt-rpt-1', status: 'executed' }),
  };
}

describe('instrument', () => {
  let mockLedger: LedgerLike;
  let mockTracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    mockLedger = createMockLedger();
    mockTracer = createMockTracer();
  });

  it('returns a LedgerLike with all public methods', () => {
    const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });

    expect(instrumented.getSessionId).toBeDefined();
    expect(instrumented.wrap).toBeDefined();
    expect(instrumented.wrapAll).toBeDefined();
    expect(instrumented.evaluate).toBeDefined();
    expect(instrumented.execute).toBeDefined();
    expect(instrumented.getReceipt).toBeDefined();
    expect(instrumented.listReceipts).toBeDefined();
    expect(instrumented.verifyReceipt).toBeDefined();
    expect(instrumented.health).toBeDefined();
    expect(instrumented.report).toBeDefined();
  });

  it('delegates getSessionId to inner ledger', () => {
    const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
    expect(instrumented.getSessionId()).toBe('session-123');
  });

  it('delegates health to inner ledger without tracing', async () => {
    const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
    const result = await instrumented.health();
    expect(result).toBe(true);
    // health() should NOT create a span (it's a simple check)
    expect(mockTracer.tracer.startActiveSpan).not.toHaveBeenCalled();
  });

  describe('wrap', () => {
    it('creates a span on tool execution', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const handler = vi.fn().mockResolvedValue({ sent: true });
      const wrapped = instrumented.wrap('gmail.send', handler);

      await wrapped({ to: 'bob@co.com' });

      expect(mockTracer.tracer.startActiveSpan).toHaveBeenCalledWith(
        'agent_ledger.tool gmail.send',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            [LedgerAttributes.TOOL_NAME]: 'gmail.send',
            [LedgerAttributes.SESSION_ID]: 'session-123',
          }),
        }),
        expect.any(Function),
      );
    });

    it('sets result attributes on span', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('gmail.send', vi.fn());

      await wrapped({ to: 'bob@co.com' });

      expect(mockTracer.span.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          [LedgerAttributes.STATUS]: 'executed',
          [LedgerAttributes.RECEIPT_ID]: 'receipt-abc',
          [LedgerAttributes.POLICY_DECISION]: 'allow',
          [LedgerAttributes.CAPABILITY]: 'EMAIL_SEND',
          [LedgerAttributes.RISK_LEVEL]: 'low',
        }),
      );
    });

    it('sets OK status on successful execution', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('gmail.send', vi.fn());

      await wrapped({});

      expect(mockTracer.span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockTracer.span.end).toHaveBeenCalled();
    });

    it('sets ERROR status on denied execution', async () => {
      // Override mock to return denied
      (mockLedger.wrap as ReturnType<typeof vi.fn>).mockImplementation((toolName, fn) => {
        const w = vi.fn().mockResolvedValue({
          status: 'denied',
          receiptId: 'receipt-denied',
          error: 'Not allowed',
          decision: 'deny',
        });
        w.original = fn;
        w.toolName = toolName;
        return w;
      });

      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('public.post', vi.fn());

      await wrapped({});

      expect(mockTracer.span.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Not allowed',
      });
    });

    it('records exception on thrown error', async () => {
      const error = new Error('Network failure');
      (mockLedger.wrap as ReturnType<typeof vi.fn>).mockImplementation((toolName, fn) => {
        const w = vi.fn().mockRejectedValue(error);
        w.original = fn;
        w.toolName = toolName;
        return w;
      });

      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('gmail.send', vi.fn());

      await expect(wrapped({})).rejects.toThrow('Network failure');

      expect(mockTracer.span.recordException).toHaveBeenCalledWith(error);
      expect(mockTracer.span.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Network failure',
      });
      expect(mockTracer.span.end).toHaveBeenCalled();
    });

    it('does not record args by default', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('gmail.send', vi.fn());

      await wrapped({ to: 'bob@co.com', secret: 'password123' });

      const attrs = mockTracer.tracer.startActiveSpan.mock.calls[0][1].attributes;
      expect(attrs['agent_ledger.args']).toBeUndefined();
    });

    it('records args when recordArgs is true', async () => {
      const instrumented = instrument(mockLedger, {
        tracer: mockTracer.tracer as never,
        recordArgs: true,
      });
      const wrapped = instrumented.wrap('gmail.send', vi.fn());

      await wrapped({ to: 'bob@co.com' });

      const attrs = mockTracer.tracer.startActiveSpan.mock.calls[0][1].attributes;
      expect(attrs['agent_ledger.args']).toBe('{"to":"bob@co.com"}');
    });

    it('preserves original and toolName on wrapped function', () => {
      const handler = vi.fn();
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      const wrapped = instrumented.wrap('gmail.send', handler);

      expect(wrapped.original).toBe(handler);
      expect(wrapped.toolName).toBe('gmail.send');
    });
  });

  describe('evaluate', () => {
    it('creates a span with tool name and policy decision', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.evaluate('gmail.send', { to: 'bob@co.com' });

      expect(mockTracer.tracer.startActiveSpan).toHaveBeenCalledWith(
        'agent_ledger.evaluate gmail.send',
        expect.any(Object),
        expect.any(Function),
      );
      expect(mockTracer.span.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          [LedgerAttributes.POLICY_DECISION]: 'allow',
          [LedgerAttributes.CAPABILITY]: 'EMAIL_SEND',
        }),
      );
    });
  });

  describe('execute', () => {
    it('creates a span with gateway mode', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.execute('gmail.send', { to: 'bob@co.com' });

      expect(mockTracer.tracer.startActiveSpan).toHaveBeenCalledWith(
        'agent_ledger.execute gmail.send',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [LedgerAttributes.EXECUTION_MODE]: 'gateway',
          }),
        }),
        expect.any(Function),
      );
    });
  });

  describe('getReceipt', () => {
    it('creates a span with receipt ID', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.getReceipt('receipt-123');

      expect(mockTracer.tracer.startActiveSpan).toHaveBeenCalledWith(
        'agent_ledger.getReceipt',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [LedgerAttributes.RECEIPT_ID]: 'receipt-123',
          }),
        }),
        expect.any(Function),
      );
    });
  });

  describe('listReceipts', () => {
    it('records count of returned receipts', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.listReceipts();

      expect(mockTracer.span.setAttribute).toHaveBeenCalledWith('agent_ledger.receipts.count', 2);
    });
  });

  describe('verifyReceipt', () => {
    it('records signature validity', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.verifyReceipt('receipt-123');

      expect(mockTracer.span.setAttribute).toHaveBeenCalledWith(
        'agent_ledger.signature.valid',
        true,
      );
    });
  });

  describe('report', () => {
    it('creates a span with report metadata', async () => {
      const instrumented = instrument(mockLedger, { tracer: mockTracer.tracer as never });
      await instrumented.report('receipt-123', {
        success: true,
        latencyMs: 42,
      });

      expect(mockTracer.tracer.startActiveSpan).toHaveBeenCalledWith(
        'agent_ledger.report',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [LedgerAttributes.RECEIPT_ID]: 'receipt-123',
            'agent_ledger.report.success': true,
            'agent_ledger.report.latency_ms': 42,
          }),
        }),
        expect.any(Function),
      );
    });
  });
});
