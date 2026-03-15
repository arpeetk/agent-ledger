import { describe, it, expect } from 'vitest';
import { assessRisk } from '../src/risk.js';

describe('assessRisk', () => {
  describe('external_recipient', () => {
    it('flags external recipients for EMAIL_SEND', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['user@external.com'] }, ['mycompany.com']);
      expect(result.reasons).toContain('external_recipient');
      expect(result.level).toBe('high');
    });

    it('does not flag internal recipients', () => {
      const result = assessRisk('EMAIL_SEND', { to: ['user@mycompany.com'] }, ['mycompany.com']);
      expect(result.reasons).not.toContain('external_recipient');
    });

    it('flags many recipients', () => {
      const to = Array(6)
        .fill(null)
        .map((_, i) => `user${i}@mycompany.com`);
      const result = assessRisk('EMAIL_SEND', { to }, ['mycompany.com']);
      expect(result.reasons).toContain('many_recipients');
    });
  });

  describe('contains_link', () => {
    it('flags URLs in args', () => {
      const result = assessRisk('EMAIL_SEND', { body: 'Check https://evil.com' }, [
        'mycompany.com',
      ]);
      expect(result.reasons).toContain('contains_link');
    });
  });

  describe('delete_action', () => {
    it('flags DELETE capability', () => {
      const result = assessRisk('DELETE', {});
      expect(result.reasons).toContain('delete_action');
      expect(result.level).toBe('high');
    });
  });

  describe('public_post', () => {
    it('flags PUBLIC_POST capability', () => {
      const result = assessRisk('PUBLIC_POST', {});
      expect(result.reasons).toContain('public_post');
      expect(result.level).toBe('high');
    });
  });

  describe('calendar', () => {
    it('flags many attendees', () => {
      const result = assessRisk('CALENDAR_WRITE', {
        attendees: Array(12).fill('user@mycompany.com'),
      });
      expect(result.reasons).toContain('many_recipients');
    });
  });

  describe('empty args', () => {
    it('returns low risk for READ_ONLY with no args', () => {
      const result = assessRisk('READ_ONLY', {});
      expect(result.level).toBe('low');
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('UNKNOWN capability', () => {
    it('returns high risk with unknown_tool for UNKNOWN capability', () => {
      const result = assessRisk('UNKNOWN', {});
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('unknown_tool');
    });

    it('returns unknown_tool even with orgDomains set', () => {
      const result = assessRisk('UNKNOWN', {}, ['mycompany.com']);
      expect(result.level).toBe('high');
      expect(result.reasons).toContain('unknown_tool');
    });
  });
});
