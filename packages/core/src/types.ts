// ── Capabilities ──
export type Capability =
  | 'READ_ONLY'
  | 'EMAIL_DRAFT'
  | 'EMAIL_SEND'
  | 'CALENDAR_WRITE'
  | 'FILE_SHARE'
  | 'DELETE'
  | 'PUBLIC_POST'
  | 'PAYMENTS';

// ── Risk ──
export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskReason =
  | 'external_recipient'
  | 'contains_link'
  | 'many_recipients'
  | 'delete_action'
  | 'public_post';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
}

// ── Policy ──
export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

export interface PolicyResult {
  decision: PolicyDecision;
  matchedRuleIds: string[];
  explanation: string;
  policyId: string;
}

export interface PolicyRule {
  id: string;
  when: {
    capability?: Capability[];
    tool?: string[];
    any?: ArgPredicate[];
    all?: ArgPredicate[];
  };
  then: {
    decision: PolicyDecision;
    reason?: string;
  };
}

export interface ArgPredicate {
  arg: {
    path: string;
    matches?: string;
    gt?: number;
    lt?: number;
    max_len?: number;
  };
}

export interface PolicyFile {
  policy_id: string;
  defaults: { decision: PolicyDecision };
  params?: { org_domains?: string[] };
  rules: PolicyRule[];
}

// ── Session ──
export interface Session {
  sessionId: string;
  agentId: string;
  userId?: string;
  environment?: string;
}

// ── Tool Execute Request ──
export interface ToolExecuteRequest {
  session: Session;
  toolName: string;
  args: Record<string, unknown>;
  intent?: string;
}

// ── Receipt ──
export interface ActionReceipt {
  receipt_version: string;
  receipt_id: string;
  timestamp: string;

  session: Session;

  request: {
    tool_name: string;
    capability: Capability;
    risk: RiskAssessment;
    intent?: string;
    args_hash: string;
    redacted_args: Record<string, unknown>;
  };

  policy: {
    policy_id: string;
    decision: PolicyDecision;
    matched_rules: string[];
    explanation: string;
  };

  approval?: {
    status: 'approved' | 'denied' | null;
    actor?: string;
    comment?: string;
    timestamp?: string;
  };

  execution?: {
    status: 'success' | 'failed' | 'skipped';
    attempts: number;
    idempotency_key: string;
    result_hash?: string;
    latency_ms?: number;
  };

  verification?: {
    method: 'read_after_write' | 'none';
    status: 'verified' | 'unverified' | 'failed';
    after_snapshot?: Record<string, unknown>;
    diff_summary?: string;
  };

  redaction: {
    fields_redacted: string[];
  };

  signature?: {
    alg: string;
    public_key_id: string;
    signature_b64: string;
  };
}

// ── Tool Connector ──
export interface ToolConnector {
  name: string;
  capability: Capability;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
  getById?(id: string): Promise<Record<string, unknown> | null>;
}

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  artifactId?: string;
}

// ── Redaction ──
export interface RedactionResult {
  redactedArgs: Record<string, unknown>;
  fieldsRedacted: string[];
}
