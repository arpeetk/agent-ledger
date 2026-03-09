const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:3001';

interface ToolCallResult {
  status: 'executed' | 'pending_approval' | 'denied';
  receiptId: string;
  result?: Record<string, unknown>;
  error?: string;
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  intent?: string,
): Promise<ToolCallResult> {
  const res = await fetch(`${SERVER_URL}/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        sessionId: 'demo-session-001',
        agentId: 'demo-agent',
        userId: 'demo-user',
        environment: 'development',
      },
      toolName,
      args,
      intent,
    }),
  });

  return (await res.json()) as ToolCallResult;
}

async function pollReceipt(receiptId: string, maxWait = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`${SERVER_URL}/receipts/${receiptId}`);
    const receipt = (await res.json()) as { status: string };
    if (receipt.status !== 'pending_approval') {
      console.log(`  Receipt ${receiptId} finalized: ${receipt.status}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write('.');
  }
  console.log(`  Timed out waiting for receipt ${receiptId}`);
}

async function main() {
  console.log('=== Agent Ledger Demo Agent ===\n');

  // 1. Internal email (should be auto-allowed)
  console.log('1. Sending internal email...');
  const r1 = await callTool(
    'gmail.send',
    {
      to: ['alice@mycompany.com'],
      subject: 'Weekly standup notes',
      body: "Here are the notes from today's standup meeting.",
    },
    'Send weekly standup notes to the team',
  );
  console.log(`   Status: ${r1.status} | Receipt: ${r1.receiptId}\n`);

  // 2. External email draft (should require approval)
  console.log('2. Creating external email draft...');
  const r2 = await callTool(
    'gmail.create_draft',
    {
      to: ['partner@external-corp.com'],
      subject: 'Partnership proposal',
      body: 'Dear partner, we would like to discuss a potential collaboration.',
    },
    'Draft partnership proposal to external contact',
  );
  console.log(`   Status: ${r2.status} | Receipt: ${r2.receiptId}`);
  if (r2.status === 'pending_approval') {
    console.log(`   Approve at: http://localhost:3000/approvals`);
    console.log('   Waiting for approval...');
    await pollReceipt(r2.receiptId);
  }
  console.log();

  // 3. Calendar event with many attendees (should require approval)
  console.log('3. Creating calendar event with 12 attendees...');
  const r3 = await callTool(
    'calendar.create_event',
    {
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
    },
    'Schedule quarterly all-hands with entire team',
  );
  console.log(`   Status: ${r3.status} | Receipt: ${r3.receiptId}`);
  if (r3.status === 'pending_approval') {
    console.log(`   Approve at: http://localhost:3000/approvals`);
    console.log('   Waiting for approval...');
    await pollReceipt(r3.receiptId);
  }
  console.log();

  // 4. Public post (should be denied)
  console.log('4. Attempting public post...');
  const r4 = await callTool(
    'social.post',
    {
      content: 'Check out our new product launch!',
      platform: 'twitter',
    },
    'Post product announcement on social media',
  );
  console.log(`   Status: ${r4.status} | Receipt: ${r4.receiptId}`);
  if (r4.error) console.log(`   Reason: ${r4.error}`);
  console.log();

  console.log('=== Demo complete ===');
  console.log('View all receipts at: http://localhost:3000');
}

main().catch((err) => {
  console.error('Demo agent error:', err);
  process.exit(1);
});
