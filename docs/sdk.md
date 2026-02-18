# SDK Guide

The `@agent-ledger/sdk` package provides a TypeScript client for integrating Agent Ledger into any AI agent, script, or application. It wraps the HTTP API with typed interfaces, automatic approval polling, and event callbacks.

## Installation

```bash
npm install @agent-ledger/sdk
```

Or if you're working in the monorepo:

```bash
# Already available via workspace dependency
import { AgentLedger } from '@agent-ledger/sdk';
```

## Quick Start

```typescript
import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  session: {
    sessionId: 'session-001',
    agentId: 'my-agent',
    userId: 'user@company.com',
    environment: 'production',
  },
});

const result = await ledger.execute('gmail.send', {
  to: ['alice@company.com'],
  subject: 'Hello',
  body: 'World',
}, { intent: 'Send a greeting' });

console.log(result.status);    // 'executed' | 'pending_approval' | 'denied'
console.log(result.receiptId); // 'cly8x...'
```

## Constructor Options

```typescript
interface LedgerClientOptions {
  /** Base URL of the Agent Ledger server (default: http://127.0.0.1:3001) */
  baseUrl?: string;

  /** Session metadata attached to every tool call */
  session: {
    sessionId: string;
    agentId: string;
    userId?: string;
    environment?: string;
  };

  /** Max time (ms) to wait for approval (default: 300000 = 5min) */
  approvalTimeoutMs?: number;

  /** Polling interval (ms) when waiting for approval (default: 2000) */
  pollIntervalMs?: number;

  /** Called when a tool call is pending approval */
  onPendingApproval?: (event: PendingApprovalEvent) => void;

  /** Called when a receipt is finalized */
  onReceiptFinalized?: (event: ReceiptFinalizedEvent) => void;

  /** Called on policy deny */
  onDenied?: (event: DeniedEvent) => void;
}
```

## Execute a Tool Call

```typescript
const result = await ledger.execute(
  'gmail.send',                          // tool name
  { to: ['alice@co.com'], subject: 'Hi' }, // arguments
  { intent: 'Send greeting email' },     // options (optional)
);
```

### Execution Options

```typescript
interface ExecuteOptions {
  /** Human-readable description of what the agent intends */
  intent?: string;

  /** If true, return immediately with pending status (don't poll for approval) */
  noWait?: boolean;
}
```

### Return Value

```typescript
interface ExecuteResult {
  status: 'executed' | 'pending_approval' | 'denied';
  receiptId: string;
  result?: Record<string, unknown>;  // present if executed
  error?: string;                     // present if denied
}
```

## Handling Different Outcomes

```typescript
const result = await ledger.execute('gmail.send', args, { intent });

switch (result.status) {
  case 'executed':
    // Tool call was allowed and executed successfully
    console.log('Done! Receipt:', result.receiptId);
    break;

  case 'pending_approval':
    // Tool call requires human approval
    // By default, execute() will poll until approved/denied
    // Use { noWait: true } to return immediately
    console.log('Waiting for approval...');
    break;

  case 'denied':
    // Tool call was blocked by policy
    console.log('Blocked:', result.error);
    break;
}
```

## Non-Blocking Approval Mode

By default, `execute()` blocks (polls) when a tool call requires approval. Use `noWait: true` to return immediately:

```typescript
const result = await ledger.execute('gmail.send', args, {
  intent: 'Send email',
  noWait: true,  // Don't wait for approval
});

if (result.status === 'pending_approval') {
  console.log('Pending approval. Receipt:', result.receiptId);
  // Later, manually poll or wait:
  const receipt = await ledger.waitForApproval(result.receiptId);
}
```

## Event Callbacks

React to events as they happen:

```typescript
const ledger = new AgentLedger({
  session: { sessionId: 's1', agentId: 'agent' },

  onPendingApproval: (event) => {
    console.log(`Tool ${event.toolName} needs approval`);
    console.log(`Approve at: ${event.approvalUrl}`);
    // Send Slack notification, email, etc.
  },

  onReceiptFinalized: (event) => {
    console.log(`Receipt ${event.receiptId}: ${event.status}`);
    // Log to monitoring system, update UI, etc.
  },

  onDenied: (event) => {
    console.log(`${event.toolName} denied: ${event.reason}`);
    // Log policy violation, alert security team, etc.
  },
});
```

## Receipt Operations

### Get a Receipt

```typescript
const receipt = await ledger.getReceipt('rcpt_abc123');
console.log(receipt.toolName);       // 'gmail.send'
console.log(receipt.policyDecision); // 'allow'
console.log(receipt.riskLevel);      // 'low'
```

### List Receipts

```typescript
const { data, cursor } = await ledger.listReceipts({
  status: 'pending_approval',
  limit: 10,
});
```

### Verify a Receipt Signature

```typescript
const { valid } = await ledger.verifyReceipt('rcpt_abc123');
console.log(valid); // true — cryptographic proof of integrity
```

## Programmatic Approval

For CI/CD pipelines, automated workflows, or admin tools:

```typescript
// Approve
await ledger.approve('rcpt_abc123', 'ci-bot', 'Auto-approved in staging');

// Deny
await ledger.deny('rcpt_abc123', 'security-bot', 'External sharing not allowed in prod');
```

## Tool Registration

Register tool definitions for documentation and type-safe wrappers:

```typescript
ledger.registerTool({
  name: 'gmail.send',
  description: 'Send an email via Gmail',
  parameters: {
    to: { type: 'array', description: 'Recipients', required: true },
    subject: { type: 'string', description: 'Subject line', required: true },
    body: { type: 'string', description: 'Email body' },
  },
});

// Use registered tools
const tools = ledger.getTools();
const gmailSend = tools.find(t => t.name === 'gmail.send')!;
const result = await gmailSend.execute({ to: ['a@b.com'], subject: 'Hi', body: '...' });
```

## Health Check

```typescript
const healthy = await ledger.healthCheck();
if (!healthy) {
  console.error('Agent Ledger server is not running');
  process.exit(1);
}
```

## Integration Patterns

### Pattern 1: Wrap an Existing Agent

Replace direct tool calls with ledger-gated calls:

```typescript
// Before
const sendEmail = async (to, subject, body) => {
  return await gmail.send({ to, subject, body });
};

// After
const sendEmail = async (to, subject, body) => {
  const result = await ledger.execute('gmail.send', { to, subject, body }, {
    intent: `Send email to ${to.join(', ')}: ${subject}`,
  });
  if (result.status !== 'executed') {
    throw new Error(`Email blocked: ${result.status} - ${result.error ?? 'needs approval'}`);
  }
  return result.result;
};
```

### Pattern 2: AI Agent with Tool Use

```typescript
async function handleAgentToolCall(toolName: string, args: any, intent: string) {
  const result = await ledger.execute(toolName, args, { intent, noWait: true });

  if (result.status === 'denied') {
    return { error: `Tool call denied: ${result.error}` };
  }

  if (result.status === 'pending_approval') {
    return {
      message: 'This action requires human approval.',
      receiptId: result.receiptId,
      approvalUrl: 'http://localhost:3000/approvals',
    };
  }

  return result.result;
}
```

### Pattern 3: Batch Operations with Mixed Policies

```typescript
const tasks = [
  { tool: 'gmail.send', args: internalEmailArgs, intent: 'Send team update' },
  { tool: 'gmail.send', args: externalEmailArgs, intent: 'Send client report' },
  { tool: 'slack.send_message', args: slackArgs, intent: 'Post to #general' },
];

const results = await Promise.all(
  tasks.map(t => ledger.execute(t.tool, t.args, { intent: t.intent, noWait: true }))
);

const allowed = results.filter(r => r.status === 'executed');
const pending = results.filter(r => r.status === 'pending_approval');
const denied = results.filter(r => r.status === 'denied');

console.log(`${allowed.length} executed, ${pending.length} pending, ${denied.length} denied`);
```
