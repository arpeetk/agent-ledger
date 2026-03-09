import type { FastifyReply } from 'fastify';

export type LedgerEventType =
  | 'receipt.created'
  | 'receipt.updated'
  | 'receipt.denied'
  | 'receipt.pending_approval'
  | 'receipt.executed'
  | 'receipt.approved'
  | 'receipt.approval_denied';

export interface LedgerEvent {
  type: LedgerEventType;
  data: {
    receiptId: string;
    toolName: string;
    status: string;
    capability: string;
    riskLevel: string;
    sessionId: string;
    agentId: string;
  };
}

type SSEClient = {
  id: string;
  reply: FastifyReply;
};

const clients: SSEClient[] = [];
let clientIdCounter = 0;

/** Register a new SSE client connection. Returns a cleanup function. */
export function addSSEClient(reply: FastifyReply): () => void {
  const id = String(++clientIdCounter);
  const client: SSEClient = { id, reply };
  clients.push(client);

  return () => {
    const index = clients.findIndex((c) => c.id === id);
    if (index >= 0) clients.splice(index, 1);
  };
}

/** Emit an event to all connected SSE clients. */
export function emitEvent(event: LedgerEvent): void {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].reply.raw.write(data);
    } catch {
      // Client disconnected, remove it
      clients.splice(i, 1);
    }
  }
}

/** Get the count of connected SSE clients. */
export function sseClientCount(): number {
  return clients.length;
}
