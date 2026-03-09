/**
 * Demo: Using the Agent Ledger SDK to wrap tool functions.
 *
 * This shows "local" mode — the SDK evaluates policy via the server,
 * then executes tool functions locally and reports results.
 *
 * Run: npm run demo:sdk (after npm run dev)
 */
import { AgentLedger, LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';

// ── Mock tool functions (these would be real implementations in production) ──

async function sendEmail(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const to = args.to as string[];
  const subject = args.subject as string;
  console.log(`    [mock] Sending email to ${to.join(', ')}: "${subject}"`);
  return { sent: true, to, subject, messageId: `msg-${Date.now()}` };
}

async function createDraft(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const to = args.to as string[];
  const subject = args.subject as string;
  console.log(`    [mock] Creating draft to ${to.join(', ')}: "${subject}"`);
  return { drafted: true, to, subject, draftId: `draft-${Date.now()}` };
}

async function createEvent(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const title = args.title as string;
  const attendees = args.attendees as string[];
  console.log(`    [mock] Creating event "${title}" with ${attendees.length} attendees`);
  return { created: true, title, eventId: `evt-${Date.now()}` };
}

async function postToSocial(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(`    [mock] Posting to ${args.platform}: "${args.content}"`);
  return { posted: true };
}

// ── Initialize the SDK ──

const ledger = new AgentLedger({
  serverUrl: process.env.SERVER_URL ?? 'http://127.0.0.1:3001',
  session: {
    agentId: 'sdk-demo-agent',
    userId: 'demo-user',
    environment: 'development',
  },
  mode: 'local',
  approvalTimeoutMs: 120_000,
  onPendingApproval: (event) => {
    console.log(`    Pending approval: ${event.toolName} (${event.riskLevel} risk)`);
    console.log(`    Approve at: http://localhost:3000/approvals`);
  },
  onDenied: (event) => {
    console.log(`    Denied: ${event.toolName} — ${event.policyExplanation}`);
  },
  onExecuted: (event) => {
    console.log(`    Executed: ${event.toolName} in ${event.latencyMs}ms`);
  },
});

// ── Wrap tools ──

const tools = ledger.wrapAll({
  'gmail.send': sendEmail,
  'gmail.create_draft': createDraft,
  'calendar.create_event': createEvent,
  'social.post': postToSocial,
});

// ── Run demo scenarios ──

async function main() {
  console.log('=== Agent Ledger SDK Demo ===\n');
  console.log(`Session: ${ledger.getSessionId()}\n`);

  // Check server health
  const healthy = await ledger.health();
  if (!healthy) {
    console.error('Server is not running. Start with: npm run dev');
    process.exit(1);
  }

  // 1. Internal email (auto-allowed by policy)
  console.log('1. Sending internal email...');
  try {
    const r1 = await tools['gmail.send']({
      to: ['alice@mycompany.com'],
      subject: 'Weekly standup notes',
      body: "Here are the notes from today's standup meeting.",
    });
    console.log(`   Status: ${r1.status} | Receipt: ${r1.receiptId}`);
    console.log(`   Result: ${JSON.stringify(r1.result)}\n`);
  } catch (err) {
    console.error(`   Error: ${err}\n`);
  }

  // 2. External email draft (requires approval)
  console.log('2. Creating external email draft (requires approval)...');
  try {
    const r2 = await tools['gmail.create_draft']({
      to: ['partner@external-corp.com'],
      subject: 'Partnership proposal',
      body: 'Dear partner, we would like to discuss a potential collaboration.',
    });
    console.log(`   Status: ${r2.status} | Receipt: ${r2.receiptId}`);
    console.log(`   Result: ${JSON.stringify(r2.result)}\n`);
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      console.log(`   Waiting for approval: ${err.receiptId}\n`);
    } else {
      console.error(`   Error: ${err}\n`);
    }
  }

  // 3. Calendar event with many attendees (requires approval)
  console.log('3. Creating calendar event with 12 attendees (requires approval)...');
  try {
    const r3 = await tools['calendar.create_event']({
      title: 'All-hands meeting',
      startTime: '2025-01-15T10:00:00Z',
      endTime: '2025-01-15T11:00:00Z',
      attendees: [
        'alice@mycompany.com',
        'bob@mycompany.com',
        'carol@mycompany.com',
        'dave@mycompany.com',
        'eve@mycompany.com',
        'frank@mycompany.com',
        'grace@mycompany.com',
        'heidi@mycompany.com',
        'ivan@mycompany.com',
        'judy@mycompany.com',
        'karl@mycompany.com',
        'linda@mycompany.com',
      ],
      description: 'Quarterly all-hands meeting. Agenda: product updates, Q&A.',
    });
    console.log(`   Status: ${r3.status} | Receipt: ${r3.receiptId}`);
    console.log(`   Result: ${JSON.stringify(r3.result)}\n`);
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      console.log(`   Waiting for approval: ${err.receiptId}\n`);
    } else {
      console.error(`   Error: ${err}\n`);
    }
  }

  // 4. Public post (denied by policy)
  console.log('4. Attempting public post (denied by policy)...');
  try {
    const r4 = await tools['social.post']({
      content: 'Check out our new product launch!',
      platform: 'twitter',
    });
    console.log(`   Status: ${r4.status}\n`);
  } catch (err) {
    if (err instanceof LedgerDeniedError) {
      console.log(`   Denied: ${err.reason}`);
      console.log(`   Receipt: ${err.receiptId}\n`);
    } else {
      console.error(`   Error: ${err}\n`);
    }
  }

  console.log('=== Demo complete ===');
  console.log('View all receipts at: http://localhost:3000');
}

main().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
