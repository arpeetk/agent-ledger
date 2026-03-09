# agent-ledger

**Policy-gated tool execution for AI agents, with approvals, verification, and signed action receipts.**

`agent-ledger` is a control plane that sits between an AI agent and its tools/APIs. It enforces **allow/deny/require-approval** policies, executes tool calls with **idempotency**, verifies outcomes, and emits **tamper-evident, signed "Action Receipts"** you can audit, reconcile, and debug.

> Mental model: **Terraform plan/apply + OPA-style policy + Stripe receipts — for agent actions.**

---

## Why

As agents start taking real actions (send emails, create calendar events, share files), teams need answers to:

- **Was this action allowed under policy?**
- **Who approved it (if required)?**
- **What actually changed?**
- **Can we prove it later?**
- **How do we debug "why did the agent do that?"**

`agent-ledger` provides a single interception layer to make agent tool use **safe, auditable, and debuggable**.

---

## Quickstart

### 1. Install & setup

```bash
npm install
npm run db:push
npm run dev
```

Server: http://localhost:3001 · Dashboard: http://localhost:3000

### 2. Run the demo

```bash
npm run demo        # Gateway mode (server executes tools)
npm run demo:sdk    # SDK mode (local execution, policy via server)
```

---

## SDK Integration (3 lines)

The fastest way to add Agent Ledger to your agent:

```typescript
import { AgentLedger } from '@agent-ledger/sdk';

const ledger = new AgentLedger({
  session: { agentId: 'my-agent', userId: 'user-123' },
});

// Wrap any tool function — calls are routed through Agent Ledger
const safeSendEmail = ledger.wrap('gmail.send', sendEmail);

const result = await safeSendEmail({
  to: ['bob@example.com'],
  subject: 'Hello',
  body: 'Hi Bob',
});
// result.status: 'executed' | 'denied' | 'pending_approval'
// result.receiptId: 'clx...'
// result.result: { sent: true, ... }
```

### SDK modes

- **Local mode** (default): SDK evaluates policy via server, executes tools locally, reports results back.
- **Gateway mode**: SDK sends tool calls to server, which executes via registered connectors.

```typescript
// Local mode (default) — your code runs the tool
const ledger = new AgentLedger({
  session: { agentId: 'my-agent' },
  mode: 'local',
});

// Gateway mode — server runs the tool via connectors
const ledger = new AgentLedger({
  session: { agentId: 'my-agent' },
  mode: 'gateway',
});
```

### Approval handling

```typescript
// Wait for approval (default — blocks until approved/denied)
const safe = ledger.wrap('gmail.send', sendEmail, { onApproval: 'wait' });

// Throw immediately when approval is needed
const safe = ledger.wrap('gmail.send', sendEmail, { onApproval: 'throw' });

// Return pending result without blocking
const safe = ledger.wrap('gmail.send', sendEmail, { onApproval: 'skip' });
```

### Wrap multiple tools at once

```typescript
const tools = ledger.wrapAll({
  'gmail.send': sendEmail,
  'gmail.create_draft': createDraft,
  'calendar.create_event': createEvent,
});

const result = await tools['gmail.send']({
  to: ['alice@co.com'],
  subject: 'Hi',
});
```

### Event callbacks

```typescript
const ledger = new AgentLedger({
  session: { agentId: 'my-agent' },
  onPendingApproval: (e) => console.log(`Awaiting approval: ${e.receiptId}`),
  onDenied: (e) => console.log(`Denied: ${e.toolName} — ${e.policyExplanation}`),
  onExecuted: (e) => console.log(`Done: ${e.toolName} in ${e.latencyMs}ms`),
});
```

---

## Framework Adapters

### Vercel AI SDK

```typescript
import { tool } from 'ai';
import { AgentLedger } from '@agent-ledger/sdk';
import { withLedger } from '@agent-ledger/adapter-vercel-ai';

const ledger = new AgentLedger({ session: { agentId: 'my-agent' } });

const tools = withLedger(ledger, {
  sendEmail: tool({
    description: 'Send an email',
    parameters: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    execute: async ({ to, subject, body }) => {
      // Your email logic
      return { sent: true };
    },
  }),
});
// Use `tools` with generateText / streamText as normal
```

### Anthropic Claude (tool_use)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { AgentLedger } from '@agent-ledger/sdk';
import { createToolProcessor } from '@agent-ledger/adapter-anthropic';

const ledger = new AgentLedger({ session: { agentId: 'claude-agent' } });

const processor = createToolProcessor(ledger, {
  send_email: {
    definition: {
      name: 'send_email',
      description: 'Send an email',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['to', 'subject'],
      },
    },
    handler: async ({ to, subject }) => ({ sent: true, to, subject }),
  },
});

// Pass definitions to Claude
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  tools: processor.definitions(),
  messages: [
    /* ... */
  ],
});

// Process tool_use blocks from response
const toolResults = await processor.processAll(toolUseBlocks);
```

### LangChain

```typescript
import { AgentLedger } from '@agent-ledger/sdk';
import { wrapLangChainTools } from '@agent-ledger/adapter-langchain';

const ledger = new AgentLedger({
  session: { agentId: 'langchain-agent' },
});
const safeTools = wrapLangChainTools(ledger, [sendEmailTool, createEventTool]);
// Use safeTools with your LangChain agent
```

### MCP (Model Context Protocol)

Expose policy-gated tools as an MCP server. Works with Claude Desktop, Cursor, and any MCP client.

```typescript
import { AgentLedger } from '@agent-ledger/sdk';
import { createMcpServer } from '@agent-ledger/adapter-mcp';

const ledger = new AgentLedger({
  session: { agentId: 'mcp-agent', userId: 'user-1' },
});

const { start } = createMcpServer(ledger, {
  send_email: {
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    handler: async ({ to, subject }) => ({ sent: true, to, subject }),
  },
});

await start(); // Starts MCP server over stdio
```

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-ledger": {
      "command": "node",
      "args": ["./my-mcp-server.js"]
    }
  }
}
```

---

## CLI

```bash
# Start server + dashboard
npx agent-ledger start

# Server only
npx agent-ledger server

# Generate signing keys
npx agent-ledger keygen

# Options
npx agent-ledger start --port 3001 --web-port 3000 --no-web
```

---

## Dashboard

The web UI at http://localhost:3000 provides:

- **Timeline**: All receipts with status filters and search
- **Approvals**: Pending actions with approve/deny controls
- **Sessions**: Group receipts by agent session with visual timeline
- **Stats**: Policy hit rates, risk distribution, tool usage, verification rates
- **Receipt Viewer**: Full receipt detail with signature verification badge

---

## Policy (YAML)

Policies live under `./policies/`. Example:

```yaml
policy_id: default-v1
defaults:
  decision: require_approval

params:
  org_domains: ['mycompany.com']

rules:
  - id: allow_reads
    when:
      capability: ['READ_ONLY']
    then:
      decision: allow

  - id: deny_public_post
    when:
      capability: ['PUBLIC_POST']
    then:
      decision: deny
      reason: 'No public posting.'

  - id: external_email_needs_approval
    when:
      capability: ['EMAIL_SEND', 'EMAIL_DRAFT']
      any:
        - arg:
            path: '$.to[*]'
            matches: '.*@((?!mycompany\.com$).)+'
    then:
      decision: require_approval
      reason: 'External recipients require approval.'
```

See [`docs/policy.md`](docs/policy.md) for full syntax.

---

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│   AI Agent   │────▶│   Agent Ledger   │────▶│  Tool / API    │
│  (your code) │     │  (control plane) │     │  (gmail, cal)  │
└──────────────┘     └──────────────────┘     └────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌────────────┐
     │  Policy  │  │ Receipts │  │ Dashboard  │
     │  Engine  │  │ (signed) │  │ (approval) │
     └──────────┘  └──────────┘  └────────────┘
```

For every tool call:

1. **Intercept** → map to capability + assess risk
2. **Evaluate policy** → allow / deny / require_approval
3. **If approval needed** → pause, wait for human decision in dashboard
4. **Execute** with idempotency + retries
5. **Verify** outcome (read-after-write)
6. **Sign** and emit an Action Receipt to the immutable ledger

See [`docs/architecture.md`](docs/architecture.md) for details.

---

## Project Layout

```
apps/
  server/           Fastify API (tool gateway + policy + receipts)
  web/              Next.js dashboard (timeline, approvals, sessions, stats)
  demo-agent/       Demo scripts showing SDK and gateway usage
packages/
  core/             Policy engine, risk classifier, signing, stable-stringify
  sdk/              SDK client — wrap any tool with policy-gated execution
  connectors/       Mocked tool connectors (gmail, calendar) with DB persistence
  adapter-vercel-ai/  Vercel AI SDK adapter
  adapter-anthropic/  Anthropic Claude tool_use adapter
  adapter-langchain/  LangChain adapter
  adapter-mcp/        MCP (Model Context Protocol) adapter
  cli/              CLI launcher (npx agent-ledger)
policies/           YAML policy files
docs/               Architecture, receipts, policy, threat model
```

---

## API Endpoints

| Endpoint                     | Method | Description                         |
| ---------------------------- | ------ | ----------------------------------- |
| `POST /tools/execute`        | POST   | Gateway: evaluate + execute         |
| `POST /tools/evaluate`       | POST   | Evaluate policy only (for SDK)      |
| `POST /receipts/:id/report`  | POST   | Report client-side execution result |
| `GET /receipts`              | GET    | List receipts (filterable)          |
| `GET /receipts/:id`          | GET    | Get single receipt                  |
| `GET /receipts/:id/verify`   | GET    | Verify receipt signature            |
| `POST /receipts/:id/approve` | POST   | Approve pending action              |
| `POST /receipts/:id/deny`    | POST   | Deny pending action                 |
| `GET /stats`                 | GET    | Aggregated statistics               |
| `GET /health`                | GET    | Health check                        |

---

## Security / Threat Model

- **Prompt injection**: Policy layer prevents untrusted content from escalating tool access
- **Confused deputy**: Capability classification + risk assessment before execution
- **Data exfiltration**: Redaction policy prevents sensitive data from leaking to receipts
- **Irreversible actions**: Approval workflow for high-risk operations

See [`docs/threat-model.md`](docs/threat-model.md).

---

## Roadmap

- MCP gateway adapter
- OpenTelemetry export (GenAI semantic conventions)
- Pluggable auth (JWT/OIDC) + multi-tenant support
- Real connectors (Gmail, Calendar, Slack, GitHub)
- More verification modes (diff snapshots, provider webhooks)

---

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
