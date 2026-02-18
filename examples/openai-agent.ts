/**
 * Example: Integrating Agent Ledger with an OpenAI GPT agent.
 *
 * This example shows how to wrap OpenAI's function calling with Agent Ledger.
 * The pattern is the same: intercept tool calls, route through the ledger.
 *
 * Prerequisites:
 *   - Agent Ledger server running (npm run dev)
 *   - OPENAI_API_KEY environment variable set (for live usage)
 */

import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  baseUrl: 'http://localhost:3001',
  session: {
    sessionId: `openai-${Date.now()}`,
    agentId: 'gpt-4o',
    userId: 'developer@company.com',
  },
  onPendingApproval: ({ toolName, approvalUrl }) => {
    console.log(`[Ledger] ${toolName} needs approval: ${approvalUrl}`);
  },
  onDenied: ({ toolName, reason }) => {
    console.log(`[Ledger] ${toolName} denied: ${reason}`);
  },
});

// OpenAI function definitions (used with openai.chat.completions.create)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const functions = [
  {
    name: 'gmail.send',
    description: 'Send an email via Gmail',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'github.create_issue',
    description: 'Create a GitHub issue',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['repo', 'title'],
    },
  },
];

/**
 * Handle a function call from OpenAI's response.
 *
 * In production with the OpenAI SDK:
 * ```typescript
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages,
 *   functions,
 * });
 *
 * for (const toolCall of response.choices[0].message.tool_calls ?? []) {
 *   const result = await handleFunctionCall(
 *     toolCall.function.name,
 *     JSON.parse(toolCall.function.arguments),
 *   );
 *   // Feed result back to the model...
 * }
 * ```
 */
async function handleFunctionCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await ledger.execute(name, args, {
    intent: `GPT-4o called ${name}`,
    noWait: true,
  });

  if (result.status === 'executed') {
    return JSON.stringify({ success: true, data: result.result });
  }
  if (result.status === 'denied') {
    return JSON.stringify({ error: result.error });
  }
  return JSON.stringify({ pending: true, receiptId: result.receiptId });
}

// Simulated run
async function main() {
  const healthy = await ledger.healthCheck();
  if (!healthy) {
    console.error('Start Agent Ledger first: npm run dev');
    process.exit(1);
  }

  console.log('Simulating OpenAI GPT agent with Agent Ledger...\n');

  // GPT wants to send an internal email (auto-allowed)
  console.log('1. GPT wants to send internal email:');
  const r1 = await handleFunctionCall('gmail.send', {
    to: ['alice@mycompany.com'],
    subject: 'Bug fix deployed',
    body: 'The fix for JIRA-1234 has been deployed to staging.',
  });
  console.log(`   Result: ${r1}\n`);

  // GPT wants to create a GitHub issue (auto-allowed)
  console.log('2. GPT wants to create a GitHub issue:');
  const r2 = await handleFunctionCall('github.create_issue', {
    repo: 'mycompany/backend',
    title: 'Investigate memory leak in worker process',
    body: 'Heap usage has been growing steadily over the past 24h.',
    labels: ['bug', 'performance'],
  });
  console.log(`   Result: ${r2}\n`);

  // GPT wants to email an external person (needs approval)
  console.log('3. GPT wants to email an external contact:');
  const r3 = await handleFunctionCall('gmail.send', {
    to: ['vendor@external.com'],
    subject: 'License renewal',
    body: 'Can we discuss renewal terms?',
  });
  console.log(`   Result: ${r3}\n`);

  // Check audit trail
  const { data: receipts } = await ledger.listReceipts({ limit: 5 });
  console.log(`Audit trail: ${receipts.length} receipts in ledger`);
  for (const r of receipts) {
    console.log(`  ${r.toolName.padEnd(25)} ${r.status.padEnd(20)} ${r.policyDecision}`);
  }
}

main().catch(console.error);
