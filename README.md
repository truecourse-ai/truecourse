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
cd <your-repo>
npx truecourse analyze      # Runs the full analysis in-process
npx truecourse dashboard    # Opens the web UI in your browser
```

No setup step. TrueCourse creates `.truecourse/` in your repo on first analyze and stores everything there as plain JSON files — no database, no daemon.

TrueCourse uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) for LLM-powered rules. If `claude` isn't on your PATH, deterministic rules still run and LLM rules are skipped.

## CLI Commands

```bash
# Analysis
truecourse analyze                    # Analyze current repo
truecourse analyze --diff             # New/resolved violations from your uncommitted changes
truecourse list                       # Show violations from latest analysis
truecourse list --all                 # Show all violations (no pagination)
truecourse list --diff                # Show diff check results
truecourse add                        # Register repo without analyzing

# Dashboard (web UI)
truecourse dashboard                  # Start + open the dashboard
truecourse dashboard --reconfigure    # Re-prompt for console vs background service mode
truecourse dashboard stop             # Stop the dashboard
truecourse dashboard status           # Show dashboard status
truecourse dashboard logs             # Tail dashboard logs (service mode only)
truecourse dashboard uninstall        # Remove the background service
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

### ADRs (Architectural Decision Records)

TrueCourse can surface the architectural decisions already embedded in your code — and document them as MADR-format ADRs that live in `docs/adr/` alongside your source. Uses the LLM to propose draft ADRs from the analyzed graph; you review and accept.

```bash
truecourse adr suggest                   # Generate draft ADRs from the code graph
truecourse adr suggest --max 3           # Cap drafts per run
truecourse adr suggest --topic "data"    # Optional focus hint
truecourse adr suggest --non-interactive --json   # CI-friendly output

truecourse adr drafts                    # List pending drafts
truecourse adr accept <draftId>          # Promote draft → docs/adr/ADR-NNNN-<slug>.md
truecourse adr reject <draftId>          # Reject; topic won't resurface next run
truecourse adr edit <draftId>            # Edit the draft body in $EDITOR

truecourse adr list                      # List accepted ADRs
truecourse adr show <adrId>              # Show a single ADR
truecourse adr stale                     # ADRs whose linked entities were removed

truecourse adr link <adrId> <nodeId>     # Add a manual link
truecourse adr unlink <adrId> <nodeId>   # Remove a link
```

ADR output directory, draft-confidence threshold, and per-run cap are configurable under the `adr` block of `.truecourse/config.json` — see [Configuration](#configuration).

The **Decisions** tab in the dashboard mirrors the CLI — review pending drafts, accept/reject inline, see the accepted ADR corpus, and view staleness warnings when an ADR references entities that no longer exist in the graph.

**Living Fragments.** Draft and accepted ADRs can embed fenced blocks that render live in the dashboard, showing the exact subgraph or flow the decision is about:

~~~
```adr-graph
services: [auth-service, billing-service]
show: dependencies
```

```adr-flow
flowId: user-registration
```
~~~

At accept time, the referenced subgraph/flow is resolved against the current graph and a compact snapshot is captured on the ADR. The dashboard renders the snapshot; staleness flags an ADR whose fragment references a removed service, module, or flow. Plain markdown readers (GitHub, VS Code) see the fenced block as readable YAML — no broken rendering.

### Git Hooks

TrueCourse can install a pre-commit hook that blocks commits introducing new violations at or above a configured severity:

```bash
truecourse hooks install              # Install pre-commit hook
truecourse hooks uninstall            # Remove pre-commit hook
truecourse hooks status               # Show hook status + config
```

On every commit the hook runs `truecourse analyze --diff` against the repo's last full analysis and blocks if any newly-introduced violation matches the configured block severities. **Commits will take as long as a full diff analysis** — on large repos that can be tens of seconds per commit. `truecourse hooks install` warns you and requires confirmation before writing the hook.

**First-time setup:** run `truecourse analyze` once to establish a baseline. Without it the hook can't diff.

**Bypass:** `git commit --no-verify` (standard git).

**Configuration** — `hooks install` seeds `<repo>/.truecourse/hooks.yaml` with starter defaults; commit the file so your team shares one policy. The hook reads only from this file — if you delete it, the hook warns and passes every commit (no hidden code-level defaults). Current shape:

```yaml
pre-commit:
  block-on: [critical, high]   # severities. Valid: info|low|medium|high|critical
  llm: false                   # run LLM rules on every commit (tokens per commit)
```

### Telemetry

TrueCourse collects anonymous usage data to improve the product. It is automatically disabled in CI environments.

```bash
truecourse telemetry status           # Check telemetry status
truecourse telemetry disable          # Opt out of anonymous telemetry
truecourse telemetry enable           # Opt back in
```

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

The first `truecourse analyze` (or `truecourse add`) in a fresh repo asks whether to install skills into `.claude/skills/truecourse/`. Re-runs skip the prompt if skills are already present. Pass `--install-skills` / `--no-skills` to bypass the prompt explicitly.

| Skill | What it does |
|---|---|
| `/truecourse-analyze` | Runs analysis or diff check, summarizes results |
| `/truecourse-list` | Shows full violation details |
| `/truecourse-fix` | Lists fixable violations, applies changes |
| `/truecourse-hooks` | Installs, configures, or removes the pre-commit hook |

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
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on your PATH. Deterministic rules run without it, LLM-powered rules need it.

## Configuration

Two layers: a **per-repo project file** (`.truecourse/config.json` — committable, team-wide settings) and **environment variables** (local / global overrides, typically for Claude Code integration).

### Per-repo config — `.truecourse/config.json`

Committable. Shape:

```json
{
  "enabledCategories": null,
  "enableLlmRules": null,
  "adr": {
    "path": "docs/adr",
    "defaultThreshold": 0.5,
    "maxDraftsPerRun": 5
  }
}
```

| Field | Purpose | Default | Normally set via |
|---|---|---|---|
| `enabledCategories` | Array of rule categories active on this repo. `null` = use global defaults. | `null` | `truecourse rules categories --enable/--disable <name>` |
| `enableLlmRules` | Whether LLM-powered rules run. `null` = use global default (`true`). | `null` | `truecourse rules llm --enable/--disable` |
| `adr.path` | Output directory for accepted ADR files, relative to repo root. | `docs/adr` | hand-edit |
| `adr.defaultThreshold` | Draft-confidence floor for the suggest review queue (0–1). Overridden by `--threshold`. | `0` (show all) | hand-edit or `--threshold` on `adr suggest` |
| `adr.maxDraftsPerRun` | Cap on drafts produced by a single `suggest` run. Overridden by `--max`. | `5` | hand-edit or `--max` on `adr suggest` |

Rule fields are normally managed via the CLI so the file stays in a consistent shape. ADR fields are typically hand-edited once per repo.

Git-hook policy lives in a separate file — see [Git Hooks](#git-hooks) for `.truecourse/hooks.yaml`.

### Environment variables — Claude Code integration

TrueCourse talks to Claude Code via the `claude` CLI. Tune how that interaction behaves — which binary, which model, timeouts, retries, concurrency — through environment variables.

For packaged installs (`npx truecourse` or `npm install -g truecourse`), the simplest place to set them is `~/.truecourse/.env`. Loaded automatically on every invocation:

```
CLAUDE_CODE_BINARY=claude             # override the `claude` binary on PATH
CLAUDE_CODE_MODEL=                    # Claude Code --model flag (empty = default)
CLAUDE_CODE_TIMEOUT_MS=120000         # per-call timeout (ms)
CLAUDE_CODE_MAX_RETRIES=2             # retry attempts on parse/validation failure
CLAUDE_CODE_MAX_CONCURRENCY=10        # max concurrent `claude` processes per run
```

**`CLAUDE_CODE_MAX_CONCURRENCY`** caps how many Claude CLI processes TrueCourse spawns in parallel during a single analyze. Default `10`. Raise it on CI runners with spare headroom; lower it on resource-constrained machines (e.g. 8 GB laptops, shared VMs) to avoid OOM on large repos. Must be a positive integer.

For a one-off override, prefix the command:

```bash
CLAUDE_CODE_MAX_CONCURRENCY=2 truecourse analyze
```

## Development

```bash
git clone https://github.com/truecourse-ai/truecourse.git
cd truecourse
pnpm install
pnpm dev                # Start dashboard at http://localhost:3000 (server on :3001, Vite on :3000)
pnpm test               # Run tests
pnpm build              # Build all packages
```

`pnpm dev` expects a `.truecourse/` folder at the repo root — created automatically on the first `truecourse analyze` against the repo (or simply `mkdir -p .truecourse`).

## Telemetry

TrueCourse collects anonymous usage data (event type, language, file count range, OS). No source code, file paths, or violation details are collected. Opt out with `truecourse telemetry disable` or `TRUECOURSE_TELEMETRY=0`.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan** — [mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

MIT
