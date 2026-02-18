import { AgentLedger } from '@agent-ledger/sdk';
import * as log from './log.js';

const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:3001';

const stats = { allowed: 0, denied: 0, pending: 0, total: 0 };

const ledger = new AgentLedger({
  baseUrl: SERVER_URL,
  session: {
    sessionId: `claude-session-${Date.now()}`,
    agentId: 'claude-research-assistant',
    userId: 'sarah@mycompany.com',
    environment: 'production',
  },
  approvalTimeoutMs: 120_000,
  pollIntervalMs: 2_000,

  onPendingApproval: (event) => {
    stats.pending++;
    log.pendingApproval(event.approvalUrl);
  },
  onReceiptFinalized: (event) => {
    if (event.status === 'executed') {
      log.approved(event.receiptId);
    }
  },
  onDenied: (event) => {
    stats.denied++;
    log.denied(event.reason);
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Simulates a multi-step AI research assistant preparing for a
 * quarterly board meeting. Demonstrates how Agent Ledger intercepts,
 * classifies, and governs every tool call.
 *
 * Scenario:
 *   Sarah asks Claude to prepare the Q1 board meeting. Claude needs to:
 *   1. Post a Slack update to #general (auto-allowed: internal channel)
 *   2. Send meeting notes email to the team (auto-allowed: internal email)
 *   3. Draft an investor update to external stakeholders (requires approval)
 *   4. Create a GitHub issue to track action items (auto-allowed)
 *   5. Schedule the board meeting with 15 attendees (requires approval: >10 people)
 *   6. Share the board deck with an external board member (requires approval)
 *   7. Attempt to post earnings preview on social media (denied: public posting)
 *   8. Attempt to process a payment (denied: payments blocked)
 */
async function main(): Promise<void> {
  log.banner();

  const healthy = await ledger.healthCheck();
  if (!healthy) {
    console.error(
      '\n  Agent Ledger server is not running. Start it with:\n\n' +
        '    npm run dev\n\n' +
        '  Then run this demo in another terminal:\n\n' +
        '    npm run demo:claude\n',
    );
    process.exit(1);
  }

  log.info('Sarah asks: "Claude, please prepare everything for our Q1 board meeting."');
  log.info('Claude begins planning the board meeting preparation...');
  await sleep(800);

  const TOTAL_STEPS = 8;

  // ── Step 1: Slack update ──────────────────────────────────────────────────
  log.step(1, TOTAL_STEPS, 'Post team update on Slack');
  log.thinking('I should let the team know we\'re preparing for the board meeting.');
  await sleep(400);
  log.action('slack.send_message', 'Post board meeting prep update to #general');

  const r1 = await ledger.execute(
    'slack.send_message',
    {
      channel: '#general',
      text: 'Hey team! Starting Q1 board meeting prep. I\'ll be sending out materials and scheduling the meeting shortly. Please have your department updates ready by EOD Thursday.',
      from: 'claude-assistant',
    },
    { intent: 'Notify the team about board meeting preparation kickoff' },
  );
  stats.total++;
  if (r1.status === 'executed') {
    stats.allowed++;
    log.allowed(r1.receiptId);
  }

  await sleep(600);

  // ── Step 2: Internal team email ───────────────────────────────────────────
  log.step(2, TOTAL_STEPS, 'Email meeting notes to the team');
  log.thinking(
    'The leadership team needs the agenda and prep materials. All internal recipients — this should be auto-allowed.',
  );
  await sleep(400);
  log.action('gmail.send', 'Send board meeting agenda to leadership team');

  const r2 = await ledger.execute(
    'gmail.send',
    {
      to: [
        'sarah@mycompany.com',
        'mike@mycompany.com',
        'jessica@mycompany.com',
        'david@mycompany.com',
      ],
      subject: 'Q1 Board Meeting — Agenda & Preparation Checklist',
      body: `Hi team,

Here's the agenda for the Q1 board meeting:

1. Financial review (Mike)
2. Product roadmap update (Jessica)
3. Engineering velocity report (David)
4. Hiring plan for Q2 (Sarah)
5. Board Q&A

Please have your slides uploaded to the shared drive by Thursday EOD.

Best,
Claude (on behalf of Sarah)`,
    },
    { intent: 'Send board meeting agenda and prep checklist to leadership team' },
  );
  stats.total++;
  if (r2.status === 'executed') {
    stats.allowed++;
    log.allowed(r2.receiptId);
  }

  await sleep(600);

  // ── Step 3: External investor email draft ─────────────────────────────────
  log.step(3, TOTAL_STEPS, 'Draft investor update email');
  log.thinking(
    'The investors need a quarterly update. External recipients — this will likely need human approval before sending.',
  );
  await sleep(400);
  log.action('gmail.create_draft', 'Draft quarterly update for external investors');

  const r3 = await ledger.execute(
    'gmail.create_draft',
    {
      to: [
        'john.smith@sequoia-capital.com',
        'emily.chen@a16z.com',
        'raj.patel@greylock.com',
      ],
      subject: 'MyCompany Q1 2025 — Quarterly Board Update',
      body: `Dear Board Members,

Please find attached our Q1 2025 quarterly update.

Highlights:
- Revenue grew 42% QoQ to $12.3M ARR
- Net retention at 135%
- Launched 3 major product features
- Team grew from 45 to 62 employees

Full deck and financials are attached. Looking forward to discussing at the board meeting.

Best regards,
Sarah Chen, CEO`,
    },
    { intent: 'Draft quarterly investor update email with financial highlights' },
  );
  stats.total++;
  if (r3.status === 'executed') {
    stats.allowed++;
    log.allowed(r3.receiptId);
  }

  await sleep(600);

  // ── Step 4: GitHub issue for action items ─────────────────────────────────
  log.step(4, TOTAL_STEPS, 'Create GitHub issue for action items');
  log.thinking('I should track the board meeting action items in GitHub so nothing falls through the cracks.');
  await sleep(400);
  log.action('github.create_issue', 'Create tracking issue for board meeting action items');

  const r4 = await ledger.execute(
    'github.create_issue',
    {
      repo: 'mycompany/operations',
      title: '[Q1 Board Meeting] Preparation Checklist & Action Items',
      body: `## Board Meeting Preparation

### Pre-meeting
- [ ] Financial slides (Mike) — due Thursday
- [ ] Product roadmap deck (Jessica) — due Thursday
- [ ] Engineering metrics report (David) — due Thursday
- [ ] Hiring plan draft (Sarah) — due Friday
- [ ] Board deck compiled and reviewed
- [ ] Investor update email sent

### Meeting logistics
- [ ] Calendar invite sent to all attendees
- [ ] Zoom link confirmed
- [ ] Board deck shared with external members

### Post-meeting
- [ ] Meeting minutes distributed
- [ ] Action items assigned
- [ ] Follow-up emails sent`,
      labels: ['board-meeting', 'q1-2025', 'priority-high'],
      assignees: ['sarah', 'mike', 'jessica', 'david'],
    },
    { intent: 'Create GitHub issue to track board meeting preparation tasks' },
  );
  stats.total++;
  if (r4.status === 'executed') {
    stats.allowed++;
    log.allowed(r4.receiptId);
  }

  await sleep(600);

  // ── Step 5: Schedule board meeting with many attendees ────────────────────
  log.step(5, TOTAL_STEPS, 'Schedule board meeting (15 attendees)');
  log.thinking(
    'The board meeting has 15 attendees including external board members. The policy will probably flag this for approval.',
  );
  await sleep(400);
  log.action('calendar.create_event', 'Schedule Q1 board meeting with all attendees');

  const r5 = await ledger.execute(
    'calendar.create_event',
    {
      title: 'Q1 2025 Board Meeting',
      startTime: '2025-03-15T14:00:00Z',
      endTime: '2025-03-15T16:00:00Z',
      attendees: [
        'sarah@mycompany.com',
        'mike@mycompany.com',
        'jessica@mycompany.com',
        'david@mycompany.com',
        'alex@mycompany.com',
        'john.smith@sequoia-capital.com',
        'emily.chen@a16z.com',
        'raj.patel@greylock.com',
        'lisa.wong@mycompany.com',
        'tom.harris@mycompany.com',
        'nina.patel@mycompany.com',
        'chris.lee@mycompany.com',
        'amanda.garcia@mycompany.com',
        'brian.johnson@board-advisor.com',
        'diana.kraft@independent-director.com',
      ],
      description:
        'Q1 2025 Board Meeting. Agenda: Financial review, product roadmap, engineering velocity, hiring plan, Q&A. Zoom: https://zoom.us/j/123456789',
    },
    { intent: 'Schedule quarterly board meeting with leadership team and external board members' },
  );
  stats.total++;
  if (r5.status === 'executed') {
    stats.allowed++;
    log.allowed(r5.receiptId);
  }

  await sleep(600);

  // ── Step 6: Share board deck with external member ─────────────────────────
  log.step(6, TOTAL_STEPS, 'Share board deck with external board member');
  log.thinking(
    'Brian needs access to the board deck. He\'s external — file sharing with external users will need approval.',
  );
  await sleep(400);
  log.action('file.share', 'Share board deck PDF with external board member');

  const r6 = await ledger.execute(
    'file.share',
    {
      fileName: 'Q1-2025-Board-Deck-CONFIDENTIAL.pdf',
      sharedWith: ['brian.johnson@board-advisor.com'],
      permission: 'view',
      owner: 'sarah@mycompany.com',
    },
    { intent: 'Share confidential board deck with external board advisor (view-only)' },
  );
  stats.total++;
  if (r6.status === 'executed') {
    stats.allowed++;
    log.allowed(r6.receiptId);
  }

  await sleep(600);

  // ── Step 7: Attempt social media post (DENIED) ───────────────────────────
  log.step(7, TOTAL_STEPS, 'Post earnings preview on social media');
  log.thinking(
    'Sarah mentioned we could share a teaser about the strong quarter. Let me try posting a preview...',
  );
  await sleep(400);
  log.action('social.post', 'Post Q1 earnings preview on Twitter');

  await ledger.execute(
    'social.post',
    {
      content:
        'Excited to share: MyCompany hit $12.3M ARR in Q1, up 42% QoQ! Full board update coming soon. #startup #growth',
      platform: 'twitter',
    },
    { intent: 'Post Q1 earnings preview on social media before board meeting' },
  );
  stats.total++;

  await sleep(600);

  // ── Step 8: Attempt payment (DENIED) ──────────────────────────────────────
  log.step(8, TOTAL_STEPS, 'Process catering payment for board dinner');
  log.thinking('We need to pay the caterer for the board dinner. Let me try processing the payment...');
  await sleep(400);
  log.action('payments.charge', 'Process catering payment for board dinner');

  await ledger.execute(
    'payments.charge',
    {
      vendor: 'Premium Catering Co.',
      amount: 2500,
      currency: 'USD',
      description: 'Board meeting dinner catering - Q1 2025',
    },
    { intent: 'Process payment for board meeting dinner catering service' },
  );
  stats.total++;

  await sleep(400);

  // ── Summary ───────────────────────────────────────────────────────────────
  log.summary(stats);

  log.info('Claude: "Board meeting prep is underway! Here\'s what happened:"');
  log.info('');
  log.info('  - Slack update posted to #general (auto-allowed)');
  log.info('  - Team agenda email sent to 4 internal recipients (auto-allowed)');
  log.info('  - Investor email drafted for 3 external recipients (needed approval)');
  log.info('  - GitHub issue created for tracking prep tasks (auto-allowed)');
  log.info('  - Board meeting scheduled with 15 attendees (needed approval)');
  log.info('  - Board deck shared with external advisor (needed approval)');
  log.info('  - Social media earnings post blocked by policy (denied)');
  log.info('  - Payment processing blocked by policy (denied)');
  log.info('');
  log.info('Every action above generated a signed, tamper-evident receipt.');
  log.info('The full audit trail is available at http://localhost:3000');
  console.log();
}

main().catch((err) => {
  console.error('Claude agent error:', err);
  process.exit(1);
});
