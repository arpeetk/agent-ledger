import { describe, it, expect } from 'vitest';
import { assessRisk } from '../src/risk.js';

describe('assessRisk', () => {
  describe('email capabilities', () => {
    it('returns low risk for internal email (all recipients in orgDomains)', () => {
      const result = assessRisk(
        'EMAIL_SEND',
        { to: ['alice@mycompany.com', 'bob@mycompany.com'] },
        ['mycompany.com'],
      );
      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
    });

    it('returns high risk with external_recipient for external email', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['alice@external.com'] }, ['mycompany.com']);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('external_recipient');
    });

    it('returns many_recipients when more than 5 recipients', () => {
      const recipients = [
        'a@mycompany.com',
        'b@mycompany.com',
        'c@mycompany.com',
        'd@mycompany.com',
        'e@mycompany.com',
        'f@mycompany.com',
      ];
      const result = assessRisk('EMAIL_SEND', { to: recipients }, ['mycompany.com']);
      expect(result.reasons).toContain('many_recipients');
    });

    it('does not flag many_recipients when exactly 5 recipients', () => {
      const recipients = [
        'a@mycompany.com',
        'b@mycompany.com',
        'c@mycompany.com',
        'd@mycompany.com',
        'e@mycompany.com',
      ];
      const result = assessRisk('EMAIL_SEND', { to: recipients }, ['mycompany.com']);
      expect(result.reasons).not.toContain('many_recipients');
    });

    it('handles case-insensitive domain matching', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['alice@MYCOMPANY.COM'] }, ['mycompany.com']);
      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
    });

    it('handles case-insensitive orgDomains', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['alice@mycompany.com'] }, ['MYCOMPANY.COM']);
      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
    });

    it('handles a single string to field (not array)', () => {
      const result = assessRisk('EMAIL_SEND', { to: 'alice@external.com' }, ['mycompany.com']);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('external_recipient');
    });

    it('applies same checks to EMAIL_DRAFT capability', () => {
      const result = assessRisk('EMAIL_DRAFT', { to: ['alice@external.com'] }, ['mycompany.com']);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('external_recipient');
    });

    it('treats all recipients as external when orgDomains is empty', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['alice@mycompany.com'] });
      expect(result.reasons).toContain('external_recipient');
    });
  });

  describe('calendar capability', () => {
    it('returns many_recipients for calendar with >10 attendees', () => {
      const attendees = Array.from({ length: 12 }, (_, i) => `user${i}@example.com`);
      const result = assessRisk('CALENDAR_WRITE', { attendees });
      expect(result.level).toBe('medium');
      expect(result.reasons).toContain('many_recipients');
    });

    it('returns low risk for calendar with <=10 attendees', () => {
      const attendees = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`);
      const result = assessRisk('CALENDAR_WRITE', { attendees });
      expect(result.reasons).not.toContain('many_recipients');
    });

    it('returns low risk for calendar with no attendees', () => {
      const result = assessRisk('CALENDAR_WRITE', {});
      expect(result.level).toBe('low');
    });
  });

  describe('URL detection', () => {
    it('flags contains_link when args contain a URL', () => {
      const result = assessRisk('READ_ONLY', { note: 'Check https://example.com for details' });
      expect(result.reasons).toContain('contains_link');
    });

    it('detects http URLs as well', () => {
      const result = assessRisk('READ_ONLY', { note: 'Visit http://example.com' });
      expect(result.reasons).toContain('contains_link');
    });

    it('does not flag args without URLs', () => {
      const result = assessRisk('READ_ONLY', { note: 'No links here' });
      expect(result.reasons).not.toContain('contains_link');
    });
  });

  describe('dangerous capabilities', () => {
    it('returns high risk with delete_action for DELETE capability', () => {
      const result = assessRisk('DELETE', {});
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('delete_action');
    });

    it('returns high risk with public_post for PUBLIC_POST capability', () => {
      const result = assessRisk('PUBLIC_POST', {});
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('public_post');
    });
  });

  describe('READ_ONLY capability', () => {
    it('returns low risk with no reasons', () => {
      const result = assessRisk('READ_ONLY', {});
      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
    });
  });

  describe('combined risks', () => {
    it('returns multiple reasons for external email with a link', () => {
      const result = assessRisk(
        'EMAIL_SEND',
        { to: ['alice@external.com'], body: 'See https://phishing.com' },
        ['mycompany.com'],
      );
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('external_recipient');
      expect(result.reasons).toContain('contains_link');
    });

    it('returns high when any high-level reason is present among multiple', () => {
      const recipients = Array.from({ length: 7 }, (_, i) => `user${i}@external.com`);
      const result = assessRisk('EMAIL_SEND', { to: recipients, body: 'https://example.com' }, [
        'mycompany.com',
      ]);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('external_recipient');
      expect(result.reasons).toContain('many_recipients');
      expect(result.reasons).toContain('contains_link');
    });
  });

  describe('empty args', () => {
    it('returns low risk for email with empty args', () => {
      const result = assessRisk('EMAIL_SEND', {}, ['mycompany.com']);
      expect(result.level).toBe('low');
      expect(result.reasons).toEqual([]);
    });
  });
});
