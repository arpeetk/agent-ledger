import type { PolicyDecision } from '@agent-ledger/core';

/** Configuration for creating an AgentLedger instance. */
export interface LedgerConfig {
  /** Base URL of the Agent Ledger server. Defaults to http://127.0.0.1:3001 */
  serverUrl?: string;
  /** Default session metadata attached to every tool call. */
  session: SessionConfig;
  /** How long to wait for approval before timing out (ms). Defaults to 300000 (5 min). */
  approvalTimeoutMs?: number;
  /** Polling interval when waiting for approval (ms). Defaults to 2000. */
  approvalPollIntervalMs?: number;
  /**
   * Execution mode:
   * - "gateway": Server evaluates policy AND executes via registered connectors.
   * - "local": Server evaluates policy only; SDK executes the tool locally.
   * Defaults to "local".
   */
  mode?: 'gateway' | 'local';
  /** Called when a tool call is pending approval. */
  onPendingApproval?: (event: PendingApprovalEvent) => void;
  /** Called when a tool call is denied. */
  onDenied?: (event: DeniedEvent) => void;
  /** Called after a tool call is executed. */
  onExecuted?: (event: ExecutedEvent) => void;
}

export interface SessionConfig {
  agentId: string;
  userId?: string;
  environment?: string;
  /** Override sessionId. If not provided, one is generated. */
  sessionId?: string;
}

/** Options for wrapping a single tool. */
export interface WrapOptions {
  /** Human-readable intent description for this tool call. */
  intent?: string;
  /**
   * What to do when approval is required:
   * - "wait": Block and poll until approved/denied (default).
   * - "throw": Throw an ApprovalRequiredError immediately.
   * - "skip": Return a pending result without blocking.
   */
  onApproval?: 'wait' | 'throw' | 'skip';
}

/** Result returned by the SDK after a tool call. */
export interface LedgerResult<T = unknown> {
  status: 'executed' | 'denied' | 'pending_approval';
  receiptId: string;
  result?: T;
  error?: string;
  decision: PolicyDecision;
  capability?: string;
  riskLevel?: string;
  riskReasons?: string[];
  policyExplanation?: string;
  approvalStatus?: string;
}

/** A receipt as returned by the server API. */
export interface Receipt {
  id: string;
  status: string;
  createdAt: string;
  finalizedAt: string | null;
  toolName: string;
  capability: string;
  riskLevel: string;
  riskReasons: string[];
  intent: string | null;
  redactedArgs: Record<string, unknown>;
  policyDecision: string;
  matchedRules: string[];
  policyExplanation: string | null;
  approvalStatus: string | null;
  approvedBy: string | null;
  approvalComment: string | null;
  executionStatus: string | null;
  executionAttempts: number;
  verificationStatus: string | null;
  diffSummary: string | null;
  signatureB64: string | null;
  sessionId: string;
  agentId: string;
  result?: Record<string, unknown>;
}

export interface PendingApprovalEvent {
  receiptId: string;
  toolName: string;
  capability: string;
  riskLevel: string;
  riskReasons: string[];
  policyExplanation: string;
}

export interface DeniedEvent {
  receiptId: string;
  toolName: string;
  capability: string;
  riskLevel: string;
  policyExplanation: string;
}

export interface ExecutedEvent {
  receiptId: string;
  toolName: string;
  result: unknown;
  latencyMs: number;
}

export interface EvaluateResponse {
  decision: PolicyDecision;
  receiptId: string;
  policyExplanation: string;
  capability: string;
  riskLevel: string;
  riskReasons: string[];
  matchedRules: string[];
}

export interface ExecuteResponse {
  status: 'executed' | 'pending_approval' | 'denied';
  receiptId: string;
  result?: Record<string, unknown>;
  error?: string;
}

/** A tool function that can be wrapped by the SDK. */
export type ToolFn<TArgs = Record<string, unknown>, TResult = unknown> = (
  args: TArgs,
) => Promise<TResult>;

/** A wrapped tool function with ledger metadata. */
export interface WrappedTool<TArgs = Record<string, unknown>, TResult = unknown> {
  (args: TArgs): Promise<LedgerResult<TResult>>;
  /** The original unwrapped tool function. */
  original: ToolFn<TArgs, TResult>;
  /** The tool name registered with the ledger. */
  toolName: string;
}
