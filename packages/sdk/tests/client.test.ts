import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLedger, LedgerDeniedError, ApprovalRequiredError } from '../src/index.js';

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('AgentLedger', () => {
  describe('constructor', () => {
    it('generates a session ID if not provided', () => {
      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      expect(ledger.getSessionId()).toBeTruthy();
      expect(ledger.getSessionId().length).toBeGreaterThan(0);
    });

    it('uses provided session ID', () => {
      const ledger = new AgentLedger({
        session: { agentId: 'test', sessionId: 'my-session' },
      });
      expect(ledger.getSessionId()).toBe('my-session');
    });
  });

  describe('health', () => {
    it('returns true when server is healthy', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      expect(await ledger.health()).toBe(true);
    });

    it('returns false when server is down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      expect(await ledger.health()).toBe(false);
    });
  });

  describe('evaluate', () => {
    it('sends correct request to /tools/evaluate', async () => {
      const response = {
        decision: 'allow',
        receiptId: 'r-123',
        policyExplanation: 'Auto-allowed',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
        riskReasons: [],
        matchedRules: ['allow_reads'],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(response));

      const ledger = new AgentLedger({
        serverUrl: 'http://localhost:3001',
        session: { agentId: 'test', sessionId: 'sess-1' },
      });
      const result = await ledger.evaluate('gmail.send', { to: ['a@b.com'] }, 'Send email');

      expect(result.decision).toBe('allow');
      expect(result.receiptId).toBe('r-123');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/tools/evaluate');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.toolName).toBe('gmail.send');
      expect(body.session.sessionId).toBe('sess-1');
      expect(body.intent).toBe('Send email');
    });
  });

  describe('wrap (local mode)', () => {
    it('executes tool locally when policy allows', async () => {
      const evaluateResponse = {
        decision: 'allow',
        receiptId: 'r-123',
        policyExplanation: 'Allowed',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
        riskReasons: [],
        matchedRules: [],
      };
      const reportResponse = { receiptId: 'r-123', status: 'executed' };

      mockFetch
        .mockResolvedValueOnce(jsonResponse(evaluateResponse))
        .mockResolvedValueOnce(jsonResponse(reportResponse));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const mockTool = vi.fn().mockResolvedValue({ sent: true });
      const wrapped = ledger.wrap('gmail.send', mockTool);

      const result = await wrapped({ to: ['a@b.com'] });

      expect(result.status).toBe('executed');
      expect(result.result).toEqual({ sent: true });
      expect(mockTool).toHaveBeenCalledWith({ to: ['a@b.com'] });
      expect(mockFetch).toHaveBeenCalledTimes(2); // evaluate + report
    });

    it('throws LedgerDeniedError when policy denies', async () => {
      const evaluateResponse = {
        decision: 'deny',
        receiptId: 'r-456',
        policyExplanation: 'Public posting denied',
        capability: 'PUBLIC_POST',
        riskLevel: 'high',
        riskReasons: ['public_post'],
        matchedRules: ['deny_public_post'],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evaluateResponse, 403));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const mockTool = vi.fn();
      const wrapped = ledger.wrap('social.post', mockTool);

      await expect(wrapped({ content: 'hello' })).rejects.toThrow(LedgerDeniedError);
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('throws ApprovalRequiredError when onApproval is "throw"', async () => {
      const evaluateResponse = {
        decision: 'require_approval',
        receiptId: 'r-789',
        policyExplanation: 'Needs approval',
        capability: 'EMAIL_SEND',
        riskLevel: 'high',
        riskReasons: ['external_recipient'],
        matchedRules: ['external_email'],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evaluateResponse, 202));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const mockTool = vi.fn();
      const wrapped = ledger.wrap('gmail.send', mockTool, { onApproval: 'throw' });

      await expect(wrapped({ to: ['ext@other.com'] })).rejects.toThrow(ApprovalRequiredError);
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('returns pending result when onApproval is "skip"', async () => {
      const evaluateResponse = {
        decision: 'require_approval',
        receiptId: 'r-789',
        policyExplanation: 'Needs approval',
        capability: 'EMAIL_SEND',
        riskLevel: 'high',
        riskReasons: ['external_recipient'],
        matchedRules: ['external_email'],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evaluateResponse, 202));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const mockTool = vi.fn();
      const wrapped = ledger.wrap('gmail.send', mockTool, { onApproval: 'skip' });

      const result = await wrapped({ to: ['ext@other.com'] });
      expect(result.status).toBe('pending_approval');
      expect(result.receiptId).toBe('r-789');
      expect(mockTool).not.toHaveBeenCalled();
    });

    it('reports error when tool throws', async () => {
      const evaluateResponse = {
        decision: 'allow',
        receiptId: 'r-err',
        policyExplanation: 'Allowed',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
        riskReasons: [],
        matchedRules: [],
      };
      const reportResponse = { receiptId: 'r-err', status: 'failed' };

      mockFetch
        .mockResolvedValueOnce(jsonResponse(evaluateResponse))
        .mockResolvedValueOnce(jsonResponse(reportResponse));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const mockTool = vi.fn().mockRejectedValue(new Error('SMTP error'));
      const wrapped = ledger.wrap('gmail.send', mockTool);

      await expect(wrapped({ to: ['a@b.com'] })).rejects.toThrow('SMTP error');
      // Should have called report with failure
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('wrap (gateway mode)', () => {
    it('sends tool call to server for execution', async () => {
      const response = {
        status: 'executed',
        receiptId: 'r-gw-1',
        result: { sent: true },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(response));

      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'gateway',
      });

      const mockTool = vi.fn();
      const wrapped = ledger.wrap('gmail.send', mockTool);

      const result = await wrapped({ to: ['a@b.com'] });
      expect(result.status).toBe('executed');
      expect(result.result).toEqual({ sent: true });
      // In gateway mode, the local fn is NOT called
      expect(mockTool).not.toHaveBeenCalled();
    });
  });

  describe('wrapAll', () => {
    it('wraps multiple tools', async () => {
      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
      });

      const tools = ledger.wrapAll({
        'gmail.send': async () => ({ sent: true }),
        'calendar.create_event': async () => ({ created: true }),
      });

      expect(tools['gmail.send']).toBeDefined();
      expect(tools['gmail.send'].toolName).toBe('gmail.send');
      expect(tools['calendar.create_event']).toBeDefined();
      expect(tools['calendar.create_event'].toolName).toBe('calendar.create_event');
    });
  });

  describe('callbacks', () => {
    it('calls onDenied when tool is denied', async () => {
      const evaluateResponse = {
        decision: 'deny',
        receiptId: 'r-cb-1',
        policyExplanation: 'Denied',
        capability: 'PUBLIC_POST',
        riskLevel: 'high',
        riskReasons: ['public_post'],
        matchedRules: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evaluateResponse, 403));

      const onDenied = vi.fn();
      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
        onDenied,
      });

      const wrapped = ledger.wrap('social.post', vi.fn());
      await wrapped({ content: 'hello' }).catch(() => {});

      expect(onDenied).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptId: 'r-cb-1',
          toolName: 'social.post',
        }),
      );
    });

    it('calls onPendingApproval when approval is required', async () => {
      const evaluateResponse = {
        decision: 'require_approval',
        receiptId: 'r-cb-2',
        policyExplanation: 'Needs review',
        capability: 'EMAIL_SEND',
        riskLevel: 'high',
        riskReasons: ['external_recipient'],
        matchedRules: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(evaluateResponse, 202));

      const onPendingApproval = vi.fn();
      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
        onPendingApproval,
      });

      const wrapped = ledger.wrap('gmail.send', vi.fn(), { onApproval: 'throw' });
      await wrapped({ to: ['ext@other.com'] }).catch(() => {});

      expect(onPendingApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptId: 'r-cb-2',
          toolName: 'gmail.send',
        }),
      );
    });

    it('calls onExecuted after successful execution', async () => {
      const evaluateResponse = {
        decision: 'allow',
        receiptId: 'r-cb-3',
        policyExplanation: 'Allowed',
        capability: 'EMAIL_SEND',
        riskLevel: 'low',
        riskReasons: [],
        matchedRules: [],
      };
      const reportResponse = { receiptId: 'r-cb-3', status: 'executed' };

      mockFetch
        .mockResolvedValueOnce(jsonResponse(evaluateResponse))
        .mockResolvedValueOnce(jsonResponse(reportResponse));

      const onExecuted = vi.fn();
      const ledger = new AgentLedger({
        session: { agentId: 'test' },
        mode: 'local',
        onExecuted,
      });

      const wrapped = ledger.wrap('gmail.send', async () => ({ sent: true }));
      await wrapped({ to: ['a@b.com'] });

      expect(onExecuted).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptId: 'r-cb-3',
          toolName: 'gmail.send',
        }),
      );
    });
  });

  describe('getReceipt', () => {
    it('fetches a receipt by ID', async () => {
      const receipt = { id: 'r-1', status: 'executed', toolName: 'gmail.send' };
      mockFetch.mockResolvedValueOnce(jsonResponse(receipt));

      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      const result = await ledger.getReceipt('r-1');
      expect(result.id).toBe('r-1');
    });
  });

  describe('listReceipts', () => {
    it('lists receipts with filters', async () => {
      const data = { data: [{ id: 'r-1' }], cursor: null };
      mockFetch.mockResolvedValueOnce(jsonResponse(data));

      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      const result = await ledger.listReceipts({ status: 'executed', limit: 10 });
      expect(result.data).toHaveLength(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('status=executed');
      expect(url).toContain('limit=10');
    });
  });

  describe('verifyReceipt', () => {
    it('verifies a receipt signature', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ valid: true }));

      const ledger = new AgentLedger({ session: { agentId: 'test' } });
      const result = await ledger.verifyReceipt('r-1');
      expect(result.valid).toBe(true);
    });
  });
});
