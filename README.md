# agent-ledger

**Policy-gated tool execution for AI agents, with approvals, verification, and signed action receipts.**

`agent-ledger` is a control plane that sits between an AI agent and its tools/APIs. It enforces **allow/deny/require-approval** policies, executes tool calls with **idempotency**, verifies outcomes (tiered), and emits **tamper-evident, signed "Action Receipts"** you can audit, reconcile, and debug.

> Mental model: **Terraform plan/apply + OPA-style policy + Stripe receipts — for agent actions.**

---

## Why

As agents start taking real actions (send emails, create calendar events, share files), teams need answers to:

- **Was this action allowed under policy?**
- **Who approved it (if required)?**
- **What actually changed in the outside world?**
- **Can we prove it later?**
- **How do we debug "why did the agent do that?"**

`agent-ledger` provides a single interception layer to make agent tool use **safe, auditable, and debuggable**.

---

## What it does

For every tool call, `agent-ledger`:

1. **Intercepts** the request (SDK wrapper or HTTP gateway)
2. Maps tool → **capability** (e.g. `EMAIL_SEND`, `CALENDAR_WRITE`)
3. Computes a **risk classification** (e.g. `external_recipient`, `contains_link`)
4. Evaluates a **policy** (YAML): `allow | deny | require_approval`
5. If `require_approval`, creates a **pending receipt** and waits
6. Executes with **idempotency + retries**
7. **Verifies** outcome (tiered: read-after-write, diffs)
8. Finalizes a **signed Action Receipt** + appends to an immutable JSONL ledger

---

## Screens / UX

- **Timeline**: all receipts with status badges and filters
- **Approvals Inbox**: pending actions that require human decision
- **Receipt Viewer**: full receipt (policy match, approval, proof, signature verification)

---

## Quickstart (local)

### Prerequisites
- Node.js 20+
- npm (v9+ recommended)

### Install
```bash
npm install
```

### Setup database (SQLite)

```bash
npm run db:push
```

### Run dev (server + web)

```bash
npm run dev
```

* Server: [http://localhost:3001](http://localhost:3001)
* Web UI: [http://localhost:3000](http://localhost:3000)

### Run the demo agent

In another terminal:

```bash
npm run demo
```

The demo agent will:

* send an internal email (auto-allowed)
* create an external email draft (requires approval)
* create a calendar event with many attendees (requires approval)
* attempt a public post (denied)

Approve/deny in the UI:

* Approvals page: [http://localhost:3000/approvals](http://localhost:3000/approvals)

---

## How it integrates

### Option A: SDK wrapper (lowest friction)

Wrap your agent's tool executor with `ToolRouter.execute(...)`.

### Option B: HTTP tool gateway

Your agent calls the server's `POST /tools/execute` endpoint. The gateway enforces policy, writes receipts, and executes connectors.

### Option C: MCP gateway (recommended for platform adoption)

Place `agent-ledger` in front of your MCP server(s) to intercept all tool calls without changing agent code.

> This repo ships an HTTP gateway MVP. SDK/MCP adapters can be added as thin layers over the same core.

---

## Policy (YAML)

Policies live under `./policies/`.

Example: require approval for external emails; deny public posting:

```yaml
policy_id: default-v1
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

  - id: deny_public_post
    when:
      capability: ["PUBLIC_POST"]
    then:
      decision: deny
      reason: "No public posting."

  - id: external_email_needs_approval
    when:
      capability: ["EMAIL_SEND", "EMAIL_DRAFT"]
      any:
        - arg:
            path: "$.to[*]"
            matches: ".*@((?!mycompany\\.com$).)+"
    then:
      decision: require_approval
      reason: "External recipients require approval."
```

See [`docs/policy.md`](docs/policy.md) for full syntax and examples.

---

## Action Receipts

Every action produces a signed receipt with:

* policy decision + matched rule IDs
* approval metadata (who/when/comment)
* execution metadata (idempotency, hashes, latency)
* verification/proof status

Receipts are stored in:

* SQLite (queryable)
* Append-only JSONL ledger at `apps/server/receipts/ledger.jsonl`

See [`docs/receipts.md`](docs/receipts.md) for schema and signing/verification details.

---

## Security / Threat model

This project is designed to reduce real-world agent risk:

* **prompt injection** / untrusted content steering tool use
* **confused deputy**: model has broad tool access
* **data exfiltration** via outbound tools
* **irreversible actions** without auditability

See [`docs/threat-model.md`](docs/threat-model.md).

Report security issues: see [`SECURITY.md`](SECURITY.md).

---

## Project layout

```text
apps/
  server/      # Fastify API (tool gateway), Prisma/SQLite, receipt ledger
  web/         # Next.js UI: timeline, approvals, receipt viewer
  demo-agent/  # script that simulates an agent making tool calls
packages/
  core/        # policy engine, risk classifier, stable stringify, signing
  connectors/  # mocked tool connectors (gmail/calendar) + persistence
policies/      # YAML policies
docs/          # architecture, receipts, policy, threat model
```

---

## Roadmap (near-term)

* MCP gateway adapter
* OpenTelemetry export (GenAI semantic conventions)
* More verification modes (diff snapshots, provider webhooks)
* Pluggable auth (JWT/OIDC) + multi-tenant support
* Real connectors (Gmail/Google Calendar, Slack, GitHub) behind feature flags

---

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
