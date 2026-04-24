# Contributing to TrueCourse

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+

### Getting Started

```bash
git clone https://github.com/truecourse-ai/truecourse.git
cd truecourse
pnpm install
pnpm dev          # Start all services (Vite frontend + Express backend + embedded Postgres)
```

The dev server starts at `http://localhost:3000`. Embedded Postgres starts automatically — no Docker needed. Database migrations run on boot.

### Project Structure

```
apps/dashboard/client/    — Vite + React frontend (React Flow graph, Tailwind CSS)
apps/dashboard/server/    — Express + Socket.io HTTP layer (thin adapter over core)
packages/core/            — Framework-agnostic analysis engine, persistence, LLM providers
packages/analyzer/        — Tree-sitter + TypeScript Compiler analysis engine
packages/shared/          — Shared Zod schemas and TypeScript types
tools/cli/                — CLI commands (thin adapter over core)
tests/                    — All tests (centralized, not colocated)
tests/fixtures/           — Fixture projects for integration tests
```

### Useful Commands

```bash
pnpm dev          # Start all services
pnpm build        # Build all packages
pnpm test         # Run all tests (vitest)
pnpm db:generate  # Generate migration SQL after schema changes
```

### Database

TrueCourse uses embedded Postgres — no Docker or external database needed. Schema changes require generating a migration via `pnpm db:generate`. Never use `db:push`. Migrations run automatically on server startup.

## How to Contribute

### Reporting Bugs

Open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- TrueCourse version (`npx truecourse --version`)
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
- The analyzer only supports TypeScript and JavaScript currently
- Detection patterns are TypeScript constants in `packages/analyzer/src/patterns/`
- No workarounds — fix root causes

### Adding a New Language

See [packages/analyzer/ADDING_A_LANGUAGE.md](packages/analyzer/ADDING_A_LANGUAGE.md) for the complete guide on adding support for a new programming language.

## Areas Where We Need Help

- **New language support** — Python and Go are the next targets
- **New deterministic rules** — see `packages/analyzer/src/rules/` for examples
- **Documentation** — improving docs, adding examples, writing tutorials
- **Testing** — expanding test coverage, especially for edge cases in dependency resolution

## Questions?

Open a discussion on GitHub or reach out at mushegh@truecourse.dev.
