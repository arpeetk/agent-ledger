import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy.js';

const POLICY_YAML = `
policy_id: test-v1
defaults:
  decision: require_approval
params:
  org_domains: ["mycompany.com"]
rules:
  - id: allow_reads
    when:
      capability: ["READ_ONLY"]
    then:
      decision: allow
      reason: "Read-only operations are auto-allowed."
  - id: allow_internal_email
    when:
      capability: ["EMAIL_SEND", "EMAIL_DRAFT"]
      all:
        - arg:
            path: "$.to[*]"
            matches: ".*@mycompany\\\\.com$"
    then:
      decision: allow
      reason: "Internal emails are auto-allowed."
  - id: external_email_needs_approval
    when:
      capability: ["EMAIL_SEND", "EMAIL_DRAFT"]
      any:
        - arg:
            path: "$.to[*]"
            matches: ".*@((?!mycompany\\\\.com$).)+"
    then:
      decision: require_approval
      reason: "External recipients require approval."
  - id: large_calendar_event
    when:
      capability: ["CALENDAR_WRITE"]
      any:
        - arg:
            path: "$.attendees.length"
            gt: 10
    then:
      decision: require_approval
      reason: "Calendar events with many attendees require approval."
  - id: deny_public_post
    when:
      capability: ["PUBLIC_POST"]
    then:
      decision: deny
      reason: "Public posting is not allowed."
`;

describe('PolicyEngine', () => {
  const engine = new PolicyEngine(POLICY_YAML);

  it('allows read-only operations', () => {
    const result = engine.evaluate('READ_ONLY', 'gmail.get_message', {});
    expect(result.decision).toBe('allow');
    expect(result.matchedRuleIds).toContain('allow_reads');
  });

  it('allows internal emails', () => {
    const result = engine.evaluate('EMAIL_SEND', 'gmail.send', {
      to: ['alice@mycompany.com', 'bob@mycompany.com'],
    });
    expect(result.decision).toBe('allow');
    expect(result.matchedRuleIds).toContain('allow_internal_email');
  });

  it('requires approval for external emails', () => {
    const result = engine.evaluate('EMAIL_SEND', 'gmail.send', {
      to: ['partner@external.com'],
    });
    expect(result.decision).toBe('require_approval');
    expect(result.matchedRuleIds).toContain('external_email_needs_approval');
  });

  it('requires approval for large calendar events', () => {
    const result = engine.evaluate('CALENDAR_WRITE', 'calendar.create_event', {
      attendees: Array(12).fill('user@mycompany.com'),
    });
    expect(result.decision).toBe('require_approval');
    expect(result.matchedRuleIds).toContain('large_calendar_event');
  });

  it('denies public posts', () => {
    const result = engine.evaluate('PUBLIC_POST', 'social.post', {});
    expect(result.decision).toBe('deny');
    expect(result.matchedRuleIds).toContain('deny_public_post');
  });

  it('falls back to default decision for unknown capabilities', () => {
    const result = engine.evaluate('FILE_SHARE', 'file.share', {});
    expect(result.decision).toBe('require_approval');
    expect(result.matchedRuleIds).toHaveLength(0);
  });

  it('returns policyId', () => {
    const result = engine.evaluate('READ_ONLY', 'test', {});
    expect(result.policyId).toBe('test-v1');
  });
});
