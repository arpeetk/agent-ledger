# Policy Authoring Guide

Policies are YAML files that define what an agent is allowed to do. The PolicyEngine evaluates them top-down: the first matching rule wins.

## File Structure

```yaml
policy_id: org-email-policy
defaults:
  decision: deny
  reason: "No matching rule; denied by default"
params:
  org_domains:
    - acme.com
    - acme.io
rules:
  - id: allow-internal-email
    when:
      capability: email:send
      all:
        - path: $.to[*]
          matches: "^.+@(acme\\.com|acme\\.io)$"
    then:
      decision: allow
      reason: "Internal recipients only"
```

### Top-Level Fields

| Field | Required | Description |
|---|---|---|
| `policy_id` | yes | Unique identifier for this policy. |
| `defaults` | yes | The decision applied when no rule matches. Must include `decision` and `reason`. |
| `params` | no | Named values reusable across rules (e.g. `org_domains`). |
| `rules` | yes | Ordered list of rules. First match wins. |

## Rule Structure

Each rule has three parts: an `id`, a `when` block that defines match conditions, and a `then` block that defines the outcome.

```yaml
- id: require-approval-large-calendar-invite
  when:
    capability: calendar:create
    any:
      - path: $.attendees.length
        gt: 10
  then:
    decision: require_approval
    reason: "Large meetings need approval"
```

### `when` Block

| Field | Description |
|---|---|
| `capability` | The classified capability string to match (e.g. `email:send`, `calendar:create`). |
| `tool` | Match against the raw tool name instead of the classified capability. |
| `all` | List of arg predicates. All must pass. |
| `any` | List of arg predicates. At least one must pass. |

You can combine `capability` (or `tool`) with `all` and/or `any` in the same rule. The capability/tool check is always evaluated first.

### `then` Block

| Field | Description |
|---|---|
| `decision` | One of `allow`, `deny`, or `require_approval`. |
| `reason` | Human-readable explanation. Included in the receipt. |

## Arg Predicates

Arg predicates inspect the arguments of a tool call using a JSON path and an operator.

| Field | Description |
|---|---|
| `path` | JSON path into the call arguments. Supports `$.field`, `$.field[*]` (all elements), and `$.field.length` (array length). |
| `matches` | Regex the value must match. Applied per-element for array paths. |
| `gt` | Value must be greater than this number. |
| `lt` | Value must be less than this number. |
| `max_len` | String length must not exceed this number. |

When `path` targets an array with `[*]`, the predicate is applied to every element. For `all` blocks, every element must satisfy the predicate. For `any` blocks, at least one element must satisfy it.

## The `org_domains` Param

A common pattern is restricting outbound communication to internal domains. Define `org_domains` once in `params` and reference the generated regex in rules:

```yaml
params:
  org_domains:
    - acme.com
    - acme.io
```

The PolicyEngine expands `org_domains` into a regex pattern that rules can reference. This avoids duplicating domain lists across rules.

## Examples

### Allow internal email, require approval for external, deny attachments over 10 MB

```yaml
policy_id: email-policy
defaults:
  decision: deny
  reason: "Unmatched email action"
params:
  org_domains:
    - acme.com
rules:
  - id: deny-large-attachments
    when:
      capability: email:send
      any:
        - path: $.attachments[*].size
          gt: 10485760
    then:
      decision: deny
      reason: "Attachments must be under 10 MB"

  - id: allow-internal
    when:
      capability: email:send
      all:
        - path: $.to[*]
          matches: "^.+@acme\\.com$"
    then:
      decision: allow
      reason: "Internal recipient"

  - id: approve-external
    when:
      capability: email:send
    then:
      decision: require_approval
      reason: "External recipients require approval"
```

### Calendar: deny events longer than 8 hours

```yaml
- id: deny-long-events
  when:
    capability: calendar:create
    any:
      - path: $.duration_minutes
        gt: 480
  then:
    decision: deny
    reason: "Events longer than 8 hours are not allowed"
```

### Deny any tool call with a body exceeding 50,000 characters

```yaml
- id: deny-oversized-body
  when:
    all:
      - path: $.body
        max_len: 50000
  then:
    decision: deny
    reason: "Body exceeds maximum length"
```

## Evaluation Order

1. Rules are evaluated in list order.
2. The first rule whose `when` block matches the tool call determines the decision.
3. If no rule matches, `defaults.decision` is used.
4. A missing `defaults` block is treated as `deny`.
