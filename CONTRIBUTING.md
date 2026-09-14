# Contributing to TrueCourse

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for the Postgres the server stores everything in)

### Getting Started

```bash
git clone https://github.com/truecourse-ai/truecourse.git
cd truecourse
pnpm install
POSTGRES_PASSWORD=truecourse docker compose up -d db   # the database
pnpm dev                                               # Vite frontend + Express backend
```

The dev server starts at `http://localhost:3000`. See `docker-compose.yml` for the environment the server needs (`DATABASE_URL`, `TRUECOURSE_SECRET_KEY`, the WorkOS and GitHub App variables).

### Project Structure

```
apps/dashboard/client/    — Vite + React frontend (Tailwind CSS)
apps/dashboard/server/    — Express + Socket.io HTTP layer (thin adapter over core)
packages/core/            — The engine the server runs: the agent sessions, the store seams, the LLM transports
packages/shared/          — Shared Zod schemas and types, the transport seam, the work-tree layout
packages/guard-runner/    — The deterministic test runner and its drivers
packages/guard-generator/ — The deterministic half of test generation
packages/spec-consolidator/ — The deterministic half of the document scan
packages/data-store/      — The Postgres implementation of every store seam
tests/                    — All tests (centralized, not colocated)
tests/fixtures/           — Fixture projects for integration tests
```

### Useful Commands

```bash
pnpm dev          # Start the client and the server
pnpm build        # Build all packages
pnpm test         # Run all tests (vitest)
pnpm typecheck    # Typecheck every package
```

### Storage

Everything durable lives in Postgres, reached through the store seams in `packages/core` and filled at boot with their `packages/data-store` implementations. A run works on a copy: it clones the repository, materializes what it needs into a private `.truecourse/` working tree, and discards the tree when it settles.

## How to Contribute

### Reporting Bugs

Open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version
- OS

### Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run tests (`pnpm test`) and ensure they pass
5. Commit with a clear message describing the change
6. Open a pull request against `main`

### What Makes a Good PR

- **Small and focused** — one feature or fix per PR
- **Tests included** — add or update tests for your changes
- **No unrelated changes** — don't clean up surrounding code unless that's the PR's purpose
- **Clear description** — explain what changed and why

### Coding Guidelines

- TypeScript for all source code
- Tests live in `tests/` directory (not colocated with source)
- Shared types go in `packages/shared`
- Every path inside a run's working tree comes from `packages/shared/src/fs/work-tree.ts`
- No workarounds — fix root causes

## Areas Where We Need Help

- **Documentation** — improving docs, adding examples, writing tutorials
- **Testing** — expanding test coverage, especially around the guard drivers

## Questions?

Open a discussion on GitHub or reach out at mushegh@truecourse.dev.
