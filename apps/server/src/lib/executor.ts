import { createHash } from 'node:crypto';
import {
  stableStringify,
  getCapability,
  assessRisk,
  redactArgs,
  hashValue,
  signReceipt,
} from '@agent-ledger/core';
import type {
  ActionReceipt,
  ToolExecuteRequest,
  ToolResult,
} from '@agent-ledger/core';
import { prisma } from './db.js';
import { getKeyPair } from './keys.js';
import { getPolicyEngine } from './policy-loader.js';
import { appendToLedger } from './ledger.js';
import { ConnectorRegistry } from '@agent-ledger/connectors';

const registry = new ConnectorRegistry(prisma);

function computeIdempotencyKey(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const input = sessionId + toolName + stableStringify(args);
  return createHash('sha256').update(input).digest('hex');
}

export async function executeToolCall(req: ToolExecuteRequest): Promise<{
  status: 'executed' | 'pending_approval' | 'denied';
  receiptId: string;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const engine = getPolicyEngine();
  const capability = getCapability(req.toolName);
  const risk = assessRisk(capability, req.args, engine.orgDomains);
  const policy = engine.evaluate(capability, req.toolName, req.args);
  const { redactedArgs, fieldsRedacted } = redactArgs(req.args);
  const argsHash = hashValue(stableStringify(req.args));
  const idempotencyKey = computeIdempotencyKey(req.session.sessionId, req.toolName, req.args);

  // Check idempotency
  const existing = await prisma.receipt.findFirst({
    where: { idempotencyKey, executionStatus: 'success' },
  });
  if (existing) {
    return {
      status: 'executed',
      receiptId: existing.id,
      result: { replay: true, originalReceiptId: existing.id },
    };
  }

  // Create receipt record BEFORE execution
  const receipt = await prisma.receipt.create({
    data: {
      status: policy.decision === 'allow' ? 'executed' : policy.decision === 'deny' ? 'denied' : 'pending_approval',
      sessionId: req.session.sessionId,
      agentId: req.session.agentId,
      userId: req.session.userId,
      environment: req.session.environment,
      toolName: req.toolName,
      capability,
      riskLevel: risk.level,
      riskReasons: JSON.stringify(risk.reasons),
      intent: req.intent,
      argsHash,
      redactedArgs: JSON.stringify(redactedArgs),
      policyId: policy.policyId,
      policyDecision: policy.decision,
      matchedRules: JSON.stringify(policy.matchedRuleIds),
      policyExplanation: policy.explanation,
      idempotencyKey,
    },
  });

  if (policy.decision === 'deny') {
    const actionReceipt = buildActionReceipt(receipt, req, capability, risk, policy, redactedArgs, fieldsRedacted);
    const signed = signReceipt(actionReceipt, getKeyPair());
    await finalizeReceipt(receipt.id, signed);
    return { status: 'denied', receiptId: receipt.id, error: policy.explanation };
  }

  if (policy.decision === 'require_approval') {
    return { status: 'pending_approval', receiptId: receipt.id };
  }

  // Execute immediately
  const result = await executeWithRetries(req.toolName, req.args);

  // Verification
  const verification = await verifyExecution(req.toolName, result);

  // Update receipt
  await prisma.receipt.update({
    where: { id: receipt.id },
    data: {
      executionStatus: result.success ? 'success' : 'failed',
      executionAttempts: result.attempts,
      resultHash: result.data ? hashValue(stableStringify(result.data)) : null,
      latencyMs: result.latencyMs,
      verificationMethod: verification.method,
      verificationStatus: verification.status,
      verificationSnapshot: verification.snapshot ? JSON.stringify(verification.snapshot) : null,
      diffSummary: verification.diffSummary,
      finalizedAt: new Date(),
    },
  });

  const updatedReceipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
  const actionReceipt = buildActionReceipt(updatedReceipt, req, capability, risk, policy, redactedArgs, fieldsRedacted, result, verification);
  const signed = signReceipt(actionReceipt, getKeyPair());
  await finalizeReceipt(receipt.id, signed);

  return { status: 'executed', receiptId: receipt.id, result: result.data };
}

export async function executeApprovedAction(receiptId: string): Promise<{
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
  const redactedArgs = JSON.parse(receipt.redactedArgs);

  // We need the original args to execute — but we only stored redacted args.
  // For the MVP, we store enough in redactedArgs to re-execute mock connectors.
  const result = await executeWithRetries(receipt.toolName, redactedArgs);
  const verification = await verifyExecution(receipt.toolName, result);

  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      status: 'executed',
      executionStatus: result.success ? 'success' : 'failed',
      executionAttempts: result.attempts,
      resultHash: result.data ? hashValue(stableStringify(result.data)) : null,
      latencyMs: result.latencyMs,
      verificationMethod: verification.method,
      verificationStatus: verification.status,
      verificationSnapshot: verification.snapshot ? JSON.stringify(verification.snapshot) : null,
      diffSummary: verification.diffSummary,
      finalizedAt: new Date(),
    },
  });

  return { success: result.success, result: result.data, error: result.error };
}

async function executeWithRetries(
  toolName: string,
  args: Record<string, unknown>,
  maxRetries = 2,
): Promise<ToolResult & { attempts: number; latencyMs: number }> {
  const connector = registry.get(toolName);
  if (!connector) {
    return { success: false, error: `Unknown tool: ${toolName}`, attempts: 1, latencyMs: 0 };
  }

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const start = Date.now();
    try {
      const result = await connector.execute(args);
      const latencyMs = Date.now() - start;
      return { ...result, attempts: attempt, latencyMs };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt <= maxRetries) {
        await sleep(Math.pow(2, attempt) * 100); // exponential backoff
      }
    }
  }

  return { success: false, error: lastError, attempts: maxRetries + 1, latencyMs: 0 };
}

async function verifyExecution(
  toolName: string,
  result: ToolResult & { attempts: number; latencyMs: number },
): Promise<{
  method: 'read_after_write' | 'none';
  status: 'verified' | 'unverified' | 'failed';
  snapshot?: Record<string, unknown>;
  diffSummary?: string;
}> {
  if (!result.success || !result.artifactId) {
    return { method: 'none', status: 'unverified' };
  }

  const connector = registry.get(toolName);
  if (!connector?.getById) {
    return { method: 'none', status: 'unverified' };
  }

  try {
    const afterState = await connector.getById(result.artifactId);
    if (afterState) {
      return {
        method: 'read_after_write',
        status: 'verified',
        snapshot: afterState,
        diffSummary: `Created ${toolName} artifact ${result.artifactId}`,
      };
    }
    return { method: 'read_after_write', status: 'failed', diffSummary: 'Artifact not found after write' };
  } catch {
    return { method: 'read_after_write', status: 'failed', diffSummary: 'Verification read failed' };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildActionReceipt(
  dbReceipt: any,
  req: ToolExecuteRequest | null,
  capability: string,
  risk: { level: string; reasons: string[] },
  policy: { policyId: string; decision: string; matchedRuleIds: string[]; explanation: string },
  redactedArgs: Record<string, unknown>,
  fieldsRedacted: string[],
  executionResult?: ToolResult & { attempts: number; latencyMs: number },
  verification?: { method: string; status: string; snapshot?: Record<string, unknown>; diffSummary?: string },
): ActionReceipt {
  return {
    receipt_version: '0.1',
    receipt_id: dbReceipt.id,
    timestamp: dbReceipt.createdAt.toISOString(),
    session: {
      sessionId: dbReceipt.sessionId,
      agentId: dbReceipt.agentId,
      userId: dbReceipt.userId ?? undefined,
      environment: dbReceipt.environment ?? undefined,
    },
    request: {
      tool_name: dbReceipt.toolName,
      capability: capability as ActionReceipt['request']['capability'],
      risk: risk as ActionReceipt['request']['risk'],
      intent: dbReceipt.intent ?? undefined,
      args_hash: dbReceipt.argsHash,
      redacted_args: redactedArgs,
    },
    policy: {
      policy_id: policy.policyId,
      decision: policy.decision as ActionReceipt['policy']['decision'],
      matched_rules: policy.matchedRuleIds,
      explanation: policy.explanation,
    },
    approval: dbReceipt.approvalStatus
      ? {
          status: dbReceipt.approvalStatus,
          actor: dbReceipt.approvedBy ?? undefined,
          comment: dbReceipt.approvalComment ?? undefined,
          timestamp: dbReceipt.approvedAt?.toISOString(),
        }
      : undefined,
    execution: executionResult
      ? {
          status: executionResult.success ? 'success' : 'failed',
          attempts: executionResult.attempts,
          idempotency_key: dbReceipt.idempotencyKey,
          result_hash: executionResult.data
            ? hashValue(stableStringify(executionResult.data))
            : undefined,
          latency_ms: executionResult.latencyMs,
        }
      : dbReceipt.executionStatus
        ? {
            status: dbReceipt.executionStatus as 'success' | 'failed' | 'skipped',
            attempts: dbReceipt.executionAttempts,
            idempotency_key: dbReceipt.idempotencyKey,
            result_hash: dbReceipt.resultHash ?? undefined,
            latency_ms: dbReceipt.latencyMs ?? undefined,
          }
        : undefined,
    verification: verification
      ? {
          method: verification.method as 'read_after_write' | 'none',
          status: verification.status as 'verified' | 'unverified' | 'failed',
          after_snapshot: verification.snapshot,
          diff_summary: verification.diffSummary,
        }
      : undefined,
    redaction: { fields_redacted: fieldsRedacted },
  };
}

async function finalizeReceipt(receiptId: string, signed: ActionReceipt): Promise<void> {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      signatureAlg: signed.signature?.alg,
      publicKeyId: signed.signature?.public_key_id,
      signatureB64: signed.signature?.signature_b64,
    },
  });
  appendToLedger(signed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
