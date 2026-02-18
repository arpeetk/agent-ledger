import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentLedger } from '../src/client.js';

const TEST_BASE_URL = 'http://localhost:9999';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    } as Response;
  });
}

describe('AgentLedger SDK', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createClient() {
    return new AgentLedger({
      baseUrl: TEST_BASE_URL,
      session: {
        sessionId: 'test-session',
        agentId: 'test-agent',
        userId: 'test-user',
      },
      approvalTimeoutMs: 5_000,
      pollIntervalMs: 100,
    });
  }

  describe('execute()', () => {
    it('returns executed status for allowed tool calls', async () => {
      globalThis.fetch = mockFetch([
        {
          status: 200,
          body: { status: 'executed', receiptId: 'rcpt-001', result: { messageId: 'm-1' } },
        },
        {
          status: 200,
          body: { id: 'rcpt-001', status: 'executed', toolName: 'gmail.send' },
        },
      ]);

      const client = createClient();
      const result = await client.execute('gmail.send', {
        to: ['alice@mycompany.com'],
        subject: 'Test',
        body: 'Hello',
      });

      expect(result.status).toBe('executed');
      expect(result.receiptId).toBe('rcpt-001');
      expect(result.result).toEqual({ messageId: 'm-1' });
    });

    it('returns denied status for blocked tool calls', async () => {
      const onDenied = vi.fn();
      globalThis.fetch = mockFetch([
        {
          status: 403,
          body: { status: 'denied', receiptId: 'rcpt-002', error: 'Public posting is not allowed.' },
        },
      ]);

      const client = new AgentLedger({
        baseUrl: TEST_BASE_URL,
        session: { sessionId: 's', agentId: 'a' },
        onDenied,
      });

      const result = await client.execute('social.post', { content: 'Hello world' });

      expect(result.status).toBe('denied');
      expect(result.error).toBe('Public posting is not allowed.');
      expect(onDenied).toHaveBeenCalledWith({
        receiptId: 'rcpt-002',
        toolName: 'social.post',
        reason: 'Public posting is not allowed.',
      });
    });

    it('returns pending status when noWait is true', async () => {
      const onPending = vi.fn();
      globalThis.fetch = mockFetch([
        {
          status: 202,
          body: { status: 'pending_approval', receiptId: 'rcpt-003' },
        },
      ]);

      const client = new AgentLedger({
        baseUrl: TEST_BASE_URL,
        session: { sessionId: 's', agentId: 'a' },
        onPendingApproval: onPending,
      });

      const result = await client.execute(
        'gmail.create_draft',
        { to: ['ext@other.com'] },
        { noWait: true },
      );

      expect(result.status).toBe('pending_approval');
      expect(onPending).toHaveBeenCalledTimes(1);
      expect(onPending).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptId: 'rcpt-003',
          toolName: 'gmail.create_draft',
        }),
      );
    });

    it('polls for approval when waiting', async () => {
      let pollCount = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr.includes('/tools/execute')) {
          return {
            ok: true,
            status: 202,
            json: async () => ({ status: 'pending_approval', receiptId: 'rcpt-004' }),
          } as Response;
        }

        if (urlStr.includes('/receipts/rcpt-004')) {
          pollCount++;
          if (pollCount < 3) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: 'rcpt-004', status: 'pending_approval' }),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'rcpt-004', status: 'executed', toolName: 'gmail.send' }),
          } as Response;
        }

        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const client = new AgentLedger({
        baseUrl: TEST_BASE_URL,
        session: { sessionId: 's', agentId: 'a' },
        pollIntervalMs: 50,
        approvalTimeoutMs: 10_000,
      });

      const result = await client.execute('gmail.send', { to: ['ext@other.com'] });
      expect(result.status).toBe('executed');
      expect(pollCount).toBeGreaterThanOrEqual(3);
    });

    it('sends correct request body', async () => {
      let capturedBody: unknown;
      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'executed', receiptId: 'r-1' }),
        } as Response;
      }) as typeof fetch;

      const client = new AgentLedger({
        baseUrl: TEST_BASE_URL,
        session: { sessionId: 'sid', agentId: 'aid', userId: 'uid', environment: 'test' },
      });

      await client.execute('gmail.send', { to: ['a@b.com'] }, { intent: 'Test email' });

      expect(capturedBody).toEqual({
        session: { sessionId: 'sid', agentId: 'aid', userId: 'uid', environment: 'test' },
        toolName: 'gmail.send',
        args: { to: ['a@b.com'] },
        intent: 'Test email',
      });
    });
  });

  describe('getReceipt()', () => {
    it('fetches a receipt by ID', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { id: 'rcpt-1', status: 'executed', toolName: 'gmail.send' } },
      ]);

      const client = createClient();
      const receipt = await client.getReceipt('rcpt-1');

      expect(receipt.id).toBe('rcpt-1');
      expect(receipt.status).toBe('executed');
    });

    it('throws on not found', async () => {
      globalThis.fetch = mockFetch([{ status: 404, body: { error: 'Not found' } }]);

      const client = createClient();
      await expect(client.getReceipt('missing')).rejects.toThrow('Receipt not found');
    });
  });

  describe('listReceipts()', () => {
    it('lists receipts with status filter', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        capturedUrl = typeof url === 'string' ? url : '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'r-1' }, { id: 'r-2' }],
            cursor: '2025-01-01',
          }),
        } as Response;
      }) as typeof fetch;

      const client = createClient();
      const result = await client.listReceipts({ status: 'pending_approval', limit: 10 });

      expect(capturedUrl).toContain('status=pending_approval');
      expect(capturedUrl).toContain('limit=10');
      expect(result.data).toHaveLength(2);
    });
  });

  describe('verifyReceipt()', () => {
    it('returns verification result', async () => {
      globalThis.fetch = mockFetch([{ status: 200, body: { valid: true } }]);

      const client = createClient();
      const result = await client.verifyReceipt('rcpt-1');
      expect(result.valid).toBe(true);
    });
  });

  describe('approve() and deny()', () => {
    it('sends approve request', async () => {
      let capturedBody: unknown;
      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) capturedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'approved', receiptId: 'rcpt-1' }),
        } as Response;
      }) as typeof fetch;

      const client = createClient();
      const result = await client.approve('rcpt-1', 'reviewer', 'Looks good');

      expect(result.status).toBe('approved');
      expect(capturedBody).toEqual({ approvedBy: 'reviewer', comment: 'Looks good' });
    });

    it('sends deny request', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { status: 'denied', receiptId: 'rcpt-1' } },
      ]);

      const client = createClient();
      const result = await client.deny('rcpt-1', 'reviewer', 'Not approved');
      expect(result.status).toBe('denied');
    });
  });

  describe('healthCheck()', () => {
    it('returns true when server is reachable', async () => {
      globalThis.fetch = mockFetch([{ status: 200, body: { status: 'ok' } }]);
      const client = createClient();
      expect(await client.healthCheck()).toBe(true);
    });

    it('returns false when server is unreachable', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;
      const client = createClient();
      expect(await client.healthCheck()).toBe(false);
    });
  });

  describe('registerTool()', () => {
    it('registers and lists tool definitions', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { status: 'executed', receiptId: 'r-1' } },
      ]);

      const client = createClient();
      client.registerTool({
        name: 'gmail.send',
        description: 'Send an email via Gmail',
        parameters: {
          to: { type: 'array', description: 'Recipients', required: true },
          subject: { type: 'string', description: 'Subject line', required: true },
          body: { type: 'string', description: 'Email body' },
        },
      });

      const tools = client.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('gmail.send');
      expect(tools[0].description).toBe('Send an email via Gmail');

      const result = await tools[0].execute({ to: ['a@b.com'], subject: 'Hi', body: 'Hello' });
      expect(result.status).toBe('executed');
    });
  });

  describe('waitForApproval()', () => {
    it('throws on timeout', async () => {
      globalThis.fetch = mockFetch([
        { status: 200, body: { id: 'rcpt-x', status: 'pending_approval' } },
      ]);

      const client = new AgentLedger({
        baseUrl: TEST_BASE_URL,
        session: { sessionId: 's', agentId: 'a' },
        approvalTimeoutMs: 300,
        pollIntervalMs: 50,
      });

      await expect(client.waitForApproval('rcpt-x')).rejects.toThrow('Approval timeout');
    });
  });
});
