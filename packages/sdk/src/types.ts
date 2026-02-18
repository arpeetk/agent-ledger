export interface LedgerClientOptions {
  /** Base URL of the Agent Ledger server (default: http://127.0.0.1:3001) */
  baseUrl?: string;
  /** Session metadata attached to every tool call */
  session: SessionConfig;
  /** Maximum time (ms) to wait for approval before giving up (default: 300000 = 5min) */
  approvalTimeoutMs?: number;
  /** Polling interval (ms) when waiting for approval (default: 2000) */
  pollIntervalMs?: number;
  /** Called when a tool call is pending approval */
  onPendingApproval?: (event: PendingApprovalEvent) => void;
  /** Called when a receipt is finalized */
  onReceiptFinalized?: (event: ReceiptFinalizedEvent) => void;
  /** Called on policy deny */
  onDenied?: (event: DeniedEvent) => void;
}

export interface SessionConfig {
  sessionId: string;
  agentId: string;
  userId?: string;
  environment?: string;
}

export interface ExecuteOptions {
  /** Human-readable description of what the agent intends to do */
  intent?: string;
  /** If true, don't wait for approval — return immediately with pending status */
  noWait?: boolean;
}

export interface ExecuteResult {
  status: 'executed' | 'pending_approval' | 'denied';
  receiptId: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ReceiptData {
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
}

export interface PendingApprovalEvent {
  receiptId: string;
  toolName: string;
  intent?: string;
  approvalUrl: string;
}

export interface ReceiptFinalizedEvent {
  receiptId: string;
  status: string;
  toolName: string;
  receipt: ReceiptData;
}

export interface DeniedEvent {
  receiptId: string;
  toolName: string;
  reason: string;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters?: Record<string, ParameterDef>;
  execute: (args: TArgs) => Promise<ExecuteResult>;
}

export interface ParameterDef {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}
