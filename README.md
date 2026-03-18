<p align="center">
  <img src="assets/logo.svg" alt="TrueCourse" width="300" />
</p>

<p align="center">
  <strong>AI Architecture & Code Intelligence Platform</strong>
</p>

<p align="center">
  <em>Built for humans and AI agents — web UI for developers, CLI for automation.</em>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://www.npmjs.com/package/truecourse"><img src="https://img.shields.io/npm/v/truecourse" alt="npm version" /></a>
</p>

TrueCourse analyzes your codebase to detect architectural violations, code quality issues, and semantic bugs that traditional linters miss. It combines [tree-sitter](https://tree-sitter.github.io/tree-sitter/) static analysis with LLM-powered code review to surface actionable findings with fix suggestions.

Everything runs locally on your machine with your own API keys. Your code never leaves your environment.

<p align="center">
  <img src="assets/screenshot.png" alt="TrueCourse Screenshot" width="100%" />
</p>

## Built for Humans and AI Agents

TrueCourse is designed with two interfaces:

- **Web UI** — Interactive dependency graph, inline code viewer with violation markers, rules panel, and diff mode. Built for developers who want to explore and understand their codebase visually.
- **CLI** — Analyze repos, list violations, and run diff checks from the terminal. Built for AI coding agents, CI pipelines, and automation workflows that need structured output.

Both interfaces share the same analysis engine and database — run `analyze` from an agent, review results in the UI.

## What it catches

### Architecture & Module Analysis

- **Circular dependencies** between services and modules
- **Layer violations** like data layer calling API layer, skipping service layer, etc.
- **God modules** with too many exports or responsibilities
- **Dead modules** that are unused and should be removed
- **Tight coupling** between services or modules with excessive cross-dependencies
- **Database issues** like missing indexes, raw SQL bypassing ORM, schema problems

### Code Intelligence

<!-- TODO: Add screenshot of code viewer with inline violations -->

TrueCourse goes beyond architecture — it reviews your actual source code for semantic issues that AST-based linters can't detect:

- **Error handling** — Catch blocks that swallow errors, rethrow without context, or return misleading success values
- **Race conditions** — Shared mutable state across async boundaries, check-then-act patterns
- **Misleading names** — Functions whose names don't match behavior (`validate` that mutates, `getUser` that deletes)
- **Dead code** — Unreachable code, always-true/false conditions, assigned-but-never-read variables
- **Security anti-patterns** — `Math.random()` for tokens, disabled TLS, `eval()` with dynamic input, unsanitized `innerHTML`
- **Resource leaks** — File handles, connections, or event listeners opened without cleanup
- **Inconsistent returns** — Functions returning different types across branches

Code violations appear inline in the code viewer with severity markers, highlighted ranges, and fix suggestions. Deterministic rules (empty catch, console.log, hardcoded secrets, magic numbers, explicit `any`, SQL injection) run via AST visitors; semantic rules run via LLM.

### Git Diff Mode

- **New vs resolved** — See which violations your uncommitted changes introduce or fix
- **Affected nodes** — Graph dims unaffected nodes, highlights touched services/modules/methods
- **URL persistence** — Diff mode state preserved in URL for sharing and refreshing

## Quick Start

```bash
# 1. Start TrueCourse (first run walks you through setup)
npx truecourse

# 2. In another terminal, cd into your repo and analyze
cd /path/to/your/repo
npx truecourse analyze
```

On first run, the setup wizard configures your LLM provider. An embedded PostgreSQL database is created automatically, no Docker or external database required.

Violations print directly in your terminal. The web UI at **http://localhost:3001** shows an interactive dependency graph with violations highlighted.

## CLI Commands

```bash
npx truecourse                # Runs setup + starts the server
```

or you can run them one by one:

```bash
npx truecourse setup          # Configure LLM keys
npx truecourse start          # Start the server
```

Once the server is running, `cd` into any repo and:

```bash
npx truecourse analyze        # Analyze current repo, show violations
npx truecourse analyze --diff # Show new/resolved violations from uncommitted changes
npx truecourse list           # Show violations from latest analysis
npx truecourse list --diff    # Show saved diff check results
npx truecourse add            # Register repo without analyzing
```

## Prerequisites

- Node.js >= 20
- An OpenAI or Anthropic API key

No database setup, no Docker. Everything runs locally out of the box.

## Development Setup

If you want to contribute or run from source:

```bash
git clone https://github.com/yourusername/truecourse.git
cd truecourse
pnpm install

cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY or OPENAI_API_KEY

pnpm dev
```

## Analysis Rules

TrueCourse ships with three types of rules:

- **Deterministic rules** — Checked programmatically via AST visitors (layer violations, circular deps, dead modules, empty catch, magic numbers, etc.)
- **LLM architecture rules** — Passed to the LLM for deeper architectural, database, and module inspection with fix suggestions
- **LLM code rules** — Source files sent to the LLM in batches for semantic code review (error handling, race conditions, security, etc.)

All rules are visible in the **Rules** tab in the web UI. Custom rule generation is an upcoming feature.

## Language Support

| Language | Status |
|---|---|
| JavaScript / TypeScript | Supported |
| Python | Upcoming |

## License

MIT
