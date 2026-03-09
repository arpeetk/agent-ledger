import { randomUUID } from 'node:crypto';
import type {
  LedgerConfig,
  WrapOptions,
  LedgerResult,
  Receipt,
  ToolFn,
  WrappedTool,
  EvaluateResponse,
  ExecuteResponse,
} from './types.js';
import { ApprovalRequiredError, LedgerDeniedError, LedgerError } from './errors.js';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3001';
const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export class AgentLedger {
  private serverUrl: string;
  private sessionId: string;
  private config: LedgerConfig;

  constructor(config: LedgerConfig) {
    this.config = config;
    this.serverUrl = (config.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/$/, '');
    this.sessionId = config.session.sessionId ?? randomUUID();
  }

  /** Get the current session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Wrap a tool function so every call is routed through Agent Ledger.
   *
   * In "local" mode (default): SDK asks the server to evaluate policy,
   * then executes the tool locally if allowed, and reports the result.
   *
   * In "gateway" mode: SDK sends the tool call to the server, which
   * executes it via registered connectors.
   */
  wrap<TArgs extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(
    toolName: string,
    fn: ToolFn<TArgs, TResult>,
    options?: WrapOptions,
  ): WrappedTool<TArgs, TResult> {
    const mode = this.config.mode ?? 'local';
    const onApproval = options?.onApproval ?? 'wait';

    const wrapped = async (args: TArgs): Promise<LedgerResult<TResult>> => {
      if (mode === 'gateway') {
        return this.executeGateway<TResult>(toolName, args, options);
      }
      return this.executeLocal(toolName, fn, args, options, onApproval);
    };

    wrapped.original = fn;
    wrapped.toolName = toolName;

    return wrapped as WrappedTool<TArgs, TResult>;
  }

  /**
   * Wrap multiple tools at once.
   * Returns a record of wrapped tools keyed by tool name.
   */
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

  /**
   * Evaluate a tool call without executing it.
   * Returns the policy decision. Used for custom control flows.
   */
  async evaluate(
    toolName: string,
    args: Record<string, unknown>,
    intent?: string,
  ): Promise<EvaluateResponse> {
    const res = await this.fetch('/tools/evaluate', {
      method: 'POST',
      body: {
        session: this.buildSession(),
        toolName,
        args,
        intent,
      },
      allowedStatuses: [200, 202, 403],
    });
    return res as EvaluateResponse;
  }

  /**
   * Execute a tool call through the server gateway.
   * The server handles execution via registered connectors.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: WrapOptions,
  ): Promise<LedgerResult> {
    return this.executeGateway(toolName, args, options);
  }

  /** Fetch a receipt by ID. */
  async getReceipt(id: string): Promise<Receipt> {
    return this.fetch(`/receipts/${id}`) as Promise<Receipt>;
  }

  /** List receipts with optional filters. */
  async listReceipts(options?: {
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: Receipt[]; cursor: string | null }> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    return this.fetch(`/receipts${qs ? `?${qs}` : ''}`) as Promise<{
      data: Receipt[];
      cursor: string | null;
    }>;
  }

  /** Verify a receipt's signature. */
  async verifyReceipt(id: string): Promise<{ valid: boolean }> {
    return this.fetch(`/receipts/${id}/verify`) as Promise<{ valid: boolean }>;
  }

  /** Check server health. */
  async health(): Promise<boolean> {
    try {
      const res = await globalThis.fetch(`${this.serverUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Report a client-side execution result to finalize a receipt. */
  async report(
    receiptId: string,
    report: {
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
      latencyMs?: number;
    },
  ): Promise<{ receiptId: string; status: string }> {
    return this.fetch(`/receipts/${receiptId}/report`, {
      method: 'POST',
      body: report,
    }) as Promise<{ receiptId: string; status: string }>;
  }

  // ── Private methods ──

  private async executeGateway<TResult>(
    toolName: string,
    args: Record<string, unknown>,
    options?: WrapOptions,
  ): Promise<LedgerResult<TResult>> {
    const onApproval = options?.onApproval ?? 'wait';
    const res = (await this.fetch('/tools/execute', {
      method: 'POST',
      body: {
        session: this.buildSession(),
        toolName,
        args,
        intent: options?.intent,
      },
      allowedStatuses: [200, 202, 403],
    })) as ExecuteResponse;

    if (res.status === 'denied') {
      const event = {
        receiptId: res.receiptId,
        toolName,
        capability: '',
        riskLevel: '',
        policyExplanation: res.error ?? '',
      };
      this.config.onDenied?.(event);
      if (onApproval !== 'skip') {
        throw new LedgerDeniedError(toolName, res.receiptId, res.error ?? 'Denied by policy');
      }
      return {
        status: 'denied',
        receiptId: res.receiptId,
        error: res.error,
        decision: 'deny',
      };
    }

    if (res.status === 'pending_approval') {
      const pending = {
        receiptId: res.receiptId,
        toolName,
        capability: '',
        riskLevel: '',
        riskReasons: [],
        policyExplanation: '',
      };
      this.config.onPendingApproval?.(pending);

      if (onApproval === 'throw') {
        throw new ApprovalRequiredError(toolName, res.receiptId);
      }
      if (onApproval === 'skip') {
        return {
          status: 'pending_approval',
          receiptId: res.receiptId,
          decision: 'require_approval',
        };
      }

      // Wait for approval
      const final = await this.pollForResolution(res.receiptId);
      if (final.status === 'denied') {
        throw new LedgerDeniedError(toolName, res.receiptId, 'Denied during approval');
      }
      return {
        status: 'executed',
        receiptId: res.receiptId,
        result: final.result as TResult | undefined,
        decision: 'require_approval',
        approvalStatus: final.approvalStatus ?? undefined,
      };
    }

    this.config.onExecuted?.({
      receiptId: res.receiptId,
      toolName,
      result: res.result,
      latencyMs: 0,
    });

    return {
      status: 'executed',
      receiptId: res.receiptId,
      result: res.result as TResult | undefined,
      decision: 'allow',
    };
  }

  private async executeLocal<TArgs extends Record<string, unknown>, TResult>(
    toolName: string,
    fn: ToolFn<TArgs, TResult>,
    args: TArgs,
    options: WrapOptions | undefined,
    onApproval: 'wait' | 'throw' | 'skip',
  ): Promise<LedgerResult<TResult>> {
    // Step 1: Evaluate policy
    const evaluation = await this.evaluate(toolName, args, options?.intent);

    if (evaluation.decision === 'deny') {
      this.config.onDenied?.({
        receiptId: evaluation.receiptId,
        toolName,
        capability: evaluation.capability,
        riskLevel: evaluation.riskLevel,
        policyExplanation: evaluation.policyExplanation,
      });
      throw new LedgerDeniedError(toolName, evaluation.receiptId, evaluation.policyExplanation);
    }

    if (evaluation.decision === 'require_approval') {
      this.config.onPendingApproval?.({
        receiptId: evaluation.receiptId,
        toolName,
        capability: evaluation.capability,
        riskLevel: evaluation.riskLevel,
        riskReasons: evaluation.riskReasons,
        policyExplanation: evaluation.policyExplanation,
      });

      if (onApproval === 'throw') {
        throw new ApprovalRequiredError(toolName, evaluation.receiptId);
      }
      if (onApproval === 'skip') {
        return {
          status: 'pending_approval',
          receiptId: evaluation.receiptId,
          decision: 'require_approval',
          capability: evaluation.capability,
          riskLevel: evaluation.riskLevel,
          riskReasons: evaluation.riskReasons,
          policyExplanation: evaluation.policyExplanation,
        };
      }

      // Wait for approval
      const resolution = await this.pollForResolution(evaluation.receiptId);
      if (resolution.status === 'denied') {
        throw new LedgerDeniedError(toolName, evaluation.receiptId, 'Denied during approval');
      }
      // Fall through to execute after approval
    }

    // Step 2: Execute locally
    const start = Date.now();
    let result: TResult;
    try {
      result = await fn(args);
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.report(evaluation.receiptId, { success: false, error: errorMsg, latencyMs });
      throw err;
    }
    const latencyMs = Date.now() - start;

    // Step 3: Report result
    const resultForReport =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : { value: result };
    await this.report(evaluation.receiptId, { success: true, result: resultForReport, latencyMs });

    this.config.onExecuted?.({ receiptId: evaluation.receiptId, toolName, result, latencyMs });

    return {
      status: 'executed',
      receiptId: evaluation.receiptId,
      result,
      decision: evaluation.decision,
      capability: evaluation.capability,
      riskLevel: evaluation.riskLevel,
      riskReasons: evaluation.riskReasons,
      policyExplanation: evaluation.policyExplanation,
    };
  }

  private async pollForResolution(receiptId: string): Promise<Receipt> {
    const timeout = this.config.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    const interval = this.config.approvalPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await sleep(interval);
      const receipt = await this.getReceipt(receiptId);
      if (receipt.status !== 'pending_approval' && receipt.status !== 'awaiting_execution') {
        return receipt;
      }
    }

    throw new LedgerError(`Approval timed out after ${timeout}ms for receipt ${receiptId}`);
  }

  private buildSession() {
    return {
      sessionId: this.sessionId,
      agentId: this.config.session.agentId,
      userId: this.config.session.userId,
      environment: this.config.session.environment,
    };
  }

  private async fetch(
    path: string,
    options?: { method?: string; body?: unknown; allowedStatuses?: number[] },
  ): Promise<unknown> {
    const url = `${this.serverUrl}${path}`;
    const init: RequestInit = {
      method: options?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (options?.body) {
      init.body = JSON.stringify(options.body);
    }

    const res = await globalThis.fetch(url, init);

    const allowed = options?.allowedStatuses ?? [200];
    if (!res.ok && !allowed.includes(res.status)) {
      const text = await res.text().catch(() => '');
      throw new LedgerError(`HTTP ${res.status} ${options?.method ?? 'GET'} ${path}: ${text}`);
    }

    return res.json();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
