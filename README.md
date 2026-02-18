# Agent Ledger

**Policy-gated tool execution for AI agents — with approvals, verification, and signed action receipts.**

> *Terraform plan/apply + OPA-style policy + Stripe receipts — for agent actions.*

---

## The Problem

Your AI agent has access to email, calendar, Slack, GitHub, file sharing, and payments. It's autonomous. It's fast. And it just sent your company's financial projections to the wrong person.

**How do you know what it did? Who approved it? Can you prove it?**

Agent Ledger is a control plane that sits between any AI agent and its tools. Every tool call goes through policy evaluation, optional human approval, execution with verification, and produces a **cryptographically signed, tamper-evident receipt** you can audit months later.

---

## See It In Action

Here's a Claude AI assistant preparing a quarterly board meeting. Watch what happens when it tries to use different tools:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    Claude AI Research Assistant                              │
│    Powered by Agent Ledger — policy-gated tool execution     │
│                                                             │
└─────────────────────────────────────────────────────────────┘

  ━━━ Step 1/8: Post team update on Slack ━━━

  [thinking] I should let the team know we're preparing for the board meeting.
  [action]   slack.send_message — Post board meeting prep update to #general
   ALLOWED  Receipt: cly8x2k...

  ━━━ Step 2/8: Email meeting notes to the team ━━━

  [thinking] All internal recipients — this should be auto-allowed.
  [action]   gmail.send — Send board meeting agenda to leadership team
   ALLOWED  Receipt: cly8x3m...

  ━━━ Step 3/8: Draft investor update email ━━━

  [thinking] External recipients — this will likely need human approval.
  [action]   gmail.create_draft — Draft quarterly update for external investors
   PENDING  Awaiting human approval...
             Approve at: http://localhost:3000/approvals
   APPROVED  Human approved — executed. Receipt: cly8x4n...

  ━━━ Step 7/8: Post earnings preview on social media ━━━

  [thinking] Let me try posting a preview...
  [action]   social.post — Post Q1 earnings preview on Twitter
   DENIED   Public posting is not allowed.

  ━━━ Step 8/8: Process catering payment ━━━

  [action]   payments.charge — Process catering payment
   DENIED   Payment operations are denied by default.

  ┌─────────────────────────────────────────────────────────────┐
  │  Session Summary                                           │
  │                                                             │
  │  Total tool calls:  8                                       │
  │  Auto-allowed:      4                                       │
  │  Needed approval:   2                                       │
  │  Denied by policy:  2                                       │
  │                                                             │
  │  Every action recorded as a signed, tamper-evident receipt.  │
  └─────────────────────────────────────────────────────────────┘
```

The agent made 8 tool calls. Four were auto-allowed (internal email, Slack, GitHub). Two required human approval (external email, large meeting). Two were denied by policy (social media, payments). **Every single action produced a signed receipt.**

---

## How It Works

```
                         ┌──────────────┐
                         │   AI Agent   │
                         │ (Claude/GPT) │
                         └──────┬───────┘
                                │
                         tool call request
                                │
                    ┌───────────▼───────────┐
                    │    Agent Ledger SDK    │
                    │  ledger.execute(...)   │
                    └───────────┬───────────┘
                                │
        ┌───────────────────────▼───────────────────────┐
        │              Agent Ledger Server               │
        │                                                │
        │  1. Classify capability (EMAIL_SEND, DELETE..) │
        │  2. Assess risk (external_recipient, etc.)     │
        │  3. Evaluate YAML policy                       │
        │     ┌─────────┬──────────┬──────────────┐      │
        │     │ ALLOW   │  DENY   │ REQUIRE_APPR │      │
        │     └────┬────┴────┬────┴───────┬───────┘      │
        │          │         │            │              │
        │     execute    return       pause &            │
        │     + verify   denied      wait for            │
        │                            human               │
        │                                                │
        │  4. Sign receipt (ed25519)                      │
        │  5. Append to immutable JSONL ledger            │
        └────────────────────┬──────────────────────────┘
                             │
                      signed receipt
                             │
                    ┌────────▼────────┐
                    │    Web UI       │
                    │  Timeline /     │
                    │  Approvals /    │
                    │  Receipt View   │
                    └─────────────────┘
```

---

## SDK Usage (5 lines to integrate)

```typescript
import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  session: { sessionId: 'sess-1', agentId: 'my-agent', userId: 'sarah' },
  onPendingApproval: (e) => console.log(`Approve: ${e.approvalUrl}`),
  onDenied: (e) => console.log(`Blocked: ${e.reason}`),
});

// Every tool call is now policy-gated, audited, and signed
const result = await ledger.execute('gmail.send', {
  to: ['alice@company.com'],
  subject: 'Q1 Report',
  body: 'Please find the quarterly report attached.',
}, { intent: 'Send quarterly report to team lead' });

// result.status: 'executed' | 'pending_approval' | 'denied'
// result.receiptId: signed, tamper-evident receipt ID
```

### Wrapping an Existing Agent

```typescript
import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  session: { sessionId: crypto.randomUUID(), agentId: 'claude-assistant' },
  onPendingApproval: ({ approvalUrl }) => {
    console.log(`Human approval needed: ${approvalUrl}`);
  },
});

// Before: agent calls tools directly
// await gmail.send({ to, subject, body });

// After: agent calls tools through Agent Ledger
const result = await ledger.execute('gmail.send', { to, subject, body }, {
  intent: 'Send weekly status update to the team',
});

if (result.status === 'executed') {
  console.log('Email sent. Receipt:', result.receiptId);
} else if (result.status === 'pending_approval') {
  console.log('Waiting for human approval...');
} else {
  console.log('Blocked by policy:', result.error);
}
```

### Verify Any Receipt

```typescript
const verification = await ledger.verifyReceipt('rcpt_abc123');
console.log(verification.valid); // true — cryptographic proof of integrity
```

### Programmatic Approval (for CI/automation)

```typescript
await ledger.approve('rcpt_abc123', 'ci-bot', 'Auto-approved by deployment pipeline');
```

---

## Policy (YAML)

Policies are human-readable YAML files. No code changes needed to update rules:

```yaml
policy_id: default-v1
defaults:
  decision: require_approval

params:
  org_domains: ["mycompany.com"]

rules:
  - id: allow_internal_email
    when:
      capability: ["EMAIL_SEND", "EMAIL_DRAFT"]
      all:
        - arg:
            path: "$.to[*]"
            matches: ".*@mycompany\\.com$"
    then:
      decision: allow
      reason: "Internal emails are auto-allowed."

  - id: external_email_needs_approval
    when:
      capability: ["EMAIL_SEND", "EMAIL_DRAFT"]
      any:
        - arg:
            path: "$.to[*]"
            matches: ".*@((?!mycompany\\.com$).)+"
    then:
      decision: require_approval
      reason: "External recipients require human approval."

  - id: deny_public_post
    when:
      capability: ["PUBLIC_POST"]
    then:
      decision: deny
      reason: "No public posting."

  - id: deny_payments
    when:
      capability: ["PAYMENTS"]
    then:
      decision: deny
      reason: "Payment operations are denied by default."
```

See [`docs/policy.md`](docs/policy.md) for full syntax, predicates (regex, numeric comparisons, array length), and more examples.

---

## Quickstart

### Prerequisites

- Node.js 20+
- npm 9+

### 1. Install & setup

```bash
git clone https://github.com/arpeetk/agent-ledger.git
cd agent-ledger
npm install
npm run db:push
```

### 2. Start the server + UI

```bash
npm run dev
```

- **Server**: http://localhost:3001
- **Web UI**: http://localhost:3000

### 3. Run the Claude agent demo

In another terminal:

```bash
npm run demo:claude
```

Watch as the AI assistant:
- Sends internal Slack messages (auto-allowed)
- Emails the team (auto-allowed)
- Drafts investor emails (paused for approval)
- Creates GitHub issues (auto-allowed)
- Schedules a 15-person board meeting (paused for approval)
- Shares files with external users (paused for approval)
- Gets blocked from social media posting (denied)
- Gets blocked from processing payments (denied)

Approve pending actions in the UI: http://localhost:3000/approvals

### 4. Explore receipts

Every action produces a signed receipt viewable at http://localhost:3000. Each receipt includes:
- Policy decision + matched rule IDs
- Risk classification + reasons
- Approval metadata (who/when/comment)
- Execution metadata (idempotency key, latency, retries)
- Cryptographic signature (ed25519) — verifiable in the UI

---

## What It Does (for every tool call)

| Step | What Happens | Example |
|------|-------------|---------|
| **1. Intercept** | Capture the tool call | `gmail.send({ to: [...], subject, body })` |
| **2. Classify** | Map tool → capability | `gmail.send` → `EMAIL_SEND` |
| **3. Assess Risk** | Detect risk signals | `external_recipient`, `many_recipients` |
| **4. Evaluate Policy** | YAML rules → decision | `require_approval` (external email) |
| **5. Gate** | Allow / Deny / Pause | Pause and wait for human approval |
| **6. Execute** | Run with idempotency + retries | Send the email, get artifact ID |
| **7. Verify** | Read-after-write check | Fetch sent email, confirm it exists |
| **8. Sign** | ed25519 sign the receipt | Tamper-evident, auditable forever |

---

## Action Receipts (Stripe-like, signed)

Every tool call produces a receipt like this:

```json
{
  "receipt_version": "0.1",
  "receipt_id": "cly8x2k000...",
  "timestamp": "2025-03-14T10:23:45.123Z",
  "session": {
    "sessionId": "claude-session-1710...",
    "agentId": "claude-research-assistant",
    "userId": "sarah@mycompany.com"
  },
  "request": {
    "tool_name": "gmail.create_draft",
    "capability": "EMAIL_DRAFT",
    "risk": { "level": "high", "reasons": ["external_recipient"] },
    "intent": "Draft quarterly investor update",
    "args_hash": "a3f8c2..."
  },
  "policy": {
    "decision": "require_approval",
    "matched_rules": ["external_email_needs_approval"],
    "explanation": "External recipients require human approval."
  },
  "approval": {
    "status": "approved",
    "actor": "sarah@mycompany.com",
    "comment": "Reviewed content, approved for sending",
    "timestamp": "2025-03-14T10:24:12.456Z"
  },
  "execution": {
    "status": "success",
    "attempts": 1,
    "idempotency_key": "e7b2a1...",
    "latency_ms": 42
  },
  "verification": {
    "method": "read_after_write",
    "status": "verified"
  },
  "signature": {
    "alg": "ed25519",
    "public_key_id": "a1b2c3d4...",
    "signature_b64": "kW9f3x..."
  }
}
```

Receipts are stored in:
- **SQLite** (queryable via API)
- **Append-only JSONL ledger** at `apps/server/receipts/ledger.jsonl`

See [`docs/receipts.md`](docs/receipts.md) for the full schema and signing/verification details.

---

## Supported Tools (Mock Connectors)

| Tool | Capability | Default Policy |
|------|-----------|----------------|
| `gmail.send` | EMAIL_SEND | Allow internal, approval for external |
| `gmail.create_draft` | EMAIL_DRAFT | Allow internal, approval for external |
| `calendar.create_event` | CALENDAR_WRITE | Approval if >10 attendees |
| `slack.send_message` | EMAIL_SEND | Allow internal channels |
| `github.create_issue` | CALENDAR_WRITE | Allow |
| `file.share` | FILE_SHARE | Allow internal, approval for external |
| `social.post` | PUBLIC_POST | **Deny** |
| `payments.charge` | PAYMENTS | **Deny** |

All connectors are mocked with SQLite persistence. The architecture is designed for drop-in replacement with real APIs.

---

## Project Layout

```
apps/
  server/          Fastify API — tool gateway, receipts, approval workflow
  web/             Next.js UI — timeline, approvals inbox, receipt viewer
  demo-agent/      Simple 4-step demo script
  claude-agent/    Rich multi-step Claude AI assistant demo (board meeting prep)
packages/
  core/            Policy engine, risk classifier, stable stringify, ed25519 signing
  sdk/             TypeScript SDK — AgentLedger client with approval polling + events
  connectors/      Mock tool connectors (Gmail, Calendar, Slack, GitHub, File Share)
policies/          YAML policy files
examples/          Integration patterns (Anthropic, OpenAI, programmatic approval)
docs/
  architecture.md  System architecture and data flow
  sdk.md           SDK reference and integration guide
  receipts.md      Receipt schema, signing, verification
  policy.md        Policy authoring guide
  threat-model.md  Security threat analysis
```

---

## Security & Threat Model

Agent Ledger is designed to mitigate real-world agent risks:

| Threat | Mitigation |
|--------|-----------|
| **Prompt injection** causing unauthorized tool use | Policy evaluation is separate from agent reasoning |
| **Confused deputy** (agent has broad access) | Capability classification + deny-by-default |
| **Data exfiltration** via outbound tools | External recipient detection + approval gates |
| **Irreversible actions** without audit trail | Every action produces a signed, verifiable receipt |
| **Receipt tampering** | ed25519 signatures + append-only JSONL ledger |

See [`docs/threat-model.md`](docs/threat-model.md) for the full analysis.

---

## More Examples

The `examples/` directory contains integration patterns for popular AI frameworks:

| Example | Description |
|---------|-------------|
| [`examples/anthropic-agent.ts`](examples/anthropic-agent.ts) | Integrate with Anthropic Claude's tool_use |
| [`examples/openai-agent.ts`](examples/openai-agent.ts) | Integrate with OpenAI GPT function calling |
| [`examples/programmatic-approval.ts`](examples/programmatic-approval.ts) | Build an automated approval bot |

See [`docs/sdk.md`](docs/sdk.md) for the full SDK reference.

---

## Roadmap

- [ ] MCP gateway adapter (intercept any MCP server)
- [ ] OpenTelemetry export (GenAI semantic conventions)
- [ ] Real connectors (Gmail API, Google Calendar, Slack, GitHub) behind feature flags
- [ ] Pluggable auth (JWT/OIDC) + multi-tenant support
- [ ] Webhook notifications for pending approvals
- [ ] Receipt export (CSV, compliance formats)

---

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
