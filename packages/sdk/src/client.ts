import type {
  LedgerClientOptions,
  SessionConfig,
  ExecuteOptions,
  ExecuteResult,
  ReceiptData,
  VerifyResult,
  ToolDefinition,
} from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';
const DEFAULT_APPROVAL_TIMEOUT = 300_000;
const DEFAULT_POLL_INTERVAL = 2_000;

/**
 * Client SDK for Agent Ledger.
 *
 * Wraps the Agent Ledger HTTP API with a typed, ergonomic interface.
 * Handles approval polling, event callbacks, and tool registration.
 *
 * @example
 * ```ts
 * const ledger = new AgentLedger({
 *   session: { sessionId: 'sess-1', agentId: 'my-agent' },
 *   onPendingApproval: (e) => console.log(`Waiting: ${e.approvalUrl}`),
 * });
 *
 * const result = await ledger.execute('gmail.send', {
 *   to: ['alice@company.com'],
 *   subject: 'Hello',
 *   body: 'World',
 * }, { intent: 'Send greeting' });
 * ```
 */
export class AgentLedger {
  private baseUrl: string;
  private session: SessionConfig;
  private approvalTimeoutMs: number;
  private pollIntervalMs: number;
  private options: LedgerClientOptions;
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(options: LedgerClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.session = options.session;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.options = options;
  }

  /**
   * Register a tool definition for use with `callTool()`.
   * Tool definitions provide metadata and type-safe wrappers.
   */
  registerTool<TArgs = Record<string, unknown>>(def: Omit<ToolDefinition<TArgs>, 'execute'>): void {
    const toolDef: ToolDefinition = {
      ...def,
      execute: (args) => this.execute(def.name, args, { intent: def.description }),
    };
    this.tools.set(def.name, toolDef);
  }

  /** Get all registered tool definitions. */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool call through Agent Ledger.
   *
   * The call goes through:
   * 1. Policy evaluation (allow/deny/require_approval)
   * 2. If allowed: immediate execution + verification
   * 3. If require_approval: waits for human decision (unless noWait=true)
   * 4. If denied: returns immediately with error
   *
   * In all cases, a signed receipt is created.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const res = await fetch(`${this.baseUrl}/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: this.session,
        toolName,
        args,
        intent: options?.intent,
      }),
    });

    const data = (await res.json()) as ExecuteResult;

    if (data.status === 'denied') {
      this.options.onDenied?.({
        receiptId: data.receiptId,
        toolName,
        reason: data.error ?? 'Denied by policy',
      });
      return data;
    }

    if (data.status === 'pending_approval') {
      const webUrl = this.baseUrl.replace(':3001', ':3000');
      this.options.onPendingApproval?.({
        receiptId: data.receiptId,
        toolName,
        intent: options?.intent,
        approvalUrl: `${webUrl}/approvals`,
      });

      if (options?.noWait) return data;

      const receipt = await this.waitForApproval(data.receiptId);
      const finalStatus = receipt.status === 'executed' ? 'executed' : 'denied';
      const finalResult: ExecuteResult = {
        status: finalStatus as ExecuteResult['status'],
        receiptId: data.receiptId,
      };

      this.options.onReceiptFinalized?.({
        receiptId: data.receiptId,
        status: finalStatus,
        toolName,
        receipt,
      });

      return finalResult;
    }

    // Executed immediately
    if (data.receiptId) {
      try {
        const receipt = await this.getReceipt(data.receiptId);
        this.options.onReceiptFinalized?.({
          receiptId: data.receiptId,
          status: 'executed',
          toolName,
          receipt,
        });
      } catch {
        // Non-critical: callback failure shouldn't break the flow
      }
    }

    return data;
  }

  /**
   * Poll a receipt until it leaves pending_approval state.
   * Throws if the timeout is exceeded.
   */
  async waitForApproval(receiptId: string): Promise<ReceiptData> {
    const deadline = Date.now() + this.approvalTimeoutMs;
    while (Date.now() < deadline) {
      const receipt = await this.getReceipt(receiptId);
      if (receipt.status !== 'pending_approval') {
        return receipt;
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(
      `Approval timeout: receipt ${receiptId} still pending after ${this.approvalTimeoutMs}ms`,
    );
  }

  /** Fetch a single receipt by ID. */
  async getReceipt(id: string): Promise<ReceiptData> {
    const res = await fetch(`${this.baseUrl}/receipts/${id}`);
    if (!res.ok) throw new Error(`Receipt not found: ${id}`);
    return (await res.json()) as ReceiptData;
  }

  /** List receipts with optional status filter. */
  async listReceipts(options?: {
    status?: string;
    limit?: number;
  }): Promise<{ data: ReceiptData[]; cursor: string | null }> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    const res = await fetch(`${this.baseUrl}/receipts?${params}`);
    return (await res.json()) as { data: ReceiptData[]; cursor: string | null };
  }

  /** Verify a receipt's cryptographic signature. */
  async verifyReceipt(id: string): Promise<VerifyResult> {
    const res = await fetch(`${this.baseUrl}/receipts/${id}/verify`);
    return (await res.json()) as VerifyResult;
  }

  /** Programmatically approve a pending receipt. */
  async approve(
    receiptId: string,
    approvedBy: string,
    comment?: string,
  ): Promise<{ status: string; receiptId: string }> {
    const res = await fetch(`${this.baseUrl}/receipts/${receiptId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy, comment }),
    });
    return (await res.json()) as { status: string; receiptId: string };
  }

  /** Programmatically deny a pending receipt. */
  async deny(
    receiptId: string,
    approvedBy: string,
    comment?: string,
  ): Promise<{ status: string; receiptId: string }> {
    const res = await fetch(`${this.baseUrl}/receipts/${receiptId}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy, comment }),
    });
    return (await res.json()) as { status: string; receiptId: string };
  }

  /** Check if the Agent Ledger server is reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
