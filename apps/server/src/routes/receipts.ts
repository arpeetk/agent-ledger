import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { verifyReceipt, signReceipt } from '@agent-ledger/core';
import type { ActionReceipt } from '@agent-ledger/core';
import { getKeyPair } from '../lib/keys.js';
import { executeApprovedAction } from '../lib/executor.js';
import { appendToLedger } from '../lib/ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(__dirname, '../../receipts/ledger.jsonl');

export async function receiptRoutes(app: FastifyInstance) {
  // List receipts
  app.get<{
    Querystring: { status?: string; limit?: string; cursor?: string };
  }>('/receipts', async (request) => {
    const { status, limit = '50', cursor } = request.query;

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
      take: parseInt(limit, 10),
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

    const lines = readFileSync(LEDGER_PATH, 'utf-8').split('\n').filter(Boolean);
    let actionReceipt: ActionReceipt | null = null;
    for (const line of lines) {
      const parsed = JSON.parse(line) as ActionReceipt;
      if (parsed.receipt_id === id) {
        actionReceipt = parsed;
        break;
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

  // Approve receipt
  app.post<{
    Params: { id: string };
    Body: { approvedBy: string; comment?: string };
  }>('/receipts/:id/approve', async (request, reply) => {
    const receipt = await prisma.receipt.findUnique({ where: { id: request.params.id } });
    if (!receipt) return reply.status(404).send({ error: 'Receipt not found' });
    if (receipt.status !== 'pending_approval') {
      return reply.status(400).send({ error: `Receipt status is ${receipt.status}, not pending_approval` });
    }

    const { approvedBy, comment } = request.body;

    await prisma.receipt.update({
      where: { id: receipt.id },
      data: {
        approvalStatus: 'approved',
        approvedBy,
        approvalComment: comment,
        approvedAt: new Date(),
      },
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
    const receipt = await prisma.receipt.findUnique({ where: { id: request.params.id } });
    if (!receipt) return reply.status(404).send({ error: 'Receipt not found' });
    if (receipt.status !== 'pending_approval') {
      return reply.status(400).send({ error: `Receipt status is ${receipt.status}, not pending_approval` });
    }

    const { approvedBy, comment } = request.body;

    await prisma.receipt.update({
      where: { id: receipt.id },
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
    redaction: { fields_redacted: [] },
    signature: r.signatureB64
      ? {
          alg: r.signatureAlg ?? 'ed25519',
          public_key_id: r.publicKeyId ?? '',
          signature_b64: r.signatureB64,
        }
      : undefined,
  };
}
