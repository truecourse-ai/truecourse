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

## Setup

The first `truecourse analyze` creates `.truecourse/` in your repo. Three files inside it are committable and travel with the repo:

| File | Purpose |
|---|---|
| `LATEST.json` | Most recent analysis snapshot. Doubles as the baseline for `truecourse analyze --diff` and the pre-commit hook. |
| `config.json` | Per-repo rule categories and LLM toggles. |
| `hooks.yaml` | Pre-commit hook policy (created by `truecourse hooks install`). |

Everything else (`analyses/`, `diff.json`, `history.json`, `ui-state.json`, `logs/`, `.analyze.lock`) is local-only and added to `.truecourse/.gitignore` automatically.

**First time, on `main`:**

```bash
truecourse analyze
git add .truecourse/LATEST.json .truecourse/config.json
git commit -m "add truecourse baseline"
```

**Refreshing the baseline:** re-run `truecourse analyze` after merging to `main` and commit the updated `LATEST.json`. **Don't commit `LATEST.json` from feature branches** — two PRs both updating it will conflict on a large generated JSON.

### Worktrees and fresh clones

`LATEST.json` is tracked, so `git worktree add ../feat-x` and fresh clones inherit the baseline through git. `truecourse analyze --diff` and the pre-commit hook both work on the first commit in a new worktree — no per-checkout cold-start. Inside a worktree, run `truecourse analyze --diff` to see what your in-flight changes introduce relative to `main`'s committed baseline; the diff result lands in `.truecourse/diff.json` (gitignored, per-checkout).

## CLI Commands

```bash
# Analysis
truecourse analyze                    # Analyze current repo (prompts before stashing dirty trees)
truecourse analyze --stash            # Pre-approve stashing pending changes (CI-friendly)
truecourse analyze --no-stash         # Analyze working tree as-is, no stash
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

# Individual rules
truecourse rules list                          # List rules with on/off status
truecourse rules list --disabled               # Show only disabled rules
truecourse rules disable <ruleKey>             # Disable a single rule
truecourse rules enable <ruleKey>              # Re-enable a single rule
truecourse rules reset [ruleKey]               # Clear per-rule overrides (one or all)
```

Disabled rules are skipped at analyze time (no detection cost, no LLM
calls) and any existing violations from them are hidden from the
dashboard and `truecourse list` until re-enabled. The list of disabled
rule keys lives in `<repo>/.truecourse/config.json` under
`disabledRules`, which is intended to be committed.

In the dashboard you can also toggle rules from the Rules panel
(Shield icon in the top-right) or silence a noisy rule directly from
any violation card via the **⋮** menu → **Disable rule for this repo**.

`config.json` also supports an opt-in `specCompliance` section. When enabled,
analysis discovers configured Markdown, MDX, text, JSON, and YAML specs,
extracts structured and prose requirements, extracts deterministic code facts,
evaluates compliance, persists the full artifact at
`metadata.specCompliance`, and surfaces non-satisfied findings as
`spec-compliance` violations in the dashboard.

```bash
truecourse analyze --spec-compliance
truecourse analyze --spec-compliance --specs "docs/**/*.md,specs/**/*.yaml"
truecourse analyze --spec-compliance --no-llm
truecourse analyze --spec-compliance --show-satisfied
truecourse analyze --spec-compliance --output json
```

For a tiny deterministic sample, run the React todo fixture:

```bash
cd tests/fixtures/spec-compliance-todo-react
pnpm tsx ../../../tools/cli/src/index.ts analyze --no-llm --no-stash --no-skills --spec-compliance --specs docs/** --show-satisfied --output json
```

`--no-llm` disables both normal LLM rules and prose requirement extraction.
`--output json` prints a stable JSON summary containing the normal analysis
summary plus `specCompliance` when enabled. Prose requirement extraction redacts
secrets before LLM calls, validates outputs into the shared requirement schema,
and caches results under
`<repo>/.truecourse/spec-compliance/llm-requirements/`.

Spec compliance uses deterministic evidence where possible. OpenAPI specs
produce API route requirements with operation IDs, status codes, request and
response schema hints, required request fields, and auth/security metadata.
Implementation facts include Express routes, visible request body field usage,
returned status codes, auth checks, React/UI facts, statically resolvable
composed React labels and route constants, package scripts, Docker Compose
services, GitHub Actions jobs, and schema facts from Prisma, Drizzle, and
SQLAlchemy models.

Result statuses:

- `missing`: required behavior has no matching implementation evidence.
- `partial`: some related evidence exists, but a required detail is absent or
  not fully comparable.
- `conflicting`: implementation evidence violates a `must_not` requirement.
- `ambiguous`: the requirement is too unclear for deterministic matching.
- `unverifiable`: no supported fact taxonomy is available for the requirement.
- `unspecified`: implementation evidence exists without a matching requirement.

The persisted artifact also includes `metrics.timingsMs` for spec discovery,
requirement extraction, fact extraction, matching, and finding conversion, plus
cache counters for requirement cache hits/misses, skipped prose chunks, LLM call
count, and unchanged hash counts.

Example `.truecourse/config.json`:

```json
{
  "specCompliance": {
    "enabled": true,
    "specGlobs": ["docs/**/*.md", "specs/**/*.yaml"],
    "useLlm": true,
    "includeSatisfiedResults": false
  }
}
```

### Git Hooks

TrueCourse can install a pre-commit hook that blocks commits introducing new violations at or above a configured severity:

```bash
truecourse hooks install              # Install pre-commit hook
truecourse hooks uninstall            # Remove pre-commit hook
truecourse hooks status               # Show hook status + config
```

On every commit the hook runs `truecourse analyze --diff` against the repo's last full analysis and blocks if any newly-introduced violation matches the configured block severities. **Commits will take as long as a full diff analysis** — on large repos that can be tens of seconds per commit. `truecourse hooks install` warns you and requires confirmation before writing the hook.

The hook diffs against `.truecourse/LATEST.json`, so you need a committed baseline first — see [Setup](#setup). Without it the hook has nothing to diff against.

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

TrueCourse talks to Claude Code via the `claude` CLI. You can tune how that interaction behaves — which binary to invoke, which model to pass, timeouts, retries, and how many `claude` processes to run in parallel — through environment variables.

For packaged installs (`npx truecourse` or `npm install -g truecourse`), the simplest place to set them is `~/.truecourse/.env`. The file is loaded automatically on every invocation:

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

### Excluding files from analysis

TrueCourse honors `.gitignore` automatically (including nested `.gitignore` files, `.git/info/exclude`, and your configured global excludes file).

For paths you want tracked in git but not analyzed — generated code, vendored snapshots, large fixtures — add a `.truecourseignore` at the repo root. Same syntax as `.gitignore`:

```
# generated
src/generated/
# vendored
third_party/
# specific files
scripts/ingest-epub.js
```

Patterns are anchored to the file's location, so `src/generated/` matches the top-level directory only; use `**/generated/` to match at any depth.

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
