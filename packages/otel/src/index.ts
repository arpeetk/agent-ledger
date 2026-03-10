import { trace, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type {
  WrapOptions,
  LedgerResult,
  ToolFn,
  WrappedTool,
  EvaluateResponse,
  Receipt,
} from '@agent-ledger/sdk';

const TRACER_NAME = '@agent-ledger/otel';
const TRACER_VERSION = '0.1.0';

/** Semantic attribute keys for Agent Ledger spans. */
export const LedgerAttributes = {
  TOOL_NAME: 'agent_ledger.tool.name',
  RECEIPT_ID: 'agent_ledger.receipt.id',
  CAPABILITY: 'agent_ledger.capability',
  RISK_LEVEL: 'agent_ledger.risk.level',
  RISK_REASONS: 'agent_ledger.risk.reasons',
  POLICY_DECISION: 'agent_ledger.policy.decision',
  POLICY_EXPLANATION: 'agent_ledger.policy.explanation',
  EXECUTION_MODE: 'agent_ledger.execution.mode',
  STATUS: 'agent_ledger.status',
  SESSION_ID: 'agent_ledger.session.id',
  AGENT_ID: 'agent_ledger.agent.id',
  ON_APPROVAL: 'agent_ledger.on_approval',
} as const;

/**
 * Public interface of AgentLedger that can be instrumented.
 * Matches the AgentLedger class's public methods without requiring the concrete class type.
 */
export interface LedgerLike {
  getSessionId(): string;
  wrap<TArgs extends Record<string, unknown>, TResult>(
    toolName: string,
    fn: ToolFn<TArgs, TResult>,
    options?: WrapOptions,
  ): WrappedTool<TArgs, TResult>;
  wrapAll<T extends Record<string, ToolFn>>(
    tools: T,
    options?: WrapOptions,
  ): { [K in keyof T]: WrappedTool<Parameters<T[K]>[0], Awaited<ReturnType<T[K]>>> };
  evaluate(
    toolName: string,
    args: Record<string, unknown>,
    intent?: string,
  ): Promise<EvaluateResponse>;
  execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: WrapOptions,
  ): Promise<LedgerResult>;
  getReceipt(id: string): Promise<Receipt>;
  listReceipts(options?: {
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: Receipt[]; cursor: string | null }>;
  verifyReceipt(id: string): Promise<{ valid: boolean }>;
  health(): Promise<boolean>;
  report(
    receiptId: string,
    report: {
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
      latencyMs?: number;
    },
  ): Promise<{ receiptId: string; status: string }>;
}

/** Options for the instrumented ledger. */
export interface InstrumentOptions {
  /** Custom OpenTelemetry tracer. If not provided, uses a default tracer. */
  tracer?: Tracer;
  /**
   * Whether to record tool arguments as span attributes.
   * Disabled by default for security (args may contain PII).
   */
  recordArgs?: boolean;
  /**
   * Whether to record tool results as span attributes.
   * Disabled by default for security.
   */
  recordResults?: boolean;
}

/**
 * Wrap an AgentLedger instance with OpenTelemetry instrumentation.
 *
 * Every SDK method call (wrap, evaluate, execute, getReceipt, etc.)
 * is traced as an OpenTelemetry span with semantic attributes.
 *
 * @example
 * ```ts
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { instrument } from '@agent-ledger/otel';
 *
 * const ledger = instrument(new AgentLedger({
 *   session: { agentId: 'my-agent' },
 * }));
 *
 * // All tool calls now emit OpenTelemetry spans
 * const safe = ledger.wrap('gmail.send', sendEmail);
 * const result = await safe({ to: 'bob@co.com', subject: 'Hi' });
 * ```
 */
export function instrument(ledger: LedgerLike, options?: InstrumentOptions): LedgerLike {
  const tracer = options?.tracer ?? trace.getTracer(TRACER_NAME, TRACER_VERSION);
  const recordArgs = options?.recordArgs ?? false;
  const recordResults = options?.recordResults ?? false;

  return new InstrumentedLedger(ledger, tracer, recordArgs, recordResults);
}

/** Safely stringify values, handling circular references. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

class InstrumentedLedger implements LedgerLike {
  constructor(
    private inner: LedgerLike,
    private tracer: Tracer,
    private recordArgs: boolean,
    private recordResults: boolean,
  ) {}

  getSessionId(): string {
    return this.inner.getSessionId();
  }

  wrap<TArgs extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(
    toolName: string,
    fn: ToolFn<TArgs, TResult>,
    options?: WrapOptions,
  ): WrappedTool<TArgs, TResult> {
    const innerWrapped = this.inner.wrap(toolName, fn, options);

    const instrumented = async (args: TArgs): Promise<LedgerResult<TResult>> => {
      return this.tracer.startActiveSpan(
        `agent_ledger.tool ${toolName}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            [LedgerAttributes.TOOL_NAME]: toolName,
            [LedgerAttributes.SESSION_ID]: this.inner.getSessionId(),
            [LedgerAttributes.ON_APPROVAL]: options?.onApproval ?? 'wait',
            ...(this.recordArgs ? { 'agent_ledger.args': safeStringify(args) } : {}),
          },
        },
        async (span) => {
          try {
            const result = await innerWrapped(args);

            span.setAttributes({
              [LedgerAttributes.STATUS]: result.status,
              [LedgerAttributes.RECEIPT_ID]: result.receiptId,
              ...(result.decision ? { [LedgerAttributes.POLICY_DECISION]: result.decision } : {}),
              ...(result.capability ? { [LedgerAttributes.CAPABILITY]: result.capability } : {}),
              ...(result.riskLevel ? { [LedgerAttributes.RISK_LEVEL]: result.riskLevel } : {}),
              ...(result.policyExplanation
                ? { [LedgerAttributes.POLICY_EXPLANATION]: result.policyExplanation }
                : {}),
              ...(this.recordResults && result.result
                ? { 'agent_ledger.result': safeStringify(result.result) }
                : {}),
            });

            if (result.riskReasons?.length) {
              span.setAttribute(LedgerAttributes.RISK_REASONS, result.riskReasons);
            }

            if (result.status === 'denied') {
              span.setStatus({ code: SpanStatusCode.ERROR, message: result.error ?? 'Denied' });
            } else {
              span.setStatus({ code: SpanStatusCode.OK });
            }

            span.end();
            return result;
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            span.end();
            throw err;
          }
        },
      );
    };

    instrumented.original = fn;
    instrumented.toolName = toolName;

    return instrumented as WrappedTool<TArgs, TResult>;
  }

  wrapAll<T extends Record<string, ToolFn>>(
    tools: T,
    options?: WrapOptions,
  ): { [K in keyof T]: WrappedTool<Parameters<T[K]>[0], Awaited<ReturnType<T[K]>>> } {
    const result = {} as Record<string, WrappedTool>;
    for (const [name, fn] of Object.entries(tools)) {
      result[name] = this.wrap(name, fn, options);
    }
    return result as {
      [K in keyof T]: WrappedTool<Parameters<T[K]>[0], Awaited<ReturnType<T[K]>>>;
    };
  }

  async evaluate(
    toolName: string,
    args: Record<string, unknown>,
    intent?: string,
  ): Promise<EvaluateResponse> {
    return this.tracer.startActiveSpan(
      `agent_ledger.evaluate ${toolName}`,
      { kind: SpanKind.CLIENT, attributes: { [LedgerAttributes.TOOL_NAME]: toolName } },
      async (span) => {
        try {
          const result = await this.inner.evaluate(toolName, args, intent);
          span.setAttributes({
            [LedgerAttributes.RECEIPT_ID]: result.receiptId,
            [LedgerAttributes.POLICY_DECISION]: result.decision,
            [LedgerAttributes.CAPABILITY]: result.capability,
            [LedgerAttributes.RISK_LEVEL]: result.riskLevel,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: WrapOptions,
  ): Promise<LedgerResult> {
    return this.tracer.startActiveSpan(
      `agent_ledger.execute ${toolName}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [LedgerAttributes.TOOL_NAME]: toolName,
          [LedgerAttributes.EXECUTION_MODE]: 'gateway',
        },
      },
      async (span) => {
        try {
          const result = await this.inner.execute(toolName, args, options);
          span.setAttributes({
            [LedgerAttributes.STATUS]: result.status,
            [LedgerAttributes.RECEIPT_ID]: result.receiptId,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }

  async getReceipt(id: string): Promise<Receipt> {
    return this.tracer.startActiveSpan(
      'agent_ledger.getReceipt',
      { kind: SpanKind.CLIENT, attributes: { [LedgerAttributes.RECEIPT_ID]: id } },
      async (span) => {
        try {
          const result = await this.inner.getReceipt(id);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }

  async listReceipts(options?: {
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: Receipt[]; cursor: string | null }> {
    return this.tracer.startActiveSpan(
      'agent_ledger.listReceipts',
      { kind: SpanKind.CLIENT },
      async (span) => {
        try {
          const result = await this.inner.listReceipts(options);
          span.setAttribute('agent_ledger.receipts.count', result.data.length);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }

  async verifyReceipt(id: string): Promise<{ valid: boolean }> {
    return this.tracer.startActiveSpan(
      'agent_ledger.verifyReceipt',
      { kind: SpanKind.CLIENT, attributes: { [LedgerAttributes.RECEIPT_ID]: id } },
      async (span) => {
        try {
          const result = await this.inner.verifyReceipt(id);
          span.setAttribute('agent_ledger.signature.valid', result.valid);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }

  async health(): Promise<boolean> {
    return this.inner.health();
  }

  async report(
    receiptId: string,
    report: {
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
      latencyMs?: number;
    },
  ): Promise<{ receiptId: string; status: string }> {
    return this.tracer.startActiveSpan(
      'agent_ledger.report',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [LedgerAttributes.RECEIPT_ID]: receiptId,
          'agent_ledger.report.success': report.success,
          ...(report.latencyMs != null
            ? { 'agent_ledger.report.latency_ms': report.latencyMs }
            : {}),
        },
      },
      async (span) => {
        try {
          const result = await this.inner.report(receiptId, report);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.end();
          throw err;
        }
      },
    );
  }
}
