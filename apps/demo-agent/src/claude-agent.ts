/**
 * Agent Ledger + Claude API Demo
 *
 * A real AI agent that uses Claude to decide which tools to call,
 * with every tool call gated by Agent Ledger policies.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run demo:claude
 *
 * Requires:
 *   1. Agent Ledger server running (npm run dev)
 *   2. Anthropic API key in ANTHROPIC_API_KEY env var
 */
import Anthropic from '@anthropic-ai/sdk';
import { AgentLedger } from '@agent-ledger/sdk';
import { createToolProcessor } from '@agent-ledger/adapter-anthropic';

// ── Setup ──

const anthropic = new Anthropic();

const ledger = new AgentLedger({
  serverUrl: process.env.SERVER_URL ?? 'http://127.0.0.1:3001',
  mode: 'gateway',
  session: {
    agentId: 'claude-demo-agent',
    userId: 'demo-user',
    environment: 'development',
  },
  onPendingApproval: (event) => {
    console.log(`\n⏳ Awaiting approval for "${event.toolName}"`);
    console.log(`   Risk: ${event.riskLevel} | Receipt: ${event.receiptId}`);
    console.log(`   Reason: ${event.policyExplanation}`);
    console.log(`   Approve at: http://localhost:3000/approvals\n`);
  },
  onDenied: (event) => {
    console.log(`\n🚫 Denied: "${event.toolName}" — ${event.policyExplanation}\n`);
  },
  onExecuted: (event) => {
    console.log(
      `\n✅ Executed "${event.toolName}" in ${event.latencyMs}ms (receipt: ${event.receiptId})\n`,
    );
  },
});

// ── Tool Definitions ──

const processor = createToolProcessor(
  ledger,
  {
    gmail_send: {
      definition: {
        name: 'gmail.send',
        description:
          'Send an email. Use this to send emails to recipients. ' +
          'Internal emails to @mycompany.com are auto-allowed. ' +
          'External emails require human approval.',
        input_schema: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of recipient email addresses',
            },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Email body content' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      handler: async (args) => args, // Server-side execution via gateway mode
    },
    gmail_create_draft: {
      definition: {
        name: 'gmail.create_draft',
        description:
          'Create an email draft without sending. ' +
          'Useful for composing emails that need review before sending.',
        input_schema: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of recipient email addresses',
            },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Draft body content' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      handler: async (args) => args,
    },
    calendar_create_event: {
      definition: {
        name: 'calendar.create_event',
        description:
          'Create a calendar event. Events with more than 10 attendees require approval.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            startTime: { type: 'string', description: 'ISO 8601 start time' },
            endTime: { type: 'string', description: 'ISO 8601 end time' },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of attendee email addresses',
            },
            description: { type: 'string', description: 'Event description' },
          },
          required: ['title', 'startTime', 'endTime', 'attendees'],
        },
      },
      handler: async (args) => args,
    },
    social_post: {
      definition: {
        name: 'social.post',
        description: 'Post content to social media. This action is always denied by policy.',
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Post content' },
            platform: { type: 'string', description: 'Target platform (twitter, linkedin, etc.)' },
          },
          required: ['content', 'platform'],
        },
      },
      handler: async (args) => args,
    },
  },
  { onApproval: 'message', onDenied: 'message' },
);

// ── Agent Loop ──

const SYSTEM_PROMPT = `You are a helpful executive assistant AI. You have access to email, calendar, and social media tools.

Your task: Execute the following actions in order, reporting the result of each:
1. Send an internal email to alice@mycompany.com with subject "Q1 Review" and a brief professional body
2. Create a draft email to partner@external-corp.com about a partnership proposal
3. Schedule an all-hands meeting for tomorrow at 2pm with 12 attendees (use @mycompany.com emails)
4. Try to post "Exciting news!" on Twitter

After each action, briefly report what happened (approved, pending, denied, etc.) and move to the next one. Be concise.`;

async function runAgent() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     Agent Ledger + Claude API Demo                  ║');
  console.log('║     Policy-gated tool execution in action           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Check server health
  const healthy = await ledger.health();
  if (!healthy) {
    console.error('Agent Ledger server is not running. Start it with: npm run dev');
    process.exit(1);
  }
  console.log('Agent Ledger server: connected');
  console.log(`Session: ${ledger.getSessionId()}\n`);
  console.log('--- Claude is thinking... ---\n');

  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: SYSTEM_PROMPT }];

  let continueLoop = true;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (continueLoop && iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      tools: processor.definitions() as Anthropic.Messages.Tool[],
      messages,
    });

    // Process text blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        console.log(`Claude: ${block.text}`);
      }
    }

    // Process tool use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length > 0) {
      console.log(`\n[Calling ${toolUseBlocks.length} tool(s)...]`);

      // Cast to adapter's ToolUseBlock type (Anthropic SDK uses `unknown` for input)
      const adapterBlocks = toolUseBlocks.map((b) => ({
        type: 'tool_use' as const,
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));
      const toolResults = await processor.processAll(adapterBlocks, { sequential: true });

      // Add assistant response and tool results to messages
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.tool_use_id,
          content: tr.content,
          ...(tr.is_error ? { is_error: true } : {}),
        })),
      });
    }

    if (response.stop_reason === 'end_turn') {
      continueLoop = false;
    } else if (response.stop_reason !== 'tool_use') {
      continueLoop = false;
    }
  }

  // Final summary
  console.log('\n--- Demo complete ---');
  console.log('View all receipts: http://localhost:3000');
  console.log('View approvals:    http://localhost:3000/approvals');

  // Show receipt summary
  const receipts = await ledger.listReceipts({ limit: 10 });
  const sessionReceipts = receipts.data.filter((r) => r.agentId === 'claude-demo-agent');
  if (sessionReceipts.length > 0) {
    console.log(`\nReceipts from this session:`);
    for (const r of sessionReceipts) {
      const icon = r.status === 'executed' ? '✅' : r.status === 'denied' ? '🚫' : '⏳';
      console.log(`  ${icon} ${r.toolName} → ${r.status} (${r.id})`);
    }
  }
}

runAgent().catch((err) => {
  console.error('Agent error:', err.message ?? err);
  process.exit(1);
});
