import { createHmac } from 'node:crypto';

/** Webhook event types emitted by Agent Ledger. */
export type WebhookEventType =
  | 'receipt.created'
  | 'receipt.denied'
  | 'receipt.pending_approval'
  | 'receipt.executed'
  | 'receipt.approved'
  | 'receipt.approval_denied';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: {
    receiptId: string;
    toolName: string;
    capability: string;
    riskLevel: string;
    policyDecision: string;
    sessionId: string;
    agentId: string;
    policyExplanation?: string;
    approvedBy?: string;
  };
}

interface WebhookConfig {
  url: string;
  secret?: string;
  events?: WebhookEventType[];
}

let webhookConfigs: WebhookConfig[] = [];

/**
 * Load webhook configuration from environment.
 *
 * Supports up to 5 webhooks via env vars:
 *   WEBHOOK_URL_1, WEBHOOK_SECRET_1, WEBHOOK_EVENTS_1
 *   WEBHOOK_URL_2, WEBHOOK_SECRET_2, WEBHOOK_EVENTS_2
 *   ...
 *
 * WEBHOOK_EVENTS is a comma-separated list of event types.
 * If omitted, all events are sent.
 */
export function loadWebhookConfig(): void {
  webhookConfigs = [];

  for (let i = 1; i <= 5; i++) {
    const url = process.env[`WEBHOOK_URL_${i}`];
    if (!url) continue;

    const secret = process.env[`WEBHOOK_SECRET_${i}`];
    const eventsStr = process.env[`WEBHOOK_EVENTS_${i}`];
    const events = eventsStr
      ? (eventsStr.split(',').map((e) => e.trim()) as WebhookEventType[])
      : undefined;

    webhookConfigs.push({ url, secret, events });
  }

  // Also support a single WEBHOOK_URL for simple setups
  if (webhookConfigs.length === 0 && process.env.WEBHOOK_URL) {
    webhookConfigs.push({
      url: process.env.WEBHOOK_URL,
      secret: process.env.WEBHOOK_SECRET,
      events: process.env.WEBHOOK_EVENTS
        ? (process.env.WEBHOOK_EVENTS.split(',').map((e) => e.trim()) as WebhookEventType[])
        : undefined,
    });
  }
}

/**
 * Emit a webhook event to all configured endpoints.
 * Non-blocking — errors are logged but don't fail the caller.
 */
export function emitWebhook(payload: WebhookPayload): void {
  for (const config of webhookConfigs) {
    if (config.events && !config.events.includes(payload.event)) {
      continue;
    }
    deliverWebhook(config, payload).catch((err) => {
      console.error(`[webhook] Failed to deliver to ${config.url}: ${err}`);
    });
  }
}

async function deliverWebhook(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AgentLedger/0.1.0',
  };

  if (config.secret) {
    const signature = createHmac('sha256', config.secret).update(body).digest('hex');
    headers['X-Ledger-Signature'] = `sha256=${signature}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[webhook] ${config.url} responded ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Check if any webhooks are configured. */
export function hasWebhooks(): boolean {
  return webhookConfigs.length > 0;
}

/** Get the count of configured webhooks (for diagnostics). */
export function webhookCount(): number {
  return webhookConfigs.length;
}

// Auto-load on import
loadWebhookConfig();
