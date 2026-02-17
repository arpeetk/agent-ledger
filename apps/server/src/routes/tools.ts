import type { FastifyInstance } from 'fastify';
import { executeToolCall } from '../lib/executor.js';
import type { ToolExecuteRequest } from '@agent-ledger/core';

export async function toolRoutes(app: FastifyInstance) {
  app.post<{ Body: ToolExecuteRequest }>('/tools/execute', async (request, reply) => {
    const body = request.body;

    if (!body.session?.sessionId || !body.session?.agentId || !body.toolName) {
      return reply.status(400).send({ error: 'Missing required fields: session.sessionId, session.agentId, toolName' });
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
}
