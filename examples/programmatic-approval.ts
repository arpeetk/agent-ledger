/**
 * Example: Programmatic approval workflow.
 *
 * Shows how to use the SDK to build an automated approval system
 * that auto-approves certain actions based on custom logic.
 *
 * Use case: A CI/CD pipeline that auto-approves staging actions
 * but requires human approval for production.
 */

import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  baseUrl: 'http://localhost:3001',
  session: {
    sessionId: 'approval-bot',
    agentId: 'approval-bot',
  },
});

async function autoApprovalBot() {
  console.log('Starting auto-approval bot...\n');

  // Poll for pending approvals every 5 seconds
  const interval = setInterval(async () => {
    const { data: pending } = await ledger.listReceipts({
      status: 'pending_approval',
      limit: 10,
    });

    for (const receipt of pending) {
      const shouldAutoApprove = evaluateAutoApprovalRules(receipt);

      if (shouldAutoApprove) {
        console.log(`Auto-approving: ${receipt.toolName} (${receipt.id})`);
        await ledger.approve(
          receipt.id,
          'auto-approval-bot',
          `Auto-approved: ${shouldAutoApprove}`,
        );
      } else {
        console.log(`Requires human: ${receipt.toolName} (${receipt.id})`);
      }
    }
  }, 5000);

  // Run for 60 seconds then stop
  setTimeout(() => {
    clearInterval(interval);
    console.log('\nAuto-approval bot stopped.');
  }, 60000);
}

function evaluateAutoApprovalRules(receipt: {
  toolName: string;
  riskLevel: string;
  riskReasons: string[];
  agentId: string;
  capability: string;
  redactedArgs: Record<string, unknown>;
}): string | false {
  // Auto-approve low-risk actions
  if (receipt.riskLevel === 'low') {
    return 'Low risk action';
  }

  // Auto-approve internal file shares
  if (receipt.toolName === 'file.share') {
    const sharedWith = receipt.redactedArgs.sharedWith;
    if (
      Array.isArray(sharedWith) &&
      sharedWith.every((email: unknown) => typeof email === 'string' && email.endsWith('@mycompany.com'))
    ) {
      return 'Internal file share';
    }
  }

  // Auto-approve calendar events with fewer than 20 attendees
  if (receipt.toolName === 'calendar.create_event') {
    const attendees = receipt.redactedArgs.attendees;
    if (Array.isArray(attendees) && attendees.length < 20) {
      return `Calendar event with ${attendees.length} attendees`;
    }
  }

  // Everything else needs human review
  return false;
}

autoApprovalBot().catch(console.error);
