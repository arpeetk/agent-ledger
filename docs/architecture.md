# Architecture

agent-ledger is a control plane that sits between an AI agent and the tools it calls. Every tool invocation passes through a gateway that classifies, evaluates policy, and produces a signed receipt before the result is returned to the agent.

## Components

| Component  | Path                  | Stack      | Role                                                        |
| ---------- | --------------------- | ---------- | ----------------------------------------------------------- |
| Server     | `apps/server`         | Fastify    | Tool Gateway, PolicyEngine, receipt signing, ledger storage |
| Web UI     | `apps/web`            | Next.js    | Approval queue, receipt viewer, policy editor               |
| Core       | `packages/core`       | TypeScript | Shared types, policy evaluation logic, receipt schema       |
| Connectors | `packages/connectors` | TypeScript | Tool adapters (email, calendar, file system, etc.)          |

## Control Plane Flow

1. **Intercept** -- The Tool Gateway receives every tool call before execution.
2. **Classify** -- The call is tagged with a capability (e.g. `email:send`, `calendar:create`) and a risk tier derived from the tool and its arguments.
3. **Evaluate Policy** -- The PolicyEngine loads the applicable YAML policy, matches rules against the classified call, and returns one of three decisions: `allow`, `deny`, or `require_approval`.
4. **Approval (conditional)** -- If the decision is `require_approval`, the call is written to a pending queue. The Web UI surfaces it for human review. Execution blocks until the reviewer approves or rejects.
5. **Execute** -- The call is dispatched to the appropriate connector. Execution uses an idempotency key derived from the call content so retries are safe. Failed calls are retried with exponential backoff up to a configurable limit.
6. **Verify** -- For Tier-1 actions (writes, sends, deletes), a read-after-write verification step confirms the side effect took place. The verification result is attached to the receipt.
7. **Sign Receipt** -- A receipt object is constructed, canonicalized, and signed with ed25519. The signed receipt is appended to the ledger and returned alongside the tool result.

## Sequence Diagram

```
Agent            Tool Gateway        PolicyEngine       Connector        Ledger
  |                   |                   |                 |               |
  |-- tool_call ----->|                   |                 |               |
  |                   |-- classify ------>|                 |               |
  |                   |<-- capability ----|                 |               |
  |                   |-- evaluate ------>|                 |               |
  |                   |<-- decision ------|                 |               |
  |                   |                   |                 |               |
  |            [if require_approval]      |                 |               |
  |                   |--------- hold pending ------------>|               |
  |                   |<-------- human decision -----------|               |
  |                   |                   |                 |               |
  |            [if allow / approved]      |                 |               |
  |                   |-- execute (idempotency key) ------->|               |
  |                   |<-- result --------------------------|               |
  |                   |                   |                 |               |
  |                   |-- verify (read-after-write) ------->|               |
  |                   |<-- verification --------------------|               |
  |                   |                   |                 |               |
  |                   |-- sign receipt (ed25519) ---------------------->|   |
  |                   |                                                 |   |
  |<-- result + receipt --|                                             |   |
  |                       |                                             |   |
```

## Key Design Decisions

- **Policy is server-side only.** The agent never sees or evaluates policy. This prevents prompt injection from bypassing controls.
- **Deny by default.** If no rule matches a tool call, the gateway denies it. Policies must explicitly allow capabilities.
- **Receipts are append-only.** Once written to the ledger, a receipt is never modified or deleted. Signatures make tampering detectable.
- **Idempotency is caller-transparent.** The gateway generates idempotency keys from call content. Neither the agent nor the connector needs to be aware of retry logic.
