import type { FastifyInstance } from 'fastify';
import { addSSEClient, sseClientCount } from '../lib/events.js';

export async function eventRoutes(app: FastifyInstance) {
  /**
   * SSE endpoint for real-time receipt updates.
   * Connect from the dashboard: new EventSource('/events')
   */
  app.get('/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial heartbeat
    reply.raw.write(`event: connected\ndata: {"clients":${sseClientCount() + 1}}\n\n`);

    const cleanup = addSSEClient(reply);

    // Keep-alive ping every 30s
    const pingInterval = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 30_000);

    request.raw.on('close', () => {
      clearInterval(pingInterval);
      cleanup();
    });

    // Don't end the response — it stays open for SSE
    return reply;
  });
}
