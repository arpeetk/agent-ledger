import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { verifyReceipt, signReceipt } from '@agent-ledger/core';
import type { ActionReceipt } from '@agent-ledger/core';
import { getKeyPair } from '../lib/keys.js';
import { executeApprovedAction } from '../lib/executor.js';
import { appendToLedger } from '../lib/ledger.js';
import { emitWebhook } from '../lib/webhooks.js';
import { emitEvent } from '../lib/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(__dirname, '../../receipts/ledger.jsonl');

export async function receiptRoutes(app: FastifyInstance) {
  // List receipts
  app.get<{
    Querystring: { status?: string; limit?: string; cursor?: string };
  }>('/receipts', async (request) => {
    const { status, limit: limitStr = '50', cursor } = request.query;
    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200);

    const where: Record<string, unknown> = {};
    if (status) {
      if (status === 'final') {
        where.status = { in: ['executed', 'denied', 'failed'] };
      } else {
        where.status = status;
      }
    }
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const receipts = await prisma.receipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      data: receipts.map(formatReceipt),
      cursor: receipts.length > 0 ? receipts[receipts.length - 1].createdAt.toISOString() : null,
    };
  });

  // Get single receipt
  app.get<{ Params: { id: string } }>('/receipts/:id', async (request, reply) => {
    const receipt = await prisma.receipt.findUnique({ where: { id: request.params.id } });
    if (!receipt) return reply.status(404).send({ error: 'Receipt not found' });
    return formatReceipt(receipt);
  });

  // Verify receipt signature (reads from the append-only JSONL ledger)
  app.get<{ Params: { id: string } }>('/receipts/:id/verify', async (request, reply) => {
    const id = request.params.id;

    if (!existsSync(LEDGER_PATH)) {
      return reply.status(404).send({ error: 'Ledger not found' });
    }

    // Stream the ledger file line by line to avoid loading entire file into memory
    let actionReceipt: ActionReceipt | null = null;
    const rl = createInterface({
      input: createReadStream(LEDGER_PATH, 'utf-8'),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ActionReceipt;
        if (parsed.receipt_id === id) {
          actionReceipt = parsed;
          rl.close();
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!actionReceipt) {
      return reply.status(404).send({ error: 'Receipt not found in ledger' });
    }
    if (!actionReceipt.signature) {
      return { valid: false, reason: 'No signature' };
    }

    const keyPair = getKeyPair();
    const valid = verifyReceipt(actionReceipt, keyPair.publicKey);
    return { valid };
  });

  // Aggregated stats using SQL-level aggregation where possible
  app.get('/stats', async () => {
    // Use Prisma groupBy for simple aggregations to avoid loading all rows
    const [
      total,
      sessionCount,
      latencyAgg,
      statusGroups,
      capabilityGroups,
      riskGroups,
      toolGroups,
      agentGroups,
      verificationGroups,
    ] = await Promise.all([
      prisma.receipt.count(),
      prisma.receipt.groupBy({ by: ['sessionId'] }).then((g) => g.length),
      prisma.receipt.aggregate({
        _avg: { latencyMs: true },
        where: { latencyMs: { not: null } },
      }),
      prisma.receipt.groupBy({ by: ['status'], _count: true }),
      prisma.receipt.groupBy({ by: ['capability'], _count: true }),
      prisma.receipt.groupBy({ by: ['riskLevel'], _count: true }),
      prisma.receipt.groupBy({ by: ['toolName'], _count: true }),
      prisma.receipt.groupBy({ by: ['agentId'], _count: true }),
      prisma.receipt.groupBy({ by: ['verificationStatus'], _count: true }),
    ]);

    const toRecord = (groups: { _count: number; [key: string]: unknown }[], key: string) => {
      const record: Record<string, number> = {};
      for (const g of groups) {
        const k = String(g[key] ?? 'unknown');
        record[k] = g._count;
      }
      return record;
    };

    const verification = { verified: 0, unverified: 0, failed: 0 };
    for (const g of verificationGroups) {
      if (g.verificationStatus === 'verified') verification.verified = g._count;
      else if (g.verificationStatus === 'failed') verification.failed = g._count;
      else verification.unverified += g._count;
    }

    // Policy hits still requires scanning matchedRules JSON — use limited query
    const policyHits: Record<string, number> = {};
    const rulesRows = await prisma.receipt.findMany({
      select: { matchedRules: true },
      where: { matchedRules: { not: '[]' } },
      take: 10_000,
    });
    for (const r of rulesRows) {
      try {
        const rules = JSON.parse(r.matchedRules) as string[];
        for (const rule of rules) {
          policyHits[rule] = (policyHits[rule] ?? 0) + 1;
        }
      } catch {
        // Skip malformed matchedRules
      }
    }

    return {
      total,
      sessions: sessionCount,
      avgLatencyMs: latencyAgg._avg.latencyMs ? Math.round(latencyAgg._avg.latencyMs) : null,
      byStatus: toRecord(statusGroups, 'status'),
      byCapability: toRecord(capabilityGroups, 'capability'),
      byRisk: toRecord(riskGroups, 'riskLevel'),
      byTool: toRecord(toolGroups, 'toolName'),
      byAgent: toRecord(agentGroups, 'agentId'),
      policyHits,
      verification,
    };
  });

  // Approve receipt
  app.post<{
    Params: { id: string };
    Body: { approvedBy: string; comment?: string };
  }>('/receipts/:id/approve', async (request, reply) => {
    const { approvedBy, comment } = request.body;

    // Atomic update with status guard to prevent TOCTOU double-approval
    const { count } = await prisma.receipt.updateMany({
      where: { id: request.params.id, status: 'pending_approval' },
      data: {
        approvalStatus: 'approved',
        approvedBy,
        approvalComment: comment,
        approvedAt: new Date(),
      },
    });

    if (count === 0) {
      const receipt = await prisma.receipt.findUnique({ where: { id: request.params.id } });
      if (!receipt) return reply.status(404).send({ error: 'Receipt not found' });
      return reply
        .status(400)
        .send({ error: `Receipt status is ${receipt.status}, not pending_approval` });
    }

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: request.params.id },
    });

    // Execute the deferred action
    const execResult = await executeApprovedAction(receipt.id);

    // Build and sign final receipt
    const updated = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    const actionReceipt = dbToActionReceipt(updated);
    const signed = signReceipt(actionReceipt, getKeyPair());

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        signatureAlg: signed.signature?.alg,
        publicKeyId: signed.signature?.public_key_id,
        signatureB64: signed.signature?.signature_b64,
      },
    });
    appendToLedger(signed);

    const approveEventData = {
      receiptId: receipt.id,
      toolName: receipt.toolName,
      capability: receipt.capability,
      riskLevel: receipt.riskLevel,
      sessionId: receipt.sessionId,
      agentId: receipt.agentId,
    };
    emitWebhook({
      event: 'receipt.approved',
      timestamp: new Date().toISOString(),
      data: { ...approveEventData, policyDecision: receipt.policyDecision, approvedBy },
    });
    emitEvent({
      type: 'receipt.approved',
      data: { ...approveEventData, status: 'executed' },
    });

    return {
      status: 'approved',
      receiptId: receipt.id,
      execution: execResult,
    };
  });

  // Deny receipt
  app.post<{
    Params: { id: string };
    Body: { approvedBy: string; comment?: string };
  }>('/receipts/:id/deny', async (request, reply) => {
    const { approvedBy, comment } = request.body;

    // Atomic update with status guard to prevent TOCTOU double-deny
    const { count } = await prisma.receipt.updateMany({
      where: { id: request.params.id, status: 'pending_approval' },
      data: {
        status: 'denied',
        approvalStatus: 'denied',
        approvedBy,
        approvalComment: comment,
        approvedAt: new Date(),
        finalizedAt: new Date(),
        executionStatus: 'skipped',
      },
    });

    if (count === 0) {
      const existing = await prisma.receipt.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.status(404).send({ error: 'Receipt not found' });
      return reply
        .status(400)
        .send({ error: `Receipt status is ${existing.status}, not pending_approval` });
    }

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: request.params.id },
    });

    const actionReceipt = dbToActionReceipt(receipt);
    const signed = signReceipt(actionReceipt, getKeyPair());

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        signatureAlg: signed.signature?.alg,
        publicKeyId: signed.signature?.public_key_id,
        signatureB64: signed.signature?.signature_b64,
      },
    });
    appendToLedger(signed);

    const denyEventData = {
      receiptId: receipt.id,
      toolName: receipt.toolName,
      capability: receipt.capability,
      riskLevel: receipt.riskLevel,
      sessionId: receipt.sessionId,
      agentId: receipt.agentId,
    };
    emitWebhook({
      event: 'receipt.approval_denied',
      timestamp: new Date().toISOString(),
      data: { ...denyEventData, policyDecision: receipt.policyDecision, approvedBy },
    });
    emitEvent({
      type: 'receipt.approval_denied',
      data: { ...denyEventData, status: 'denied' },
    });

    return { status: 'denied', receiptId: receipt.id };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatReceipt(r: any) {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    toolName: r.toolName,
    capability: r.capability,
    riskLevel: r.riskLevel,
    riskReasons: JSON.parse(r.riskReasons),
    intent: r.intent,
    redactedArgs: JSON.parse(r.redactedArgs),
    policyDecision: r.policyDecision,
    matchedRules: JSON.parse(r.matchedRules),
    policyExplanation: r.policyExplanation,
    approvalStatus: r.approvalStatus,
    approvedBy: r.approvedBy,
    approvalComment: r.approvalComment,
    executionStatus: r.executionStatus,
    executionAttempts: r.executionAttempts,
    verificationStatus: r.verificationStatus,
    diffSummary: r.diffSummary,
    signatureB64: r.signatureB64,
    sessionId: r.sessionId,
    agentId: r.agentId,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbToActionReceipt(r: any): ActionReceipt {
  return {
    receipt_version: r.receiptVersion ?? '0.1',
    receipt_id: r.id,
    timestamp: r.createdAt.toISOString(),
    session: {
      sessionId: r.sessionId,
      agentId: r.agentId,
      userId: r.userId ?? undefined,
      environment: r.environment ?? undefined,
    },
    request: {
      tool_name: r.toolName,
      capability: r.capability,
      risk: { level: r.riskLevel, reasons: JSON.parse(r.riskReasons) },
      intent: r.intent ?? undefined,
      args_hash: r.argsHash,
      redacted_args: JSON.parse(r.redactedArgs),
    },
    policy: {
      policy_id: r.policyId,
      decision: r.policyDecision,
      matched_rules: JSON.parse(r.matchedRules),
      explanation: r.policyExplanation ?? '',
    },
    approval: r.approvalStatus
      ? {
          status: r.approvalStatus,
          actor: r.approvedBy ?? undefined,
          comment: r.approvalComment ?? undefined,
          timestamp: r.approvedAt?.toISOString(),
        }
      : undefined,
    execution: r.executionStatus
      ? {
          status: r.executionStatus,
          attempts: r.executionAttempts,
          idempotency_key: r.idempotencyKey ?? '',
          result_hash: r.resultHash ?? undefined,
          latency_ms: r.latencyMs ?? undefined,
        }
      : undefined,
    verification: r.verificationMethod
      ? {
          method: r.verificationMethod,
          status: r.verificationStatus ?? 'unverified',
          after_snapshot: r.verificationSnapshot ? JSON.parse(r.verificationSnapshot) : undefined,
          diff_summary: r.diffSummary ?? undefined,
        }
      : undefined,
    redaction: { fields_redacted: r.fieldsRedacted ? JSON.parse(r.fieldsRedacted) : [] },
    signature: r.signatureB64
      ? {
          alg: r.signatureAlg ?? 'ed25519',
          public_key_id: r.publicKeyId ?? '',
          signature_b64: r.signatureB64,
        }
      : undefined,
  };
}
