import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Test‑scoped SQLite database
// We must set DATABASE_URL *before* any Prisma / server module is imported.
// ---------------------------------------------------------------------------
const tmpDir = mkdtempSync(join(tmpdir(), 'agent-ledger-test-'));
const testDbPath = join(tmpDir, 'test.db');
process.env.DATABASE_URL = `file:${testDbPath}`;

// Push the Prisma schema to the temp database (creates tables)
const serverDir = join(__dirname, '..');
execSync('npx prisma db push --skip-generate', {
  cwd: serverDir,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: 'pipe',
});

// ---------------------------------------------------------------------------
// Now that DATABASE_URL is set, we can dynamically import the server modules.
// ---------------------------------------------------------------------------
let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const { default: cors } = await import('@fastify/cors');
  const { toolRoutes } = await import('../src/routes/tools.js');
  const { receiptRoutes } = await import('../src/routes/receipts.js');

  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  await server.register(toolRoutes);
  await server.register(receiptRoutes);
  server.get('/health', async () => ({ status: 'ok' }));
  return server;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSession(overrides?: Record<string, unknown>) {
  return {
    sessionId: `test-session-${Date.now()}`,
    agentId: 'test-agent',
    userId: 'test-user',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  // Disconnect Prisma
  const { prisma } = await import('../src/lib/db.js');
  await prisma.$disconnect();
  // Clean up temp directory
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /tools/execute', () => {
  it('rejects requests with missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: { toolName: 'gmail.send' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Missing required fields/);
  });

  it('allows internal email send (auto-allowed by policy)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['alice@mycompany.com'],
          subject: 'Hello',
          body: 'Internal email body',
        },
        intent: 'Send internal email',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('executed');
    expect(body.receiptId).toBeTruthy();
    expect(body.result).toBeDefined();
    expect(body.result.messageId).toBeTruthy();
  });

  it('denies public post (denied by policy)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'social.post',
        args: { content: 'Hello world' },
        intent: 'Post to social media',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.status).toBe('denied');
    expect(body.receiptId).toBeTruthy();
    expect(body.error).toBeTruthy();
  });

  it('requires approval for external email draft', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.create_draft',
        args: {
          to: ['external@otherdomain.com'],
          subject: 'External draft',
          body: 'Draft body',
        },
        intent: 'Draft external email',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('pending_approval');
    expect(body.receiptId).toBeTruthy();
  });

  it('requires approval for calendar event with many attendees', async () => {
    const attendees = Array.from({ length: 12 }, (_, i) => `user${i}@mycompany.com`);
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'calendar.create_event',
        args: {
          title: 'Big meeting',
          startTime: '2026-03-10T10:00:00Z',
          endTime: '2026-03-10T11:00:00Z',
          attendees,
          description: 'Team sync',
        },
        intent: 'Create large meeting',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('pending_approval');
    expect(body.receiptId).toBeTruthy();
  });

  it('returns idempotent result for duplicate allowed requests', async () => {
    const session = makeSession();
    const payload = {
      session,
      toolName: 'gmail.send',
      args: {
        to: ['bob@mycompany.com'],
        subject: 'Idempotency test',
        body: 'Same email',
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.status).toBe('executed');

    // Same request again should be idempotent
    const second = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.status).toBe('executed');
    expect(secondBody.result.replay).toBe(true);
    expect(secondBody.receiptId).toBe(firstBody.receiptId);
  });
});

describe('POST /tools/evaluate', () => {
  it('rejects requests with missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('evaluates an allowed tool call without executing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['colleague@mycompany.com'],
          subject: 'Evaluate test',
          body: 'Test body',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision).toBe('allow');
    expect(body.receiptId).toBeTruthy();
    expect(body.capability).toBe('EMAIL_SEND');
    expect(body.riskLevel).toBeTruthy();
    expect(body.matchedRules).toBeInstanceOf(Array);
  });

  it('evaluates a denied tool call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session: makeSession(),
        toolName: 'social.post',
        args: { content: 'Test' },
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.decision).toBe('deny');
  });

  it('evaluates a tool call requiring approval', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session: makeSession(),
        toolName: 'gmail.create_draft',
        args: {
          to: ['outsider@external.org'],
          subject: 'External',
          body: 'Body',
        },
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.decision).toBe('require_approval');
  });
});

describe('POST /receipts/:id/report', () => {
  it('reports execution result for an evaluated receipt', async () => {
    // First, evaluate a tool call
    const evalRes = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['report-test@mycompany.com'],
          subject: 'Report test',
          body: 'Body',
        },
      },
    });
    expect(evalRes.statusCode).toBe(200);
    const { receiptId } = evalRes.json();

    // Now report execution result
    const reportRes = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/report`,
      payload: {
        success: true,
        result: { messageId: 'mock-123' },
        latencyMs: 42,
      },
    });

    expect(reportRes.statusCode).toBe(200);
    const body = reportRes.json();
    expect(body.receiptId).toBe(receiptId);
    expect(body.status).toBe('executed');
  });

  it('reports failed execution', async () => {
    const evalRes = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['fail-test@mycompany.com'],
          subject: 'Fail test',
          body: 'Body',
        },
      },
    });
    const { receiptId } = evalRes.json();

    const reportRes = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/report`,
      payload: {
        success: false,
        error: 'Connection timeout',
        latencyMs: 5000,
      },
    });

    expect(reportRes.statusCode).toBe(200);
    const body = reportRes.json();
    expect(body.status).toBe('failed');
  });

  it('rejects report for non-existent receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/receipts/non-existent-id/report',
      payload: { success: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not found/i);
  });
});

describe('GET /receipts', () => {
  it('lists all receipts', async () => {
    const res = await app.inject({ method: 'GET', url: '/receipts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.cursor).toBeTruthy();
  });

  it('filters by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/receipts?status=pending_approval',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const receipt of body.data) {
      expect(receipt.status).toBe('pending_approval');
    }
  });

  it('filters by final status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/receipts?status=final',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const receipt of body.data) {
      expect(['executed', 'denied', 'failed']).toContain(receipt.status);
    }
  });

  it('supports limit parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/receipts?limit=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
  });

  it('supports cursor-based pagination', async () => {
    // Get the first page
    const first = await app.inject({
      method: 'GET',
      url: '/receipts?limit=2',
    });
    const firstBody = first.json();
    if (firstBody.cursor && firstBody.data.length === 2) {
      // Get the next page
      const second = await app.inject({
        method: 'GET',
        url: `/receipts?limit=2&cursor=${firstBody.cursor}`,
      });
      const secondBody = second.json();
      expect(secondBody.data).toBeInstanceOf(Array);
      // Ensure no overlap between pages
      const firstIds = new Set(firstBody.data.map((r: { id: string }) => r.id));
      for (const receipt of secondBody.data) {
        expect(firstIds.has(receipt.id)).toBe(false);
      }
    }
  });
});

describe('GET /receipts/:id', () => {
  it('returns a single receipt by ID', async () => {
    // Create a receipt first
    const execRes = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['lookup@mycompany.com'],
          subject: 'Lookup test',
          body: 'Body',
        },
      },
    });
    const { receiptId } = execRes.json();

    const res = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}`,
    });
    expect(res.statusCode).toBe(200);
    const receipt = res.json();
    expect(receipt.id).toBe(receiptId);
    expect(receipt.toolName).toBe('gmail.send');
    expect(receipt.capability).toBe('EMAIL_SEND');
    expect(receipt.status).toBe('executed');
    expect(receipt.redactedArgs).toBeDefined();
    expect(receipt.matchedRules).toBeInstanceOf(Array);
    expect(receipt.riskReasons).toBeInstanceOf(Array);
    expect(receipt.signatureB64).toBeTruthy();
  });

  it('returns 404 for non-existent receipt', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/receipts/nonexistent-id',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Approval flow', () => {
  let pendingReceiptId: string;

  beforeEach(async () => {
    // Create a pending approval receipt
    const res = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.create_draft',
        args: {
          to: ['partner@external.com'],
          subject: 'Approval flow test',
          body: 'Draft body',
        },
        intent: 'Test approval',
      },
    });
    expect(res.statusCode).toBe(202);
    pendingReceiptId = res.json().receiptId;
  });

  it('approves a pending receipt and executes the action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/approve`,
      payload: {
        approvedBy: 'test-reviewer',
        comment: 'Looks good',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('approved');
    expect(body.receiptId).toBe(pendingReceiptId);
    expect(body.execution).toBeDefined();
    expect(body.execution.success).toBe(true);

    // Verify the receipt is now finalized
    const receiptRes = await app.inject({
      method: 'GET',
      url: `/receipts/${pendingReceiptId}`,
    });
    const receipt = receiptRes.json();
    expect(receipt.status).toBe('executed');
    expect(receipt.approvalStatus).toBe('approved');
    expect(receipt.approvedBy).toBe('test-reviewer');
    expect(receipt.executionStatus).toBe('success');
    expect(receipt.signatureB64).toBeTruthy();
  });

  it('denies a pending receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/deny`,
      payload: {
        approvedBy: 'test-reviewer',
        comment: 'Not appropriate',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('denied');
    expect(body.receiptId).toBe(pendingReceiptId);

    // Verify the receipt is now denied
    const receiptRes = await app.inject({
      method: 'GET',
      url: `/receipts/${pendingReceiptId}`,
    });
    const receipt = receiptRes.json();
    expect(receipt.status).toBe('denied');
    expect(receipt.approvalStatus).toBe('denied');
    expect(receipt.approvedBy).toBe('test-reviewer');
    expect(receipt.approvalComment).toBe('Not appropriate');
    expect(receipt.executionStatus).toBe('skipped');
    expect(receipt.signatureB64).toBeTruthy();
  });

  it('rejects approval for non-existent receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/receipts/nonexistent-id/approve',
      payload: { approvedBy: 'test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects approval for already-executed receipt', async () => {
    // First approve
    await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/approve`,
      payload: { approvedBy: 'test-reviewer' },
    });

    // Try to approve again
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/approve`,
      payload: { approvedBy: 'test-reviewer' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not pending_approval/);
  });

  it('rejects deny for already-denied receipt', async () => {
    // First deny
    await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/deny`,
      payload: { approvedBy: 'test-reviewer' },
    });

    // Try to deny again
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${pendingReceiptId}/deny`,
      payload: { approvedBy: 'test-reviewer' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /receipts/:id/verify', () => {
  it('verifies signature of a finalized receipt', async () => {
    // Create an executed receipt (which gets written to the ledger)
    const execRes = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.send',
        args: {
          to: ['verify@mycompany.com'],
          subject: 'Verify test',
          body: 'Body',
        },
      },
    });
    expect(execRes.statusCode).toBe(200);
    const { receiptId } = execRes.json();

    const res = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}/verify`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
  });

  it('returns 404 for receipt not in ledger', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/receipts/nonexistent-id/verify',
    });
    // Might be 404 if receipt not found in ledger
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().valid).toBe(false);
    }
  });
});

describe('GET /stats', () => {
  it('returns aggregated statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(200);
    const stats = res.json();

    expect(typeof stats.total).toBe('number');
    expect(stats.total).toBeGreaterThan(0);
    expect(typeof stats.sessions).toBe('number');
    expect(stats.byStatus).toBeDefined();
    expect(stats.byCapability).toBeDefined();
    expect(stats.byRisk).toBeDefined();
    expect(stats.byTool).toBeDefined();
    expect(stats.byAgent).toBeDefined();
    expect(stats.policyHits).toBeDefined();
    expect(stats.verification).toBeDefined();
    expect(typeof stats.verification.verified).toBe('number');
    expect(typeof stats.verification.unverified).toBe('number');
    expect(typeof stats.verification.failed).toBe('number');
  });

  it('reflects correct status counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats' });
    const stats = res.json();

    // We created both executed and denied receipts in earlier tests
    expect(stats.byStatus.executed).toBeGreaterThan(0);
    expect(stats.byStatus.denied).toBeGreaterThan(0);
  });
});

describe('End-to-end: evaluate -> report flow', () => {
  it('completes a full evaluate -> client execute -> report cycle', async () => {
    const session = makeSession();

    // 1. Evaluate
    const evalRes = await app.inject({
      method: 'POST',
      url: '/tools/evaluate',
      payload: {
        session,
        toolName: 'gmail.send',
        args: {
          to: ['e2e@mycompany.com'],
          subject: 'E2E test',
          body: 'Test body',
        },
        intent: 'End-to-end test',
      },
    });
    expect(evalRes.statusCode).toBe(200);
    const evalBody = evalRes.json();
    expect(evalBody.decision).toBe('allow');
    const { receiptId } = evalBody;

    // 2. Verify receipt is in awaiting_execution state
    const receiptBefore = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}`,
    });
    expect(receiptBefore.json().status).toBe('awaiting_execution');

    // 3. Report execution
    const reportRes = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/report`,
      payload: {
        success: true,
        result: { messageId: 'e2e-msg-001', delivered: true },
        latencyMs: 150,
      },
    });
    expect(reportRes.statusCode).toBe(200);
    expect(reportRes.json().status).toBe('executed');

    // 4. Verify receipt is finalized
    const receiptAfter = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}`,
    });
    const finalReceipt = receiptAfter.json();
    expect(finalReceipt.status).toBe('executed');
    expect(finalReceipt.executionStatus).toBe('success');
    expect(finalReceipt.signatureB64).toBeTruthy();

    // 5. Verify signature via verify endpoint
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}/verify`,
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);
  });
});

describe('End-to-end: approval flow', () => {
  it('completes execute -> approve -> verify cycle', async () => {
    // 1. Create pending approval
    const execRes = await app.inject({
      method: 'POST',
      url: '/tools/execute',
      payload: {
        session: makeSession(),
        toolName: 'gmail.create_draft',
        args: {
          to: ['vendor@external.io'],
          subject: 'Approval e2e',
          body: 'Needs review',
        },
        intent: 'Approval e2e test',
      },
    });
    expect(execRes.statusCode).toBe(202);
    const { receiptId } = execRes.json();

    // 2. Approve
    const approveRes = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/approve`,
      payload: {
        approvedBy: 'e2e-reviewer',
        comment: 'Approved for e2e test',
      },
    });
    expect(approveRes.statusCode).toBe(200);

    // 3. Verify the final receipt
    const receiptRes = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}`,
    });
    const receipt = receiptRes.json();
    expect(receipt.status).toBe('executed');
    expect(receipt.approvalStatus).toBe('approved');
    expect(receipt.verificationStatus).toBe('verified');
    expect(receipt.signatureB64).toBeTruthy();

    // 4. Verify signature
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}/verify`,
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);
  });
});
