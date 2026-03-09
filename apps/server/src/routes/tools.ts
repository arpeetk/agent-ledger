import type { FastifyInstance } from 'fastify';
import { executeToolCall, evaluateToolCall, reportExecution } from '../lib/executor.js';
import type { ToolExecuteRequest } from '@agent-ledger/core';

export async function toolRoutes(app: FastifyInstance) {
  // Gateway mode: server evaluates policy AND executes via registered connectors
  app.post<{ Body: ToolExecuteRequest }>('/tools/execute', async (request, reply) => {
    const body = request.body;

    if (!body.session?.sessionId || !body.session?.agentId || !body.toolName) {
      return reply
        .status(400)
        .send({ error: 'Missing required fields: session.sessionId, session.agentId, toolName' });
    }

    const result = await executeToolCall(body);

    if (result.status === 'denied') {
      return reply.status(403).send(result);
    }
    if (result.status === 'pending_approval') {
      return reply.status(202).send(result);
    }
    return reply.status(200).send(result);
  });

  // Evaluate mode: server evaluates policy only, client executes the tool
  app.post<{ Body: ToolExecuteRequest }>('/tools/evaluate', async (request, reply) => {
    const body = request.body;

    if (!body.session?.sessionId || !body.session?.agentId || !body.toolName) {
      return reply
        .status(400)
        .send({ error: 'Missing required fields: session.sessionId, session.agentId, toolName' });
    }

    const result = await evaluateToolCall(body);

    if (result.decision === 'deny') {
      return reply.status(403).send(result);
    }
    if (result.decision === 'require_approval') {
      return reply.status(202).send(result);
    }
    return reply.status(200).send(result);
  });

  // Report execution result from client-side execution
  app.post<{
    Params: { id: string };
    Body: {
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
      latencyMs?: number;
    };
  }>('/receipts/:id/report', async (request, reply) => {
    try {
      const result = await reportExecution(request.params.id, request.body);
      return reply.status(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(400).send({ error: message });
    }
  });
}
