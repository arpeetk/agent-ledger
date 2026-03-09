# Architecture

agent-ledger is a control plane that sits between an AI agent and the tools it calls. Every tool invocation passes through a policy layer that classifies, evaluates risk, and produces a signed receipt. It supports two execution modes: **gateway** (server executes) and **local** (SDK evaluates policy, your code executes).

## Components

| Component  | Path                         | Stack      | Role                                                        |
| ---------- | ---------------------------- | ---------- | ----------------------------------------------------------- |
| Server     | `apps/server`                | Fastify    | Tool Gateway, PolicyEngine, receipt signing, ledger storage |
| Web UI     | `apps/web`                   | Next.js    | Approval queue, receipt viewer, sessions timeline, stats    |
| Core       | `packages/core`              | TypeScript | Shared types, policy evaluation, risk classifier, signing   |
| Connectors | `packages/connectors`        | TypeScript | Tool adapters (email, calendar) with DB persistence         |
| SDK        | `packages/sdk`               | TypeScript | Client SDK — `wrap()` any tool with policy-gated execution  |
| Vercel AI  | `packages/adapter-vercel-ai` | TypeScript | Vercel AI SDK adapter                                       |
| Anthropic  | `packages/adapter-anthropic` | TypeScript | Anthropic Claude tool_use adapter                           |
| LangChain  | `packages/adapter-langchain` | TypeScript | LangChain StructuredTool adapter                            |
| MCP        | `packages/adapter-mcp`       | TypeScript | Model Context Protocol server adapter                       |
| OTel       | `packages/otel`              | TypeScript | OpenTelemetry instrumentation — trace all SDK calls         |
| CLI        | `packages/cli`               | TypeScript | `npx agent-ledger start` launcher                           |

## Execution Modes

### Gateway Mode (server executes)

The agent sends tool calls to the server. The server evaluates policy, executes via registered connectors, verifies outcomes, and returns signed receipts.

```
Agent → POST /tools/execute → Server → Connector → Verify → Sign → Receipt
```

Best for: centralized control, shared connectors, server-side verification.

### Local Mode (SDK evaluates + executes locally)

The SDK asks the server for a policy decision, executes the tool in your process, and reports the result back. The server signs the receipt.

```
SDK → POST /tools/evaluate → policy decision
SDK → execute locally → result
SDK → POST /receipts/:id/report → signed receipt
```

Best for: existing codebases, custom tools, low-latency execution.

## Control Plane Flow

1. **Intercept** — The gateway or SDK receives every tool call before execution.
2. **Classify** — The call is tagged with a capability (e.g. `EMAIL_SEND`, `CALENDAR_WRITE`) and a risk tier derived from the tool and its arguments.
3. **Evaluate Policy** — The PolicyEngine loads the applicable YAML policy, matches rules against the classified call, and returns: `allow`, `deny`, or `require_approval`.
4. **Approval (conditional)** — If `require_approval`, the call is written to a pending queue. The Web UI surfaces it for human review. Execution blocks until the reviewer approves or rejects.
5. **Execute** — The call is dispatched to the connector (gateway mode) or your handler (local mode). Uses an idempotency key so retries are safe. Failed calls are retried with exponential backoff.
6. **Verify** — For Tier-1 actions (writes, sends, deletes), a read-after-write verification step confirms the side effect. The result is attached to the receipt.
7. **Sign Receipt** — A receipt object is constructed, canonicalized via `stableStringify`, and signed with ed25519. The signed receipt is appended to the ledger.

## Sequence Diagram (Gateway Mode)

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
```

## Sequence Diagram (SDK Local Mode)

```
Agent/SDK           Server              PolicyEngine          Your Handler
  |                   |                      |                      |
  |-- evaluate ------>|                      |                      |
  |                   |-- classify+eval ---->|                      |
  |                   |<-- decision ---------|                      |
  |<-- policy decision|                      |                      |
  |                                                                 |
  |-- execute locally ------------------------------------------>|  |
  |<-- result --------------------------------------------------|  |
  |                                                                 |
  |-- report result -->|                                            |
  |                   |-- sign receipt --> Ledger                    |
  |<-- signed receipt -|                                            |
```

## Integration Points

### Framework Adapters

Each adapter wraps the SDK to integrate seamlessly with a specific framework:

- **Vercel AI SDK**: `withLedger(ledger, tools)` — wraps `tool()` definitions, supports `generateText`/`streamText`
- **Anthropic Claude**: `createToolProcessor(ledger, tools)` — processes `tool_use` blocks
- **LangChain**: `wrapLangChainTools(ledger, tools)` — wraps `StructuredTool` instances
- **MCP**: `createMcpServer(ledger, tools)` — exposes tools as MCP server over stdio

All adapters use structural typing to avoid hard dependencies on framework packages.

### OpenTelemetry

The `@agent-ledger/otel` package wraps any `AgentLedger` instance to emit spans:

- `agent_ledger.tool <name>` — one span per tool call with policy decision, risk level, capability
- `agent_ledger.evaluate` — policy evaluation span
- `agent_ledger.report` — execution report span
- PII-safe by default (args/results not recorded unless opted in)

## Key Design Decisions

- **Policy is server-side only.** The agent never sees or evaluates policy. This prevents prompt injection from bypassing controls.
- **Deny by default.** If no rule matches a tool call, the gateway denies it. Policies must explicitly allow capabilities.
- **Receipts are append-only.** Once written to the ledger, a receipt is never modified or deleted. Signatures make tampering detectable.
- **Idempotency is caller-transparent.** The gateway generates idempotency keys from call content. Neither the agent nor the connector needs to be aware of retry logic.
- **Structural typing for adapters.** Framework adapters use interfaces rather than importing framework types, so they work across versions without version pinning issues.
- **Two execution modes.** Gateway mode centralizes execution; local mode lets existing codebases add policy without routing through the server.
