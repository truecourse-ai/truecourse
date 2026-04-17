# TrueCourse — Claude Instructions

## Key Files to Keep Updated

- **PLAN.md** — The source of truth for all phases, implementation status, and test plans. When completing work on any phase or sub-task, update the relevant `STATUS:` tags. When adding new features or changing scope, update the plan accordingly.
- **README.md** — Must reflect the current state of the project. When adding new packages, endpoints, commands, environment variables, or changing the project structure, update the README to match.

## Project Layout

- `apps/web/` — Vite + React Router frontend (React Flow graph, Tailwind CSS, dark mode)
- `apps/server/` — Express + Socket.io backend (LLM providers, file-based analysis store)
- `packages/shared/` — Shared Zod schemas and TypeScript types
- `packages/analyzer/` — Tree-sitter + TypeScript Compiler analysis engine (TS/JS only)
- `tools/cli/` — CLI commands (analyze, dashboard, list, add, rules)
- `tests/` — All tests (centralized, not colocated). Organized by package: `tests/shared/`, `tests/analyzer/`, `tests/server/`
- `tests/fixtures/sample-project/` — Realistic multi-service TS/JS repo used by tests

## Development Commands

```bash
pnpm dev          # Start all services (turbo) — file-based store under <repo>/.truecourse/
pnpm build        # Build all packages
pnpm build:dist   # Build distributable npm package (static frontend + bundled server → dist/)
pnpm test         # Run all tests (vitest)
```

## Storage

Analyses are stored as JSON files. **No database.**

Per-repo layout under `<repo>/.truecourse/`:
- `analyses/` — per-analysis snapshot files, filenames `<iso>_<short-uuid>.json` (gitignored)
- `LATEST.json` — materialized current-state view read by the dashboard (gitignored)
- `history.json` — append-only summaries for cross-analysis queries (gitignored)
- `diff.json` — optional current diff analysis, overwritten each diff run (gitignored)
- `config.json` — per-repo settings (committable)
- `ui-state.json` — graph positions + collapse state (gitignored)
- `logs/` — per-repo analyze logs (gitignored)
- `.analyze.lock` — transient, held for the duration of an analyze (gitignored)

Global layout under `~/.truecourse/`:
- `config.json` — LLM keys, provider
- `registry.json` — known project paths + `lastAnalyzed`
- `logs/` — dashboard + install logs

The server walks up from `cwd` looking for `.truecourse/`. Set `TRUECOURSE_HOME` to relocate the user-level dir (tests do this).

## Rules

- **No workarounds.** Always find and fix the root cause. Do not use hacks, fallbacks, or temporary patches to bypass issues. If something isn't working, investigate why and fix it properly.
- **Dev servers.** Do not start, stop, or restart dev servers. The user manages `pnpm dev` from their terminal. If a restart is needed (e.g. `.env` change), tell the user.
- **Storage.** The store is file-based. Writes go through `apps/server/src/lib/analysis-store.ts` via `atomicWriteJson` (write-to-tmp + rename for atomicity). Reads are mtime-cached on `LATEST.json`. Concurrent analyses are prevented by `.analyze.lock` (O_EXCL).

## Testing

- When running tests, save the full output to a file and read from it — do NOT run tests multiple times with different grep patterns. For example: `pnpm test 2>&1 | tee /tmp/test-output.txt` then read the file.

## Conventions

- All tests live in the `tests/` directory at the repo root, not colocated with source files
- The analyzer only supports TypeScript and JavaScript (no Python/C# yet — that's Phase 6)
- Detection patterns are TypeScript constants in `packages/analyzer/src/patterns/`, not JSON files
- LLM providers implement the `LLMProvider` interface — add new providers there
- Types shared between frontend and backend go in `packages/shared`. The analysis-store's file format lives in `apps/server/src/types/snapshot.ts` (server-internal).
