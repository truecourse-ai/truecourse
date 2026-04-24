# TrueCourse — Codex Instructions

## Key Files to Keep Updated

- **PLAN.md** — The source of truth for all phases, implementation status, and test plans. When completing work on any phase or sub-task, update the relevant `STATUS:` tags. When adding new features or changing scope, update the plan accordingly.
- **README.md** — Must reflect the current state of the project. When adding new packages, endpoints, commands, environment variables, or changing the project structure, update the README to match.

## Project Layout

- `apps/dashboard/client/` — Vite + React Router frontend (React Flow graph, Tailwind CSS, dark mode)
- `apps/dashboard/server/` — Express + Socket.io HTTP layer that serves the dashboard. Thin adapter over `@truecourse/core`.
- `packages/core/` — Framework-agnostic analysis engine: pipeline, graph/flow services, LLM providers, persistence, config, logger. Consumed by both the CLI and the dashboard server.
- `packages/shared/` — Shared Zod schemas and TypeScript types
- `packages/analyzer/` — Tree-sitter + TypeScript Compiler analysis engine (TS/JS/Python)
- `tools/cli/` — CLI commands (analyze, dashboard, list, add, rules). Thin adapter over `@truecourse/core` — does NOT depend on the dashboard server.
- `tests/` — All tests (centralized, not colocated). Organized by package: `tests/shared/`, `tests/analyzer/`, `tests/server/` (covers both dashboard-server routes and core services), `tests/cli/`.
- `tests/fixtures/sample-project/` — Realistic multi-service TS/JS repo used by tests

## Development Commands

```bash
pnpm dev          # Start all services (turbo) — embedded Postgres starts automatically, migrations run on boot
pnpm build        # Build all packages
pnpm build:dist   # Build distributable npm package (static frontend + bundled server → dist/)
pnpm test         # Run all tests (vitest)
pnpm db:generate  # Generate migration SQL files after schema changes (drizzle-kit generate)
```

## Rules

- **No workarounds.** Always find and fix the root cause. Do not use hacks, fallbacks, or temporary patches to bypass issues. If something isn't working, investigate why and fix it properly.
- **Dev servers.** Do not start, stop, or restart dev servers. The user manages `pnpm dev` from their terminal. If a restart is needed (e.g. `.env` change), tell the user.
- **Database.** Uses embedded Postgres (not Docker). Schema changes require generating a migration via `pnpm db:generate` — never use `db:push`. Migrations run automatically on server startup.

## Conventions

- All tests live in the `tests/` directory at the repo root, not colocated with source files
- The analyzer only supports TypeScript and JavaScript (no Python/C# yet — that's Phase 6)
- Detection patterns are TypeScript constants in `packages/analyzer/src/patterns/`, not JSON files
- LLM providers implement the `LLMProvider` interface — add new providers there
- Types shared between frontend and backend go in `packages/shared`
