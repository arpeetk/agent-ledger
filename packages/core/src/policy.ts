import * as yaml from 'js-yaml';
import type {
  ArgPredicate,
  Capability,
  PolicyDecision,
  PolicyFile,
  PolicyResult,
  PolicyRule,
  RiskLevel,
} from './types.js';

export class PolicyValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Policy validation failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'PolicyValidationError';
  }
}

export class PolicyEngine {
  private policy: PolicyFile;

  constructor(yamlContent: string) {
    this.policy = yaml.load(yamlContent) as PolicyFile;
    this.validate();
  }

  get policyId(): string {
    return this.policy.policy_id;
  }

  get orgDomains(): string[] {
    return this.policy.params?.org_domains ?? [];
  }

  evaluate(
    capability: Capability,
    toolName: string,
    args: Record<string, unknown>,
    riskLevel?: RiskLevel,
  ): PolicyResult {
    const matchedRules: { id: string; decision: PolicyDecision }[] = [];
    let decision: PolicyDecision = this.policy.defaults.decision;
    let explanation = `Default policy: ${decision}`;

    for (const rule of this.policy.rules) {
      if (this.ruleMatches(rule, capability, toolName, args, riskLevel)) {
        matchedRules.push({ id: rule.id, decision: rule.then.decision });
        decision = rule.then.decision;
        explanation = rule.then.reason ?? `Matched rule: ${rule.id}`;
      }
    }

    const matchedRuleIds = matchedRules.map((r) => r.id);

    // Detect conflicting rule matches
    const warnings: string[] = [];
    if (matchedRules.length > 1) {
      const decisions = new Set(matchedRules.map((r) => r.decision));
      if (decisions.size > 1) {
        const conflicts = matchedRules.map((r) => `${r.id}(${r.decision})`).join(', ');
        warnings.push(
          `Conflicting rules matched: ${conflicts}. Last rule "${matchedRules[matchedRules.length - 1].id}" wins with decision "${decision}".`,
        );
      }
    }

    return {
      decision,
      matchedRuleIds,
      explanation,
      policyId: this.policy.policy_id,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  private ruleMatches(
    rule: PolicyRule,
    capability: Capability,
    toolName: string,
    args: Record<string, unknown>,
    riskLevel?: RiskLevel,
  ): boolean {
    const when = rule.when;

    // Check capability match
    if (when.capability && !when.capability.includes(capability)) {
      return false;
    }

    // Check tool match
    if (when.tool && !when.tool.includes(toolName)) {
      return false;
    }

    // Check risk_level match
    if (when.risk_level) {
      if (!riskLevel || !when.risk_level.includes(riskLevel)) {
        return false;
      }
    }

    // Check "all" predicates (all must match)
    if (when.all) {
      const allMatch = when.all.every((pred) => this.evaluatePredicate(pred, args));
      if (!allMatch) return false;
    }

    // Check "any" predicates (at least one must match)
    if (when.any) {
      const anyMatch = when.any.some((pred) => this.evaluatePredicate(pred, args));
      if (!anyMatch) return false;
    }

    return true;
  }

  private evaluatePredicate(pred: ArgPredicate, args: Record<string, unknown>): boolean {
    const { path, matches, not_matches, gt, lt, max_len } = pred.arg;

    const values = this.resolvePath(path, args);

    if (matches !== undefined) {
      let regex: RegExp;
      try {
        regex = new RegExp(matches);
      } catch {
        // Invalid regex pattern in policy — treat as non-matching
        return false;
      }
      return values.some((v) => {
        if (typeof v !== 'string') return false;
        if (v.length > 10_000) return false;
        return regex.test(v);
      });
    }

    if (not_matches !== undefined) {
      let regex: RegExp;
      try {
        regex = new RegExp(not_matches);
      } catch {
        return false;
      }
      // True if any value does NOT match the pattern
      return values.some((v) => {
        if (typeof v !== 'string') return false;
        if (v.length > 10_000) return false;
        return !regex.test(v);
      });
    }

    if (gt !== undefined) {
      return values.some((v) => typeof v === 'number' && v > gt);
    }

    if (lt !== undefined) {
      return values.some((v) => typeof v === 'number' && v < lt);
    }

    if (max_len !== undefined) {
      return values.some((v) => typeof v === 'string' && v.length > max_len);
    }

    return false;
  }

  /**
   * Resolve a JSONPath-like expression.
   * Supports: $.field, $.field[*], $.field.length
   */
  private resolvePath(path: string, args: Record<string, unknown>): unknown[] {
    // Remove leading "$."
    const stripped = path.startsWith('$.') ? path.slice(2) : path;

    // Handle .length suffix
    if (stripped.endsWith('.length')) {
      const fieldPath = stripped.slice(0, -7); // remove ".length"
      const val = this.getNestedValue(fieldPath.replace(/\[\*\]/g, ''), args);
      if (Array.isArray(val)) return [val.length];
      if (typeof val === 'string') return [val.length];
      return [];
    }

    // Handle [*] wildcard
    if (stripped.includes('[*]')) {
      const fieldPath = stripped.replace(/\[\*\]/g, '');
      const val = this.getNestedValue(fieldPath, args);
      if (Array.isArray(val)) return val;
      return [];
    }

    const val = this.getNestedValue(stripped, args);
    return val !== undefined ? [val] : [];
  }

  private getNestedValue(path: string, obj: Record<string, unknown>): unknown {
    const parts = path.split('.').filter(Boolean);
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private validate(): void {
    const issues: string[] = [];

    if (!this.policy.policy_id || typeof this.policy.policy_id !== 'string') {
      issues.push('Missing or invalid "policy_id"');
    }

    if (!this.policy.defaults?.decision) {
      issues.push('Missing "defaults.decision"');
    } else if (!['allow', 'deny', 'require_approval'].includes(this.policy.defaults.decision)) {
      issues.push(`Invalid defaults.decision: "${this.policy.defaults.decision}"`);
    }

    if (!Array.isArray(this.policy.rules)) {
      issues.push('Missing or invalid "rules" array');
    } else {
      const seenIds = new Set<string>();

      for (let i = 0; i < this.policy.rules.length; i++) {
        const rule = this.policy.rules[i];
        const prefix = `rules[${i}]`;

        if (!rule.id || typeof rule.id !== 'string') {
          issues.push(`${prefix}: missing or invalid "id"`);
        } else {
          if (seenIds.has(rule.id)) {
            issues.push(`${prefix}: duplicate rule id "${rule.id}"`);
          }
          seenIds.add(rule.id);
        }

        if (
          !rule.then?.decision ||
          !['allow', 'deny', 'require_approval'].includes(rule.then.decision)
        ) {
          issues.push(`${prefix}: missing or invalid "then.decision"`);
        }

        // Validate regex patterns in predicates
        const predicates = [...(rule.when?.all ?? []), ...(rule.when?.any ?? [])];
        for (const pred of predicates) {
          if (pred.arg?.matches) {
            try {
              new RegExp(pred.arg.matches);
            } catch {
              issues.push(`${prefix}: invalid regex in "matches": ${pred.arg.matches}`);
            }
          }
          if (pred.arg?.not_matches) {
            try {
              new RegExp(pred.arg.not_matches);
            } catch {
              issues.push(`${prefix}: invalid regex in "not_matches": ${pred.arg.not_matches}`);
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      throw new PolicyValidationError(issues);
    }
  }
}
