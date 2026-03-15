import { describe, it, expect } from 'vitest';
import { getCapability } from '../src/capability.js';
import type { Capability } from '../src/types.js';

const VALID_CAPABILITIES: Capability[] = [
  'READ_ONLY',
  'EMAIL_DRAFT',
  'EMAIL_SEND',
  'CALENDAR_WRITE',
  'FILE_SHARE',
  'DELETE',
  'PUBLIC_POST',
  'PAYMENTS',
  'UNKNOWN',
];

describe('getCapability', () => {
  describe('known tool mappings', () => {
    const cases: [string, Capability][] = [
      ['gmail.send', 'EMAIL_SEND'],
      ['gmail.create_draft', 'EMAIL_DRAFT'],
      ['gmail.get_draft', 'READ_ONLY'],
      ['gmail.get_message', 'READ_ONLY'],
      ['calendar.create_event', 'CALENDAR_WRITE'],
      ['calendar.get_event', 'READ_ONLY'],
      ['file.share', 'FILE_SHARE'],
      ['file.delete', 'DELETE'],
      ['social.post', 'PUBLIC_POST'],
      ['payments.charge', 'PAYMENTS'],
    ];

    it.each(cases)('maps %s to %s', (toolName, expected) => {
      expect(getCapability(toolName)).toBe(expected);
    });
  });

  describe('unknown tools', () => {
    it('defaults to UNKNOWN for an unknown tool', () => {
      expect(getCapability('unknown.tool')).toBe('UNKNOWN');
    });

    it('defaults to UNKNOWN for an empty string', () => {
      expect(getCapability('')).toBe('UNKNOWN');
    });

    it('defaults to UNKNOWN for a similar but non-matching tool name', () => {
      expect(getCapability('gmail.delete')).toBe('UNKNOWN');
    });
  });

  describe('return values are valid Capability types', () => {
    const allTools = [
      'gmail.send',
      'gmail.create_draft',
      'gmail.get_draft',
      'gmail.get_message',
      'calendar.create_event',
      'calendar.get_event',
      'file.share',
      'file.delete',
      'social.post',
      'payments.charge',
      'unknown.tool',
    ];

    it.each(allTools)('getCapability(%s) returns a valid Capability', (toolName) => {
      const result = getCapability(toolName);
      expect(VALID_CAPABILITIES).toContain(result);
    });
  });
});
