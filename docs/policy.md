# Policy Authoring Guide

Policies are YAML files that define what an agent is allowed to do. The PolicyEngine evaluates them top-down: the last matching rule wins (all rules are evaluated, the final match determines the decision).

## File Structure

```yaml
policy_id: org-email-policy
defaults:
  decision: deny
  reason: 'No matching rule; denied by default'
params:
  org_domains:
    - acme.com
    - acme.io
rules:
  - id: allow-internal-email
    when:
      capability: ['EMAIL_SEND', 'EMAIL_DRAFT']
      all:
        - arg:
            path: $.to[*]
            matches: "^.+@(acme\\.com|acme\\.io)$"
    then:
      decision: allow
      reason: 'Internal recipients only'
```

### Top-Level Fields

| Field       | Required | Description                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------------- |
| `policy_id` | yes      | Unique identifier for this policy.                                               |
| `defaults`  | yes      | The decision applied when no rule matches. Must include `decision` and `reason`. |
| `params`    | no       | Named values reusable across rules (e.g. `org_domains`).                         |
| `rules`     | yes      | Ordered list of rules. Last match wins.                                          |

## Rule Structure

Each rule has three parts: an `id`, a `when` block that defines match conditions, and a `then` block that defines the outcome.

```yaml
- id: require-approval-large-calendar-invite
  when:
    capability: ['CALENDAR_WRITE']
    any:
      - arg:
          path: $.attendees.length
          gt: 10
  then:
    decision: require_approval
    reason: 'Large meetings need approval'
```

### `when` Block

| Field        | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `capability` | Array of capability strings to match (e.g. `['EMAIL_SEND']`, `['CALENDAR_WRITE']`). |
| `tool`       | Array of tool name strings to match instead of capability (e.g. `['gmail.send']`).  |
| `all`        | List of arg predicates. All must pass.                                              |
| `any`        | List of arg predicates. At least one must pass.                                     |

You can combine `capability` (or `tool`) with `all` and/or `any` in the same rule. The capability/tool check is always evaluated first.

### Capabilities

Agent Ledger classifies each tool into a capability. These are the built-in capability strings:

| Capability       | Description                           | Tools                                                        |
| ---------------- | ------------------------------------- | ------------------------------------------------------------ |
| `READ_ONLY`      | Read-only operations                  | `gmail.get_draft`, `gmail.get_message`, `calendar.get_event` |
| `EMAIL_DRAFT`    | Draft an email without sending        | `gmail.create_draft`                                         |
| `EMAIL_SEND`     | Send an email                         | `gmail.send`                                                 |
| `CALENDAR_WRITE` | Create/modify calendar events         | `calendar.create_event`                                      |
| `FILE_SHARE`     | Share files externally                | `file.share`                                                 |
| `DELETE`         | Delete resources                      | `file.delete`                                                |
| `PUBLIC_POST`    | Post to public channels               | `social.post`                                                |
| `PAYMENTS`       | Financial transactions (deny-default) | `payments.charge`                                            |

Unknown tools default to `READ_ONLY`.

### `then` Block

| Field      | Description                                          |
| ---------- | ---------------------------------------------------- |
| `decision` | One of `allow`, `deny`, or `require_approval`.       |
| `reason`   | Human-readable explanation. Included in the receipt. |

## Arg Predicates

Arg predicates inspect the arguments of a tool call using a JSON path and an operator. Each predicate is wrapped in an `arg:` block:

```yaml
all:
  - arg:
      path: $.to[*]
      matches: "^.+@acme\\.com$"
```

| Field     | Description                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `path`    | JSON path into the call arguments. Supports `$.field`, `$.field[*]` (all elements), and `$.field.length` (array length). |
| `matches` | Regex the value must match. Applied per-element for array paths.                                                         |
| `gt`      | Value must be greater than this number.                                                                                  |
| `lt`      | Value must be less than this number.                                                                                     |
| `max_len` | String length must not exceed this number.                                                                               |

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
  reason: 'Unmatched email action'
params:
  org_domains:
    - acme.com
rules:
  - id: deny-large-attachments
    when:
      capability: ['EMAIL_SEND']
      any:
        - arg:
            path: $.attachments[*].size
            gt: 10485760
    then:
      decision: deny
      reason: 'Attachments must be under 10 MB'

  - id: allow-internal
    when:
      capability: ['EMAIL_SEND']
      all:
        - arg:
            path: $.to[*]
            matches: "^.+@acme\\.com$"
    then:
      decision: allow
      reason: 'Internal recipient'

  - id: approve-external
    when:
      capability: ['EMAIL_SEND']
    then:
      decision: require_approval
      reason: 'External recipients require approval'
```

### Calendar: deny events longer than 8 hours

```yaml
- id: deny-long-events
  when:
    capability: ['CALENDAR_WRITE']
    any:
      - arg:
          path: $.duration_minutes
          gt: 480
  then:
    decision: deny
    reason: 'Events longer than 8 hours are not allowed'
```

### Deny any tool call with a body exceeding 50,000 characters

```yaml
- id: deny-oversized-body
  when:
    all:
      - arg:
          path: $.body
          max_len: 50000
  then:
    decision: deny
    reason: 'Body exceeds maximum length'
```

## Evaluation Order

1. Rules are evaluated in list order.
2. The **last** rule whose `when` block matches the tool call determines the decision.
3. If no rule matches, `defaults.decision` is used.
4. A missing `defaults` block is treated as `deny`.
