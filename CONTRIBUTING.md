# Contributing to agent-ledger

Thanks for your interest in contributing!

## Getting Started

1. Fork and clone the repo
2. `npm install`
3. `npm run db:push`
4. `npm run dev`

Server starts at http://localhost:3001, dashboard at http://localhost:3000.

## Development

Run all checks before submitting:

```bash
npm run lint        # ESLint
npm run format      # Prettier check (use format:fix to auto-fix)
npm run typecheck   # TypeScript strict mode
npm run test        # Vitest test suite
```

### Running specific workspaces

```bash
npm run dev -w apps/server          # Server only
npm run dev -w apps/web             # Dashboard only
npm run test -- --reporter verbose  # Verbose test output
```

## Commit Messages

Use clear, imperative-mood commit messages:

- `Add risk assessment for FILE_SHARE capability`
- `Fix TOCTOU race in approval workflow`
- `Update policy docs with CALENDAR_WRITE examples`

Prefix with the area when helpful: `core:`, `server:`, `sdk:`, `web:`, `docs:`.

## Pull Requests

- Keep PRs focused on a single change
- Add tests for new functionality (see `packages/*/tests/`)
- Update docs if behavior changes (especially `docs/policy.md` and `docs/receipts.md`)
- Follow existing code style (Prettier + ESLint handle most of this)
- All CI checks must pass

### Where to add tests

| Package         | Test location               | What to test                                     |
| --------------- | --------------------------- | ------------------------------------------------ |
| `packages/core` | `packages/core/tests/`      | Policy matching, signing, risk, redaction        |
| `packages/sdk`  | `packages/sdk/tests/`       | SDK client modes, approval flows, error handling |
| `apps/server`   | `apps/server/tests/`        | API endpoints, idempotency, approval workflows   |
| Adapters        | `packages/adapter-*/tests/` | Framework integration, error mapping             |

## Issues

- Use GitHub Issues for bug reports and feature requests
- Check existing issues before creating a new one
- Security issues: see [SECURITY.md](SECURITY.md)

## Architecture

See [docs/architecture.md](docs/architecture.md) for an overview of the control plane, execution modes, and package boundaries before diving into the code.
