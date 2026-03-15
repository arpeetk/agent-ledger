import { describe, it, expect } from 'vitest';
import { PolicyEngine, PolicyValidationError } from '../src/policy.js';

const POLICY_YAML = `
policy_id: test-v1
defaults:
  decision: require_approval
params:
  org_domains: ["mycompany.com"]
rules:
  - id: deny_unknown
    when:
      capability: ["UNKNOWN"]
    then:
      decision: deny
      reason: "Unknown tools are denied."
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
            not_matches: ".*@mycompany\\\\.com$"
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
  - id: high_risk_approval
    when:
      risk_level: ["high"]
    then:
      decision: require_approval
      reason: "High-risk actions require approval."
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

  it('requires approval for external emails via not_matches', () => {
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

  it('falls back to default decision for unmatched capabilities', () => {
    const result = engine.evaluate('FILE_SHARE', 'file.share', {});
    expect(result.decision).toBe('require_approval');
    expect(result.matchedRuleIds).toHaveLength(0);
  });

  it('returns policyId', () => {
    const result = engine.evaluate('READ_ONLY', 'test', {});
    expect(result.policyId).toBe('test-v1');
  });

  it('denies UNKNOWN capability', () => {
    const result = engine.evaluate('UNKNOWN', 'shell.exec', {});
    expect(result.decision).toBe('deny');
    expect(result.matchedRuleIds).toContain('deny_unknown');
  });

  describe('risk_level predicate', () => {
    it('matches when risk_level is provided and matches', () => {
      const result = engine.evaluate('EMAIL_SEND', 'gmail.send', { to: ['a@ext.com'] }, 'high');
      expect(result.matchedRuleIds).toContain('high_risk_approval');
    });

    it('does not match risk_level rule when level does not match', () => {
      const result = engine.evaluate('EMAIL_SEND', 'gmail.send', { to: ['a@ext.com'] }, 'low');
      expect(result.matchedRuleIds).not.toContain('high_risk_approval');
    });

    it('does not match risk_level rule when riskLevel is not provided', () => {
      const result = engine.evaluate('FILE_SHARE', 'file.share', {});
      expect(result.matchedRuleIds).not.toContain('high_risk_approval');
    });
  });

  describe('not_matches predicate', () => {
    it('matches when value does NOT match pattern', () => {
      const result = engine.evaluate('EMAIL_SEND', 'gmail.send', {
        to: ['user@external.com'],
      });
      expect(result.matchedRuleIds).toContain('external_email_needs_approval');
    });

    it('does not match when all values match the pattern', () => {
      const result = engine.evaluate('EMAIL_SEND', 'gmail.send', {
        to: ['user@mycompany.com'],
      });
      expect(result.matchedRuleIds).not.toContain('external_email_needs_approval');
    });

    it('matches when at least one value does not match', () => {
      const result = engine.evaluate('EMAIL_SEND', 'gmail.send', {
        to: ['user@mycompany.com', 'user@external.com'],
      });
      expect(result.matchedRuleIds).toContain('external_email_needs_approval');
    });
  });

  describe('rule conflict warnings', () => {
    it('populates warnings when rules have conflicting decisions', () => {
      // PUBLIC_POST with high risk: deny_unknown won't match, but high_risk_approval (require_approval)
      // and deny_public_post (deny) both match — different decisions
      const result = engine.evaluate('PUBLIC_POST', 'social.post', {}, 'high');
      expect(result.matchedRuleIds).toContain('high_risk_approval');
      expect(result.matchedRuleIds).toContain('deny_public_post');
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain('Conflicting');
    });

    it('does not add warnings when all matched rules agree', () => {
      const result = engine.evaluate('READ_ONLY', 'gmail.get_message', {});
      expect(result.warnings).toBeUndefined();
    });
  });
});

describe('PolicyValidationError', () => {
  it('throws on missing policy_id', () => {
    const yaml = `
defaults:
  decision: allow
rules: []
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on missing defaults.decision', () => {
    const yaml = `
policy_id: test
rules: []
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on invalid defaults.decision', () => {
    const yaml = `
policy_id: test
defaults:
  decision: maybe
rules: []
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on missing rules array', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on duplicate rule IDs', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - id: rule1
    when:
      capability: ["READ_ONLY"]
    then:
      decision: allow
  - id: rule1
    when:
      capability: ["DELETE"]
    then:
      decision: deny
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
    try {
      new PolicyEngine(yaml);
    } catch (e) {
      expect((e as PolicyValidationError).issues).toContain('rules[1]: duplicate rule id "rule1"');
    }
  });

  it('throws on invalid regex in matches', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - id: bad_regex
    when:
      any:
        - arg:
            path: "$.to[*]"
            matches: "[invalid"
    then:
      decision: deny
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on invalid regex in not_matches', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - id: bad_not_regex
    when:
      any:
        - arg:
            path: "$.to[*]"
            not_matches: "[invalid"
    then:
      decision: deny
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on missing rule id', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - when:
      capability: ["READ_ONLY"]
    then:
      decision: allow
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('throws on missing then.decision', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - id: no_decision
    when:
      capability: ["READ_ONLY"]
    then:
      reason: "oops"
`;
    expect(() => new PolicyEngine(yaml)).toThrow(PolicyValidationError);
  });

  it('collects all issues in a single error', () => {
    const yaml = `
policy_id: test
defaults:
  decision: allow
rules:
  - id: dup
    when:
      capability: ["READ_ONLY"]
    then:
      decision: allow
  - id: dup
    when:
      any:
        - arg:
            path: "$.x"
            matches: "[bad"
    then:
      decision: deny
`;
    try {
      new PolicyEngine(yaml);
    } catch (e) {
      const err = e as PolicyValidationError;
      expect(err.issues.length).toBeGreaterThanOrEqual(2);
      expect(err.issues.some((i) => i.includes('duplicate'))).toBe(true);
      expect(err.issues.some((i) => i.includes('invalid regex'))).toBe(true);
    }
  });
});
