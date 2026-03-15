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
});

// ── Tool name mapping ──
// Claude API requires tool names matching ^[a-zA-Z0-9_-]+
// Agent Ledger server uses dot-notation (gmail.send, calendar.create_event)
const TOOL_NAME_MAP: Record<string, string> = {
  gmail_send: 'gmail.send',
  gmail_create_draft: 'gmail.create_draft',
  calendar_create_event: 'calendar.create_event',
  social_post: 'social.post',
};

// ── Tool Definitions (sent to Claude) ──

const tools: Anthropic.Messages.Tool[] = [
  {
    name: 'gmail_send',
    description:
      'Send an email. Internal emails to @mycompany.com are auto-allowed. ' +
      'External emails require human approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_create_draft',
    description: 'Create an email draft without sending. Useful for emails that need review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Draft body content' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a calendar event. Events with more than 10 attendees require approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Event title' },
        startTime: { type: 'string', description: 'ISO 8601 start time' },
        endTime: { type: 'string', description: 'ISO 8601 end time' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Attendee email addresses',
        },
        description: { type: 'string', description: 'Event description' },
      },
      required: ['title', 'startTime', 'endTime', 'attendees'],
    },
  },
  {
    name: 'social_post',
    description: 'Post content to social media. This action is always denied by policy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Post content' },
        platform: { type: 'string', description: 'Target platform (twitter, linkedin, etc.)' },
      },
      required: ['content', 'platform'],
    },
  },
];

// ── Execute a tool call through Agent Ledger ──

async function executeTool(
  claudeName: string,
  args: Record<string, unknown>,
): Promise<{ content: string; is_error?: boolean }> {
  const serverName = TOOL_NAME_MAP[claudeName] ?? claudeName;

  try {
    const result = await ledger.execute(serverName, args, { onApproval: 'skip' });

    if (result.status === 'pending_approval') {
      console.log(`\n  ⏳ "${serverName}" requires approval`);
      console.log(`     Receipt: ${result.receiptId}`);
      console.log(`     Approve at: http://localhost:3000/approvals\n`);
      return {
        content: JSON.stringify({
          status: 'pending_approval',
          receiptId: result.receiptId,
          message: 'This action requires human approval before execution.',
        }),
      };
    }

    if (result.status === 'denied') {
      console.log(`\n  🚫 "${serverName}" denied: ${result.error}\n`);
      return {
        content: JSON.stringify({
          status: 'denied',
          message: `Denied by policy: ${result.error}`,
        }),
      };
    }

    console.log(`\n  ✅ "${serverName}" executed (receipt: ${result.receiptId})\n`);
    return {
      content: result.result === undefined ? '{}' : JSON.stringify(result.result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Extract useful info from ledger errors
    if (message.includes('denied')) {
      console.log(`\n  🚫 "${serverName}" denied\n`);
      return { content: JSON.stringify({ status: 'denied', message }) };
    }
    console.log(`\n  ❌ "${serverName}" error: ${message}\n`);
    return { content: message, is_error: true };
  }
}

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
      tools,
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

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          ...(result.is_error ? { is_error: true } : {}),
        });
      }

      // Add assistant response and tool results to messages
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
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
