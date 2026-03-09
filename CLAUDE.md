You are a staff-level engineer building a serious open-source project. Ship a production-quality MVP repo (not a hack) called:

Agent Ledger
Policy-gated tool execution + signed action receipts + approvals + verification

This repo will be open-sourced and judged on code quality, clarity, security posture, docs, and developer experience.

NON-NEGOTIABLE QUALITY BAR

- Clean architecture, strong typing, minimal cleverness, readable code
- Opinionated but extensible interfaces (tool adapters, policy engines, receipt stores)
- Secure defaults (redaction, deny-by-default for dangerous capabilities)
- Great README, diagrams, quickstart, screenshots/gifs optional
- Tests for core logic (policy matcher + canonicalization + signing verification)
- CI that runs lint + typecheck + tests
- Consistent formatting (prettier) + linting (eslint)
- Good commit-ready structure (even if single commit, code should look maintainable)

TECH STACK (use exactly this unless impossible)

- Node.js 20+, TypeScript
- npm workspaces (monorepo) + package-lock.json committed
- Backend: Fastify
- Frontend: Next.js (App Router) + Tailwind
- DB: SQLite via Prisma
- YAML: for policy files
- Crypto: ed25519 with tweetnacl (or libsodium bindings if needed)
- Canonical JSON: stable key ordering (implement a stableStringify util)
- API: REST over HTTP (no external services)
- License: Apache-2.0 (include LICENSE)
- Code of Conduct: Contributor Covenant
- Security policy: SECURITY.md
- Contributing: CONTRIBUTING.md
- Changelog: optional, but include at least “0.1.0”

PROJECT GOAL / PITCH
Build a “control plane” between any LLM agent and its tools:

1. Intercept tool calls
2. Classify capability + risk
3. Evaluate policy: allow | deny | require_approval
4. If require_approval: pause and await human decision via UI
5. Execute with idempotency + retries
6. Verify (Tier-1 read-after-write / diff summary)
7. Emit a signed, tamper-evident “Action Receipt” (Stripe-like object)

Provide a crisp mental model in docs:
“Terraform plan/apply + OPA-style policy + Stripe receipts, for agent actions.”

REPO STRUCTURE
/
LICENSE
README.md
SECURITY.md
CODE_OF_CONDUCT.md
CONTRIBUTING.md
package.json
package-lock.json
tsconfig.base.json
.editorconfig
.gitignore
.github/workflows/ci.yml
/apps
/server
/web
/demo-agent
/packages
/core
/connectors
/policies
default.yaml
/docs
architecture.md
receipts.md
policy.md
threat-model.md
screenshots/ (optional)

DX REQUIREMENTS

- “One command” local start:
  npm install
  npm run db:push
  npm run dev
- Root npm scripts must exist:
  dev: runs server + web concurrently
  demo
  lint, format, typecheck, test
  db:push, db:studio (optional)
- Use npm workspace execution:
  - npm run <script> -w apps/server
  - npm run <script> -w apps/web
  - npm run <script> -w apps/demo-agent
  - npm run <script> -ws (for all workspaces)
- Server runs at http://localhost:3001
- Web runs at http://localhost:3000

CORE FEATURES

A) Tool Gateway / Router

- POST /tools/execute
  Request:
  {
  session: { sessionId, agentId, userId, environment? },
  toolName: string,
  args: any,
  intent?: string
  }
  Response:
  - allow path: 200 { status:"executed", receiptId, result }
  - approval path: 202 { status:"pending_approval", receiptId }
  - deny path: 403 { status:"denied", receiptId, error }
- Must create a receipt record BEFORE approval/execution.
- Must persist a redacted copy of the request so deferred execution works.
- Must implement idempotency:
  idempotencyKey = sha256(sessionId + toolName + stableStringify(normalizedArgs))
  If already executed successfully, return cached result and mark receipt as replay.
- Retries: up to 2 retries with exponential backoff for transient failures.

B) Capability + Risk
Define a small capability taxonomy:

- READ_ONLY
- EMAIL_DRAFT
- EMAIL_SEND
- CALENDAR_WRITE
- FILE_SHARE
- DELETE
- PUBLIC_POST
- PAYMENTS (unused but deny-by-default)
  Risk heuristics:
- external_recipient
- contains_link
- many_recipients
- delete_action
- public_post
  Return: { level: low|medium|high, reasons: string[] }

C) Policy Engine (simple, authorable)
Policy is YAML at /policies/default.yaml.
Must support:

- defaults decision
- rules with when/then
- match on tool, capability
- simple arg predicates:
  - regex matches (e.g. $.to[*])
  - length comparisons (e.g. $.attendees.length > 10)
  - max_len (subject)
- combinators any/all
  Policy must include a human-friendly mode:
- org_domains: ["mycompany.com"]
- presets: autopilot/guarded/locked (document only; implement default.yaml as autopilot)
  Policy evaluation returns:
  { decision, matchedRuleIds, explanation, policyId }

D) Approval Workflow

- GET /receipts?status=pending_approval|final&limit=&cursor=
- GET /receipts/:id
- POST /receipts/:id/approve { approvedBy, comment }
- POST /receipts/:id/deny { approvedBy, comment }
  Approving executes the deferred action, verifies, finalizes and signs receipt.
  Deny finalizes as denied.
  No real auth required but structure code so auth can be added later.

E) Receipts (Stripe-like, signed, tamper-evident)
Receipt JSON schema v0.1 must include:

- receipt_version, receipt_id, timestamp
- session fields
- request: tool_name, capability, risk, intent summary
- policy: decision, matched_rules, explanation
- approval: status + actor + time
- execution: status, attempts, idempotency_key, hashes, latency
- verification: method + status + after snapshot/diff summary
- redaction: what was redacted
- signature: alg, public_key_id, signature_b64
  Redaction policy:
- Never store full email body or calendar description. Store hash. Allow safe metadata (to/subject/title/times).
  Signing:
- stableStringify (sorted keys) -> bytes -> ed25519 sign
- verify endpoint OR verify in UI using public key:
  GET /receipts/:id/verify -> { valid: boolean }
  Storage:
- Persist receipt rows in SQLite
- Append finalized receipts to /apps/server/receipts/ledger.jsonl (append-only)

F) Verification
Tier-1 read-after-write:

- For mocked tools with get_by_id, fetch after state and store redacted snapshot.
- Store verification.status = verified|unverified|failed
- diff_summary can be simple text.

G) UI (Next.js)
Pages:

- / (Timeline) list receipts with filters and statuses; click opens receipt
- /approvals shows pending approvals with approve/deny and a details modal:
  tool, capability, risk reasons, intent, policy explanation, safe preview of args
- /receipt/[id] shows full receipt, and signature verification badge
  Polling every ~2s is fine.

H) Demo Agent
/apps/demo-agent: node script that simulates an agent calling /tools/execute:

- internal email send (allowed)
- external email draft (approval)
- calendar event with 12 attendees (approval)
- public post attempt (denied)
  When pending_approval, print a link to approvals page and poll receipt until final.

CONNECTORS (mocked, deterministic)
Under /packages/connectors implement tools and persistence (Prisma tables):

- gmail.create_draft, gmail.send, gmail.get_draft, gmail.get_message
- calendar.create_event, calendar.get_event
  Mock artifacts must persist in SQLite so verification works.

DOCS (must write these)

- docs/architecture.md: explains control plane, flow, components, sequence diagram
- docs/policy.md: how to author policies + examples
- docs/receipts.md: receipt schema + signing/verification + redaction
- docs/threat-model.md: basic threats (prompt injection, confused deputy, exfil) + mitigations in MVP

ENGINEERING HYGIENE

- Prettier + ESLint + TypeScript strict
- Unit tests (Vitest or Jest) for:
  1. policy matching (regex, any/all, arg paths)
  2. stableStringify determinism
  3. receipt signing + verification roundtrip
- CI workflow running: npm run lint && npm run typecheck && npm run test
- No secrets committed. Dev keys are ok but clearly marked and rotated/replaceable.
- Provide environment variables file example (.env.example)

OUTPUT
Produce the full repo with all code, configs, docs, and scripts. Everything must run locally.

WORK PLAN (follow this order)

1. Scaffold monorepo + tooling + CI + docs skeleton
2. Prisma schema + migrations (sqlite)
3. Core packages: stableStringify, policy engine, risk classifier, receipt signer/writer
4. Server: tool execute endpoint + receipts endpoints + approval execution
5. Connectors: mock gmail/calendar with DB persistence + get_by_id
6. Verification tier-1
7. Web UI: timeline, approvals, receipt view
8. Demo agent script + README walkthrough
9. Tests + polish + ensure npm run dev/demo works

Do not overbuild. But do not handwave. This is meant to be a credible OSS foundation.
