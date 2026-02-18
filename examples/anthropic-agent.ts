/**
 * Example: Integrating Agent Ledger with an Anthropic Claude agent.
 *
 * This example shows how to wrap Claude's tool_use with Agent Ledger
 * so every tool call is policy-gated, audited, and signed.
 *
 * Prerequisites:
 *   - Agent Ledger server running (npm run dev)
 *   - ANTHROPIC_API_KEY environment variable set
 *
 * This is a conceptual example — it shows the integration pattern
 * without requiring a live API key to understand the code.
 */

import { AgentLedger } from '@agent-ledger/sdk';

// ── 1. Initialize Agent Ledger ─────────────────────────────────────────────

const ledger = new AgentLedger({
  baseUrl: 'http://localhost:3001',
  session: {
    sessionId: `anthropic-${Date.now()}`,
    agentId: 'claude-3-sonnet',
    userId: 'developer@company.com',
    environment: process.env.NODE_ENV ?? 'development',
  },
  onPendingApproval: (event) => {
    console.log(`[Agent Ledger] Action paused — needs approval: ${event.toolName}`);
    console.log(`[Agent Ledger] Approve at: ${event.approvalUrl}`);
  },
  onDenied: (event) => {
    console.log(`[Agent Ledger] Action blocked by policy: ${event.reason}`);
  },
});

// ── 2. Define tools (shared between Claude and Agent Ledger) ───────────────

// Tool definitions shared between Claude and Agent Ledger
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TOOLS = [
  {
    name: 'gmail.send',
    description: 'Send an email',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient emails' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'calendar.create_event',
    description: 'Create a calendar event',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
  {
    name: 'slack.send_message',
    description: 'Send a Slack message',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['channel', 'text'],
    },
  },
];

// ── 3. Tool execution handler (the key integration point) ──────────────────

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  intent: string,
): Promise<string> {
  /**
   * Instead of calling the tool directly, we route through Agent Ledger.
   * This gives us:
   *   - Policy evaluation (allow/deny/require_approval)
   *   - Risk assessment
   *   - Human approval for sensitive actions
   *   - Signed, tamper-evident receipt
   *   - Verification (read-after-write)
   */
  const result = await ledger.execute(toolName, args, {
    intent,
    noWait: false, // Block until approval if needed
  });

  switch (result.status) {
    case 'executed':
      return JSON.stringify({
        success: true,
        receiptId: result.receiptId,
        data: result.result,
      });

    case 'denied':
      return JSON.stringify({
        success: false,
        reason: result.error,
        receiptId: result.receiptId,
      });

    case 'pending_approval':
      return JSON.stringify({
        success: false,
        reason: 'Action requires human approval. Please wait.',
        receiptId: result.receiptId,
      });

    default:
      return JSON.stringify({ success: false, reason: 'Unknown status' });
  }
}

// ── 4. Agent loop (conceptual — replace with actual Anthropic SDK) ─────────

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * This simulates the Claude agent loop. In production, you'd use
 * the Anthropic SDK:
 *
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * const client = new Anthropic();
 *
 * const response = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   max_tokens: 1024,
 *   tools: TOOLS,
 *   messages: [{ role: 'user', content: userMessage }],
 * });
 * ```
 *
 * The key integration point is in handling tool_use blocks — you'd
 * call `executeToolCall()` instead of calling tools directly.
 */
async function runAgent(userMessage: string): Promise<void> {
  console.log(`\nUser: ${userMessage}\n`);

  // Simulated Claude response with tool calls
  const simulatedToolCalls: ToolUseBlock[] = [
    {
      type: 'tool_use',
      id: 'toolu_01',
      name: 'slack.send_message',
      input: { channel: '#general', text: 'Team standup reminder!' },
    },
    {
      type: 'tool_use',
      id: 'toolu_02',
      name: 'gmail.send',
      input: {
        to: ['partner@external-corp.com'],
        subject: 'Partnership Update',
        body: 'Here is our latest proposal...',
      },
    },
  ];

  for (const toolCall of simulatedToolCalls) {
    console.log(`Claude wants to call: ${toolCall.name}`);
    console.log(`  Args: ${JSON.stringify(toolCall.input)}`);

    const result = await executeToolCall(
      toolCall.name,
      toolCall.input,
      `Claude called ${toolCall.name} in response to: "${userMessage}"`,
    );

    console.log(`  Result: ${result}\n`);
  }
}

// ── 5. Run ─────────────────────────────────────────────────────────────────

async function main() {
  const healthy = await ledger.healthCheck();
  if (!healthy) {
    console.error('Start Agent Ledger first: npm run dev');
    process.exit(1);
  }

  await runAgent('Send a standup reminder to the team, and update our external partner on the proposal.');
}

main().catch(console.error);
