# Threat Model

This document describes the threats agent-ledger is designed to mitigate and the limitations of the current MVP.

## Threats and Mitigations

### 1. Prompt Injection Bypassing Policy

**Threat.** An attacker injects instructions into the agent's context (via user input, retrieved documents, or tool results) telling it to ignore safety rules or call tools in unauthorized ways.

**Mitigation.** Policy evaluation runs entirely server-side in the Tool Gateway. The agent never sees, evaluates, or has the ability to override policy. Even if the agent is fully compromised by a prompt injection, every tool call still passes through the PolicyEngine and is subject to the same rules.

### 2. Confused Deputy

**Threat.** The model has broad tool access and can be tricked into using a legitimate tool for an unintended purpose -- for example, using an email tool to exfiltrate data under the guise of "sending a summary."

**Mitigation.** The Tool Gateway classifies every call by capability and applies deny-by-default policy. The agent cannot invoke a capability that is not explicitly allowed by policy. Classification happens at the gateway, not in the agent, so the agent cannot misrepresent what a tool call does.

### 3. Data Exfiltration via Outbound Tools

**Threat.** The agent sends sensitive data to external recipients through email, webhooks, or other outbound channels.

**Mitigation.** Policy rules can inspect call arguments (e.g. `$.to[*]`) and enforce domain restrictions using `org_domains`. Recipients outside the configured domains trigger `deny` or `require_approval`. Redaction policy ensures sensitive content is hashed rather than stored in the ledger, limiting exposure if the ledger itself is compromised.

### 4. Irreversible Actions

**Threat.** The agent performs a destructive or irreversible action (deleting a resource, sending an email to the wrong person) that cannot be undone.

**Mitigation.** High-risk actions can be routed through the approval workflow via `require_approval` rules. A human reviewer sees the full call details before execution proceeds. All actions produce signed receipts, creating a complete audit trail for forensic review. Tier-1 verification (read-after-write) confirms whether an action actually took effect.

### 5. Receipt Tampering

**Threat.** An attacker (or a compromised component) modifies receipt records to hide unauthorized actions or fabricate a false audit trail.

**Mitigation.** Every receipt is signed with ed25519 using the server's private key. The ledger is append-only (JSONL); entries are never modified or deleted. Any tampering is detectable by re-verifying signatures via the `/receipts/:id/verify` endpoint.

## MVP Limitations

The current implementation is a proof-of-concept. The following limitations are known and accepted for the MVP:

| Limitation                                                                                                                                                       | Impact                                                                            | Future Direction                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **No authentication or authorization.** The server does not authenticate callers. Any process that can reach the server can submit tool calls and read receipts. | An attacker on the network can bypass the agent entirely and call tools directly. | Add API key or mTLS authentication; RBAC for receipt access.                                               |
| **Mock connectors.** Tool connectors return simulated responses rather than calling real services.                                                               | The system cannot be used for real automation without replacing connectors.       | Implement production connectors for Gmail, Google Calendar, Slack, etc.                                    |
| **Single-node deployment.** The server runs as a single process. The ledger is a local file. There is no replication or failover.                                | A server crash or disk failure can lose the ledger. No horizontal scaling.        | Persist receipts to a durable store (Postgres, S3). Run multiple gateway instances behind a load balancer. |
| **No key rotation.** The ed25519 signing key is generated once and never rotated.                                                                                | A compromised key allows forging receipts indefinitely.                           | Implement key rotation with versioned key IDs in receipt signatures.                                       |
| **No rate limiting.** The gateway does not throttle tool calls.                                                                                                  | A runaway agent can generate unbounded load on connectors.                        | Add per-agent and per-capability rate limits.                                                              |
