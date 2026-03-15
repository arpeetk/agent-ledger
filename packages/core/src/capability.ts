import type { Capability } from './types.js';

/**
 * Maps tool names to capabilities.
 * Extensible: add new tools here.
 */
const TOOL_CAPABILITY_MAP: Record<string, Capability> = {
  'gmail.send': 'EMAIL_SEND',
  'gmail.create_draft': 'EMAIL_DRAFT',
  'gmail.get_draft': 'READ_ONLY',
  'gmail.get_message': 'READ_ONLY',
  'calendar.create_event': 'CALENDAR_WRITE',
  'calendar.get_event': 'READ_ONLY',
  'file.share': 'FILE_SHARE',
  'file.delete': 'DELETE',
  'social.post': 'PUBLIC_POST',
  'payments.charge': 'PAYMENTS',
};

export function getCapability(toolName: string): Capability {
  return TOOL_CAPABILITY_MAP[toolName] ?? 'UNKNOWN';
}
