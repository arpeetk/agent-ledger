import type { Capability, RiskAssessment, RiskLevel, RiskReason } from './types.js';

const URL_REGEX = /https?:\/\/[^\s]+/i;

export function assessRisk(
  capability: Capability,
  args: Record<string, unknown>,
  orgDomains: string[] = [],
): RiskAssessment {
  const reasons: RiskReason[] = [];

  // External recipient check
  if (['EMAIL_SEND', 'EMAIL_DRAFT'].includes(capability)) {
    const recipients = extractRecipients(args);
    const hasExternal = recipients.some(
      (r) => !orgDomains.some((d) => r.toLowerCase().endsWith(`@${d.toLowerCase()}`)),
    );
    if (hasExternal) reasons.push('external_recipient');
    if (recipients.length > 5) reasons.push('many_recipients');
  }

  // Calendar with many attendees
  if (capability === 'CALENDAR_WRITE') {
    const attendees = args.attendees;
    if (Array.isArray(attendees) && attendees.length > 10) {
      reasons.push('many_recipients');
    }
  }

  // Contains link
  const argsStr = JSON.stringify(args);
  if (URL_REGEX.test(argsStr)) {
    reasons.push('contains_link');
  }

  // Delete action
  if (capability === 'DELETE') {
    reasons.push('delete_action');
  }

  // Public post
  if (capability === 'PUBLIC_POST') {
    reasons.push('public_post');
  }

  // Unknown tool
  if (capability === 'UNKNOWN') {
    reasons.push('unknown_tool');
  }

  const level = computeLevel(reasons);
  return { level, reasons };
}

function computeLevel(reasons: RiskReason[]): RiskLevel {
  if (reasons.length === 0) return 'low';
  if (
    reasons.includes('delete_action') ||
    reasons.includes('public_post') ||
    reasons.includes('external_recipient') ||
    reasons.includes('unknown_tool')
  ) {
    return 'high';
  }
  return 'medium';
}

function extractRecipients(args: Record<string, unknown>): string[] {
  const to = args.to;
  if (Array.isArray(to)) return to.filter((r): r is string => typeof r === 'string');
  if (typeof to === 'string') return [to];
  return [];
}
