# Architecture

Agent Ledger is a control plane that sits between an AI agent and the tools it calls. Every tool invocation passes through a gateway that classifies, evaluates policy, and produces a signed receipt before the result is returned to the agent.

## Components

| Component | Path | Stack | Role |
|---|---|---|---|
| Server | `apps/server` | Fastify | Tool Gateway, PolicyEngine, receipt signing, ledger storage |
| Web UI | `apps/web` | Next.js | Approval queue, receipt viewer, timeline |
| SDK | `packages/sdk` | TypeScript | Client library for integrating agents with Agent Ledger |
| Core | `packages/core` | TypeScript | Policy engine, risk classifier, signing, stable stringify |
| Connectors | `packages/connectors` | TypeScript | Mock tool adapters (Gmail, Calendar, Slack, GitHub, File Share) |
| Demo Agent | `apps/demo-agent` | TypeScript | Simple 4-step demo script |
| Claude Agent | `apps/claude-agent` | TypeScript | Rich multi-step AI assistant demo (board meeting prep) |

## Control Plane Flow

```
Agent (or SDK)
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  Tool Gateway (POST /tools/execute)                     │
│                                                         │
│  1. Classify capability  (EMAIL_SEND, CALENDAR_WRITE..) │
│  2. Assess risk          (external_recipient, etc.)     │
│  3. Compute idempotency key (sha256)                    │
│  4. Check for replay     (return cached if exists)      │
│  5. Create receipt record (BEFORE execution)            │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Policy Engine (YAML rules)                       │   │
│  │                                                    │   │
│  │  Input: capability + toolName + args               │   │
│  │  Output: allow | deny | require_approval           │   │
│  │          + matched rules + explanation              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  Decision routing:                                      │
│  ├─ allow → execute → verify → sign → 200              │
│  ├─ deny  → sign → 403                                 │
│  └─ require_approval → 202 (pause, wait for human)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Detailed Steps

1. **Intercept** — The Tool Gateway receives every tool call before execution
2. **Classify** — Map the tool name to a capability (e.g. `gmail.send` → `EMAIL_SEND`) and assess risk based on arguments (external recipients, many attendees, etc.)
3. **Evaluate Policy** — The PolicyEngine loads the YAML policy, matches rules against capability, tool name, and argument predicates, and returns a decision
4. **Approval (conditional)** — If `require_approval`, the call is written to a pending queue. The Web UI surfaces it for human review. Execution blocks until the reviewer approves or rejects
5. **Execute** — The call is dispatched to the connector with idempotency (sha256 of session + tool + args). Failed calls are retried with exponential backoff
6. **Verify** — For write operations, a read-after-write verification confirms the side effect took place
7. **Sign Receipt** — A receipt is constructed, canonicalized (stable key ordering), and signed with ed25519. The signed receipt is appended to the JSONL ledger

## Sequence Diagram

```
Agent            SDK              Gateway          PolicyEngine       Connector        Ledger
  │                │                 │                 │                 │               │
  │── execute() ──>│                 │                 │                 │               │
  │                │── POST ────────>│                 │                 │               │
  │                │                 │── classify ────>│                 │               │
  │                │                 │<── capability ──│                 │               │
  │                │                 │── evaluate ────>│                 │               │
  │                │                 │<── decision ────│                 │               │
  │                │                 │                 │                 │               │
  │                │          [if require_approval]    │                 │               │
  │                │<── 202 pending ─│                 │                 │               │
  │                │── poll ────────>│                 │                 │               │
  │                │                 │←── human decision (via Web UI) ──│               │
  │                │                 │                 │                 │               │
  │                │          [if allow / approved]    │                 │               │
  │                │                 │── execute ─────────────────────> │               │
  │                │                 │<── result ─────────────────────  │               │
  │                │                 │── verify ──────────────────────> │               │
  │                │                 │<── verified ────────────────────  │               │
  │                │                 │── sign (ed25519) ──────────────────────────────> │
  │                │                 │                                                  │
  │                │<── 200 result ──│                                                  │
  │<── result ─────│                 │                                                  │
```

## Key Design Decisions

- **Policy is server-side only.** The agent never sees or evaluates policy. This prevents prompt injection from bypassing controls.
- **Deny by default.** If no rule matches a tool call, the gateway defaults to `require_approval` (configurable). Dangerous capabilities like `PAYMENTS` and `PUBLIC_POST` are explicitly denied.
- **Receipts are append-only.** Once written to the ledger, a receipt is never modified or deleted. Ed25519 signatures make tampering detectable.
- **Idempotency is caller-transparent.** The gateway generates idempotency keys from `sha256(sessionId + toolName + stableStringify(args))`. Neither the agent nor the connector needs retry logic.
- **Redaction by default.** Sensitive fields (body, description, content) are hashed before storage. Only safe metadata (to, subject, title, times) is stored in receipts.
- **SDK is optional.** Agents can call the HTTP API directly or use the TypeScript SDK. The SDK adds convenience (polling, events, health checks) but is not required.

## Data Flow

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────┐
│  SQLite  │     │  JSONL   │     │  Server  │     │   Web UI     │
│ (Prisma) │←───│  Ledger  │←───│ (Fastify)│────>│  (Next.js)   │
│          │     │          │     │          │     │              │
│ Receipts │     │ Signed   │     │ REST API │     │ Timeline     │
│ Emails   │     │ receipts │     │          │     │ Approvals    │
│ Events   │     │          │     │          │     │ Receipt View │
│ Slack    │     └──────────┘     └──────────┘     └──────────────┘
│ Issues   │
│ Shares   │
└──────────┘
```

## Package Dependencies

```
@agent-ledger/sdk
  └── @agent-ledger/core (types only)

@agent-ledger/server
  ├── @agent-ledger/core
  ├── @agent-ledger/connectors
  └── @prisma/client

@agent-ledger/connectors
  ├── @agent-ledger/core
  └── @prisma/client

@agent-ledger/claude-agent
  └── @agent-ledger/sdk
```
