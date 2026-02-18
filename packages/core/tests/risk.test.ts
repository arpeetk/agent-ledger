import { describe, it, expect } from 'vitest';
import { assessRisk } from '../src/risk.js';

describe('assessRisk', () => {
  const orgDomains = ['mycompany.com'];

  it('returns low risk for internal email', () => {
    const result = assessRisk('EMAIL_SEND', { to: ['alice@mycompany.com'] }, orgDomains);
    expect(result.level).toBe('low');
    expect(result.reasons).toHaveLength(0);
  });

  it('flags external recipients as high risk', () => {
    const result = assessRisk('EMAIL_SEND', { to: ['external@other.com'] }, orgDomains);
    expect(result.level).toBe('high');
    expect(result.reasons).toContain('external_recipient');
  });

  it('flags many recipients', () => {
    const result = assessRisk(
      'EMAIL_SEND',
      { to: ['a@mycompany.com', 'b@mycompany.com', 'c@mycompany.com', 'd@mycompany.com', 'e@mycompany.com', 'f@mycompany.com'] },
      orgDomains,
    );
    expect(result.reasons).toContain('many_recipients');
  });

  it('flags calendar events with many attendees', () => {
    const result = assessRisk('CALENDAR_WRITE', { attendees: Array(12).fill('a@mycompany.com') }, orgDomains);
    expect(result.reasons).toContain('many_recipients');
  });

  it('detects links in args', () => {
    const result = assessRisk('EMAIL_SEND', { to: ['a@mycompany.com'], body: 'Check https://evil.com' }, orgDomains);
    expect(result.reasons).toContain('contains_link');
  });

  it('flags delete actions', () => {
    const result = assessRisk('DELETE', { path: '/important/file' }, orgDomains);
    expect(result.level).toBe('high');
    expect(result.reasons).toContain('delete_action');
  });

  it('flags public posts', () => {
    const result = assessRisk('PUBLIC_POST', { content: 'Hello world' }, orgDomains);
    expect(result.level).toBe('high');
    expect(result.reasons).toContain('public_post');
  });

  it('returns low risk for read-only', () => {
    const result = assessRisk('READ_ONLY', {}, orgDomains);
    expect(result.level).toBe('low');
    expect(result.reasons).toHaveLength(0);
  });
});
