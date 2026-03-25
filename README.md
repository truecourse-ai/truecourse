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
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
</p>

TrueCourse analyzes your codebase architecture and code to detect violations that traditional linters miss — circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, and more. It combines static analysis with AI review to surface findings with fix suggestions.

Everything runs locally on your machine. Works with Claude Code (no API key needed) or your own API keys. Your code never leaves your environment.

<p align="center">
  <img src="assets/demo.gif" alt="TrueCourse Screenshot" width="100%" />
</p>

## Built for Humans and AI Agents

TrueCourse is designed with two interfaces:

- **Web UI** — Interactive dependency graph, inline code viewer with violation markers, cross-service flow tracing, database ER diagrams, analytics dashboard, and diff mode. Built for developers who want to explore and understand their codebase visually.
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

### Cross-Service Flow Tracing

TrueCourse automatically detects request flows across service boundaries — HTTP calls, route handlers, and internal method chains — and visualizes them as end-to-end traces. Each flow shows the chain of services, modules, and methods involved, with severity indicators when violations exist along the path.

### Database Analysis

Databases are detected automatically from ORM usage (Prisma, TypeORM, Drizzle, Knex, etc.) and displayed as nodes in the dependency graph. Click a database node to see a full ER diagram with tables, columns, types, and relationships. LLM rules check for missing foreign keys, missing indexes, naming inconsistencies, and schema issues.

### Analytics Dashboard

Track violation trends over time with charts showing how your codebase health evolves across analyses. Breakdowns by severity, category, and rule help identify recurring patterns. Code hotspots highlight files with the most violations.

### Git Diff Mode

- **New vs resolved** — See which violations your uncommitted changes introduce or fix
- **Affected nodes** — Graph dims unaffected nodes, highlights touched services/modules/methods

## Quick Start

```bash
cd /path/to/your/repo
npx truecourse analyze
```

On first run, the server starts automatically and the setup wizard configures your LLM provider:

- **Claude Code CLI** (Recommended) — uses your Claude Code subscription, no API key needed
- **Anthropic API** — requires an Anthropic API key
- **OpenAI API** — requires an OpenAI API key

An embedded PostgreSQL database is created automatically, no Docker or external database required.

Violations print in your terminal and the web UI opens automatically with an interactive dependency graph and violations highlighted.

## CLI Commands

```bash
npx truecourse                # Runs setup + starts the server
```

or you can run them one by one:

```bash
npx truecourse setup          # Configure LLM provider
npx truecourse start          # Start the server
```

Once the server is running, `cd` into any repo and:

```bash
npx truecourse add                    # Register repo without analyzing
npx truecourse analyze                # Analyze current repo, show violations
npx truecourse analyze --code-review  # Analyze with LLM code review (off by default)
npx truecourse analyze --diff         # Show new/resolved violations from uncommitted changes
npx truecourse list                   # Show violations from latest analysis
npx truecourse list --diff            # Show saved diff check results
```

## Prerequisites

- Node.js >= 20
- One of:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed (recommended, no API key needed)
  - An Anthropic or OpenAI API key

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

## Claude Code Skills

TrueCourse includes [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that let you run analysis conversationally from within Claude Code.

When you register a repo with `npx truecourse add`, you'll be prompted to install Claude Code skills. Accepting copies the skill files to `.claude/skills/truecourse/` in your project.

### Available skills

| Skill | Triggers | What it does |
|---|---|---|
| `/truecourse-analyze` | "analyze this repo", "run a diff check" | Runs `truecourse analyze` or `analyze --diff` and summarizes results |
| `/truecourse-list` | "show violations", "list issues" | Runs `truecourse list` or `list --diff` to show full violation details |
| `/truecourse-fix` | "fix violations", "apply fixes" | Lists fixable violations, lets you pick which to fix, applies changes |

## Analysis Rules

TrueCourse ships with three types of rules:

- **Deterministic rules** — Checked programmatically via AST visitors (layer violations, circular deps, dead modules, empty catch, etc.)
- **LLM architecture rules** — Passed to the LLM for deeper architectural, database, and module inspection with fix suggestions
- **LLM code rules** — Source files sent to the LLM in batches for semantic code review (error handling, race conditions, magic numbers, security, etc.). Runs when code review is enabled (`--code-review` flag or "Analyze with code review" in the UI)

All rules are visible in the **Rules** tab in the web UI. Custom rule generation is an upcoming feature.

## Language Support

| Language | Status |
|---|---|
| JavaScript / TypeScript | Supported |
| Python | Upcoming |

## License

MIT
