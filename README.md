<p align="center">
  <img src="assets/logo.svg" alt="TrueCourse" width="300" />
</p>

<p align="center">
  <strong>AI Architecture & Code Intelligence Platform</strong>
</p>

<p align="center">
  <em>1,200+ deterministic rules, 100 LLM rules. JavaScript, TypeScript, Python.</em>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://www.npmjs.com/package/truecourse"><img src="https://img.shields.io/npm/v/truecourse" alt="npm version" /></a>
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
</p>

TrueCourse analyzes your codebase architecture and code to detect violations that traditional linters miss — circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, and more. It combines tree-sitter static analysis with LLM-powered review to surface findings with fix suggestions.

Everything runs locally on your machine. Your code never leaves your environment.

<p align="center">
  <img src="assets/demo.gif" alt="TrueCourse Screenshot" width="100%" />
</p>

## What it catches

**Architecture** — Circular dependencies, layer violations, god modules, dead modules, tight coupling, cross-service imports

**Code quality** — Magic numbers, empty catch, console.log, cognitive complexity, unused variables, redundant code, missing type hints

**Security** — SQL injection, hardcoded secrets, eval usage, insecure random, XSS, path traversal, unsafe deserialization

**Bugs** — Race conditions, type mismatches, mutable defaults, implicit optional, off-by-one, unchecked returns

**Performance** — N+1 queries, O(n²) string concat, unnecessary allocations, missing pagination, sync I/O in async

**Reliability** — Unhandled promises, resource leaks, missing timeouts, swallowed exceptions, unsafe error handling

**Database** — Missing indexes, missing transactions, lazy loading in loops, raw SQL bypassing ORM, schema issues

**Style** — Import ordering, naming conventions, docstring completeness, formatting preferences

## Quick Start

```bash
npx truecourse setup     # One-time: configure LLM provider
npx truecourse start     # Start the server (embedded Postgres, no Docker)
```

Then `cd` into any repo and:

```bash
npx truecourse analyze   # Analyze repo, print violations
```

On first run, the setup wizard configures your LLM provider:

- **Claude Code CLI** (Recommended) — uses your Claude Code subscription, no API key needed
- **Anthropic API** — requires an Anthropic API key
- **OpenAI API** — requires an OpenAI API key

## CLI Commands

```bash
# Core
truecourse setup                      # Configure LLM provider
truecourse start                      # Start server (embedded Postgres)
truecourse stop                       # Stop background service
truecourse dashboard                  # Open web UI in browser

# Analysis
truecourse analyze                    # Analyze current repo
truecourse analyze --diff             # New/resolved violations from uncommitted changes
truecourse list                       # Show violations from latest analysis
truecourse list --all                 # Show all violations (no pagination)
truecourse list --diff                # Show diff check results
truecourse add                        # Register repo without analyzing

```

### Rules

Configure which rule categories and LLM-powered rules are enabled per repository:

```bash
# Categories
truecourse rules categories                    # Show enabled/disabled
truecourse rules categories --enable style     # Enable a category
truecourse rules categories --disable style    # Disable a category

# LLM-powered rules
truecourse rules llm                           # Show LLM rules status
truecourse rules llm --enable                  # Enable LLM rules
truecourse rules llm --disable                 # Disable LLM rules
```

### Git Hooks

TrueCourse can install a pre-commit hook that blocks commits with critical violations:

```bash
truecourse hooks install              # Install pre-commit hook
truecourse hooks uninstall            # Remove pre-commit hook
truecourse hooks status               # Show hook installation status
```

### Managing the Background Service

When you choose "Background service" during setup, TrueCourse runs as a system service (launchd on macOS, systemd on Linux). These commands let you manage it directly:

```bash
truecourse service status             # Show service status
truecourse service start              # Start the service
truecourse service stop               # Stop the service
truecourse service install            # Install as background service
truecourse service uninstall          # Remove background service
truecourse service logs               # Tail service logs
```

### Telemetry

TrueCourse collects anonymous usage data to improve the product. It is automatically disabled in CI environments.

```bash
truecourse telemetry status           # Check telemetry status
truecourse telemetry disable          # Opt out of anonymous telemetry
truecourse telemetry enable           # Opt back in
```

## Web Dashboard

Run `truecourse dashboard` to open the web UI:

- **Dependency graph** — Interactive service/module/method visualization with React Flow
- **Code viewer** — Inline violations with severity markers and fix suggestions
- **Flow tracing** — End-to-end request flows across service boundaries
- **Database ER diagrams** — Auto-detected from ORM usage (Prisma, Drizzle, SQLAlchemy, etc.)
- **Analytics** — Violation trends over time, code hotspots, category breakdowns
- **Diff mode** — See which violations your uncommitted changes introduce or fix
- **Rules browser** — View all 1,300+ rules with descriptions and categories

## Analysis Rules

TrueCourse ships with **1,200+ deterministic rules** and **100 LLM rules** across 8 categories:

| Category | Deterministic | LLM | Total |
|---|---:|---:|---:|
| Security | 150+ | 1 | 150+ |
| Bugs | 250+ | 4 | 250+ |
| Architecture | 30+ | 7 | 40+ |
| Code Quality | 500+ | 3 | 500+ |
| Performance | 50+ | 10 | 60+ |
| Reliability | 40+ | 10 | 50+ |
| Database | 30+ | 5 | 35+ |
| Style | 50+ | — | 50+ |

**Deterministic rules** run via tree-sitter AST visitors — fast, zero-cost, no API calls.

**LLM rules** send source code to the configured LLM for semantic analysis — deeper but requires an LLM provider.

## Claude Code Skills

TrueCourse includes [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for conversational analysis from within Claude Code.

Run `truecourse add` to install skills to `.claude/skills/truecourse/` in your project.

| Skill | What it does |
|---|---|
| `/truecourse-analyze` | Runs analysis or diff check, summarizes results |
| `/truecourse-list` | Shows full violation details |
| `/truecourse-fix` | Lists fixable violations, applies changes |

## Language Support

| Language | Status |
|---|---|
| JavaScript / TypeScript | Supported |
| Python | Supported |
| C# | Planned |
| Go | Planned |
| Rust | Planned |
| PHP | Planned |

## Prerequisites

- Node.js >= 20
- One of:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed (recommended, no API key needed)
  - An Anthropic or OpenAI API key

No database setup, no Docker. Everything runs locally.

## Development

```bash
git clone https://github.com/truecourse-ai/truecourse.git
cd truecourse
pnpm install
cp .env.example .env    # Add your API key
pnpm dev                # Start all services
pnpm test               # Run tests
pnpm build              # Build all packages
```

## Telemetry

TrueCourse collects anonymous usage data (event type, language, file count range, OS). No source code, file paths, or violation details are collected. Opt out with `truecourse telemetry disable` or `TRUECOURSE_TELEMETRY=0`.

## License

MIT
