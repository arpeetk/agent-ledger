# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-15

### Added

- **Core**: Policy engine with YAML-based rules, capability classification, risk assessment
- **Core**: ed25519 receipt signing and verification with stable JSON canonicalization
- **Core**: Redaction engine — sensitive fields (body, content) are hashed, safe metadata preserved
- **Server**: Fastify API with tool execution gateway (`POST /tools/execute`)
- **Server**: Policy-only evaluation endpoint (`POST /tools/evaluate`) for SDK local mode
- **Server**: Receipt CRUD, approval/deny workflows, signature verification
- **Server**: SSE endpoint for real-time dashboard updates
- **Server**: Webhook delivery with HMAC signatures, retry with exponential backoff
- **Server**: Idempotency via SHA-256 keys with unique constraint and race handling
- **Server**: TOCTOU-safe approve/deny using atomic `updateMany` with status guard
- **Server**: Aggregated stats endpoint using SQL-level `groupBy` aggregation
- **SDK**: `AgentLedger` client with `wrap()`, `wrapAll()`, `evaluate()`, `report()`
- **SDK**: Two execution modes — local (client executes) and gateway (server executes)
- **SDK**: Three approval strategies — wait (poll), throw, skip
- **Adapters**: Vercel AI SDK (`@agent-ledger/adapter-vercel-ai`)
- **Adapters**: Anthropic Claude tool_use (`@agent-ledger/adapter-anthropic`)
- **Adapters**: LangChain (`@agent-ledger/adapter-langchain`)
- **Adapters**: MCP Model Context Protocol (`@agent-ledger/adapter-mcp`)
- **Observability**: OpenTelemetry instrumentation (`@agent-ledger/otel`)
- **CLI**: `npx agent-ledger start|server|keygen|demo` launcher
- **Dashboard**: Next.js app with timeline, approvals, sessions, stats, receipt viewer
- **Dashboard**: Signature verification badge, real-time SSE updates
- **Demo**: Gateway mode, SDK mode, and Claude AI agent demo scripts
- **Connectors**: Mocked Gmail and Calendar connectors with SQLite persistence
- **Docs**: Architecture, policy authoring guide, receipt schema, threat model
- **CI**: GitHub Actions running lint, format, typecheck, and tests
