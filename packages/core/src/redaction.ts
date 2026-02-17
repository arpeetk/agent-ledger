import { createHash } from 'node:crypto';
import type { RedactionResult } from './types.js';

/**
 * Fields that should be redacted (never stored in full).
 * We store a hash instead.
 */
const REDACTED_FIELDS = ['body', 'description', 'content', 'message'];

/**
 * Fields that are safe to keep as metadata.
 */
const SAFE_FIELDS = [
  'to',
  'from',
  'cc',
  'bcc',
  'subject',
  'title',
  'startTime',
  'endTime',
  'start_time',
  'end_time',
  'attendees',
  'isDraft',
  'is_draft',
];

export function redactArgs(args: Record<string, unknown>): RedactionResult {
  const redacted: Record<string, unknown> = {};
  const fieldsRedacted: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (REDACTED_FIELDS.includes(key)) {
      redacted[`${key}_hash`] = hashValue(value);
      fieldsRedacted.push(key);
    } else if (SAFE_FIELDS.includes(key) || typeof value === 'number' || typeof value === 'boolean') {
      redacted[key] = value;
    } else if (typeof value === 'string' && value.length <= 200) {
      redacted[key] = value;
    } else {
      redacted[`${key}_hash`] = hashValue(value);
      fieldsRedacted.push(key);
    }
  }

  return { redactedArgs: redacted, fieldsRedacted };
}

export function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(str).digest('hex');
}
