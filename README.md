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
  <a href="https://discord.gg/8AYwf26A"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

TrueCourse catches two classes of defect, through two independent tools — use either on its own or both together:

- **Code defects** (`truecourse analyze`) — from the categories linters cover (unused code, style, missing types) through to ones they don't reach: circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, performance footguns. Tree-sitter analysis combined with LLM review.
- **Business-logic drift** (`truecourse verify`) — when the implementation no longer matches what the docs say it should do. Wrong response codes, missing entity fields, illegal state transitions, bypassed auth, silently-dropped effects, formulas that have lost an input. TrueCourse extracts a contract from your PRDs/ADRs/READMEs and checks the code against it.

Both produce structured output — queryable as JSON for agent workflows, and rendered in a shared [dashboard](#dashboard-web-ui) for human review.

<p align="center">
  <img src="assets/demo.gif" alt="TrueCourse Screenshot" width="100%" />
</p>

Jump to: **[1. Analyze](#1-analyze--code-intelligence)** · **[2. Spec → Verify](#2-spec--verify--business-logic-drift)** · **[Dashboard](#dashboard-web-ui)**

No setup step and no database: TrueCourse creates `.truecourse/` in your repo on first use and stores everything there as plain JSON files. It uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) for LLM-powered work — if `claude` isn't on your PATH, deterministic analysis still runs and LLM-dependent features are skipped.

---

# 1. Analyze — code intelligence

Static + LLM analysis of your code: architecture, security, bugs, performance, and more.

## Quick Start

```bash
cd <your-repo>
npx truecourse analyze      # Runs the full analysis in-process
npx truecourse list         # Show the violations it found
```

The first analyze creates `.truecourse/` and stores results as plain JSON. View them visually with [`truecourse dashboard`](#dashboard-web-ui).

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

## What it catches

**Architecture** — Circular dependencies, layer violations, god modules, dead modules, tight coupling, cross-service imports

**Code quality** — Magic numbers, empty catch, console.log, cognitive complexity, unused variables, redundant code, missing type hints

**Security** — SQL injection, hardcoded secrets, eval usage, insecure random, XSS, path traversal, unsafe deserialization

**Bugs** — Race conditions, type mismatches, mutable defaults, implicit optional, off-by-one, unchecked returns

**Performance** — N+1 queries, O(n²) string concat, unnecessary allocations, missing pagination, sync I/O in async

**Reliability** — Unhandled promises, resource leaks, missing timeouts, swallowed exceptions, unsafe error handling

**Database** — Missing indexes, missing transactions, lazy loading in loops, raw SQL bypassing ORM, schema issues

**Style** — Import ordering, naming conventions, docstring completeness, formatting preferences

### Rule coverage

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

**Deterministic rules** run via tree-sitter AST visitors — fast, zero-cost, no API calls. **LLM rules** send source code to the configured LLM for semantic analysis — deeper but requires an LLM provider.

## Commands

```bash
truecourse analyze                    # Analyze current repo (prompts before stashing dirty trees)
truecourse analyze --stash            # Pre-approve stashing pending changes (CI-friendly)
truecourse analyze --no-stash         # Analyze working tree as-is, no stash
truecourse analyze --diff             # New/resolved violations from your uncommitted changes
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

# Individual rules
truecourse rules list                          # List rules with on/off status
truecourse rules list --disabled               # Show only disabled rules
truecourse rules disable <ruleKey>             # Disable a single rule
truecourse rules enable <ruleKey>              # Re-enable a single rule
truecourse rules reset [ruleKey]               # Clear per-rule overrides (one or all)
```

Disabled rules are skipped at analyze time (no detection cost, no LLM calls) and any existing violations from them are hidden from the dashboard and `truecourse list` until re-enabled. The list of disabled rule keys lives in `<repo>/.truecourse/config.json` under `disabledRules`, which is intended to be committed.

In the dashboard you can also toggle rules from the Rules panel (Shield icon in the top-right) or silence a noisy rule directly from any violation card via the **⋮** menu → **Disable rule for this repo**.

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

---

# 2. Spec → Verify — business-logic drift

TrueCourse builds a machine-readable spec from your docs and verifies the code against it — catching where the implementation has drifted from documented intent. This is a separate pipeline from `analyze`: it answers a different question, has different prerequisites (it reads your docs), and runs on a different time scale.

> **Prerequisite:** the contract extractor and conflict resolver shell out to the Claude Code CLI (`claude -p`). Install Claude Code and sign in once before running `spec scan` or `contracts generate`.

## Quick Start

```bash
cd <your-repo>
truecourse spec scan                    # Read docs → extract claims → surface conflicts
truecourse spec resolve --all-defaults  # Accept the recommended pick on each conflict
truecourse contracts generate           # Canonical spec → .tc contract artifacts
truecourse verify                       # Check code against the contracts → drifts
```

Resolve conflicts and review drifts visually in the [dashboard](#dashboard-web-ui)'s BL Drift section, or drive every step from the CLI (`--json` on all of it for agent workflows).

## How it works

Three stages run in order, each producing artifacts the next consumes:

**1. Spec consolidation** — Walks every `.md` file in the repo (PRDs, ADRs, RFCs, READMEs, design notes; `.truecourse/`, `node_modules/`, `.git/` etc. are skipped). An LLM relevance filter drops obvious non-spec material (task lists, research logs, AI agent prompts). For the docs that remain, an LLM extracts structured claims per block and groups them by `(topic, subject)`. Agreements auto-merge; genuine disagreements surface as **conflicts** in the dashboard with a plain-English explanation of what differs. Output: `.truecourse/specs/claims.json` (the structured snapshot every downstream stage consumes — modules + per-claim content + provenance) and `.truecourse/specs/decisions.json` (the user's resolutions, version chains, and overrides — committable).

Auto-resolve rules cut the conflict count substantially: byte-identical content, status-tolerant duplicates, same-file consolidation, docKind-dominance pickups, and detected version chains. [Plan](docs/contracts/PLAN_CONFLICT_RESOLUTION.md).

**2. Contract extraction** — Reads `claims.json` and emits `.truecourse/contracts/*.tc` files in a hand-written DSL covering 13 artifact kinds: `operation`, `entity`, `enum`, `state-machine`, `auth-requirement`, `authorization-rule`, `error-envelope`, `pagination-contract`, `idempotency-contract`, `effect-group`, `formula`, plus `unenforceable-obligation` for prose the verifier can't structurally check. A post-extraction **repair pass** validates structural completeness and re-prompts the LLM to fix deficient artifacts (missing forbids clauses, broad role selectors, unresolved cross-references). On the bundled fixture this hits **22/22 planted bugs with 0 false positives**.

**3. Verification** — Parses the contracts, walks the source tree, and runs per-kind comparators (operations, entities, state machines, etc.). Drifts surface in the dashboard alongside code violations and from the CLI as JSON. `truecourse verify` is its own command — not a stage of `truecourse analyze`.

**4. Inference** — The mirror image of verification. `verify` asks "the spec says X — does the code do X?"; `truecourse infer` asks "the code does X — does any spec mention X?". It runs the code-side extractors *un-driven by a spec*, subtracts whatever the authored contracts already cover, and writes the remainder to `.truecourse/contracts/_inferred/` as `.tc` artifacts tagged with an `inferred-from "<code-path>" a..b` provenance line and a `confidence` level (instead of the authored `origin SOURCE "section" a..b`). It covers the full artifact spread — undocumented endpoints, entities (from ORM schema), enums, named constants, query policies, emitted events, computed formulas, architecture choices, and the cross-cutting conventions (auth, pagination, idempotency, error envelope). Confidence reflects fidelity: a value read straight from code is `high`; a synthesized convention (e.g. an assumed auth scheme) is a `low`-confidence draft to confirm. Because coverage is computed from authored contracts only, a decision drops out of `_inferred/` the moment it's documented — the directory is a shrinking backlog of "decisions your code made that your docs never recorded". Inferred contracts are descriptive, not prescriptive, so `verify` skips `_inferred/` by default.

## What it catches

Operations whose responses, status codes, or headers don't match the spec. Entities with missing or mistyped fields. Immutability and lifecycle violations on state machines. Missing or forbidden side-effect emissions. Auth requirements bypassed. Pagination, idempotency, and error-envelope contracts violated. Formulas producing wrong results from drifted inputs.

## Setup

The spec and a verify baseline are committable so they travel with the repo; everything else is local-only. Per-repo layout under `.truecourse/`:

```
.truecourse/
├── specs/                  ← canonical spec (committable)
│   ├── claims.json          ← structured snapshot: modules + claims + provenance
│   └── decisions.json       ← user resolutions + version chains + manual includes
├── contracts/               ← generated TC contract artifacts (gitignored by default)
│   └── _inferred/            ← reverse-engineered, undocumented decisions (`truecourse infer`)
├── verifier/                ← drift store (mirrors analyze; `truecourse verify`)
│   ├── runs/                 ← per-run drift snapshots (gitignored)
│   ├── LATEST.json           ← current drift state + diff baseline (committable)
│   ├── history.json          ← per-run summaries (gitignored)
│   └── diff.json             ← current-vs-baseline drift diff (gitignored)
└── .cache/                  ← LLM + slice cache (gitignored)
```

Like analyze, `verifier/LATEST.json` is the committable baseline — commit it after merging to `main` (re-run `truecourse verify`, commit the result), not from feature branches. `truecourse verify --diff` then shows the drifts your uncommitted changes add or resolve against it.

## Commands

```bash
# Spec consolidation (docs → canonical spec)
truecourse spec scan                              # Read docs, extract claims, surface conflicts, write claims.json
truecourse spec resolve --all-defaults            # Accept the engine's recommended pick on every open conflict
truecourse spec status                            # Summary: docs, claims, modules, pending decisions

# Agent-friendly conflict surface (all support --json)
truecourse spec conflicts list                    # List open conflicts (add --decided / --all)
truecourse spec conflicts show <id>               # Full detail for one conflict
truecourse spec conflicts pick <id> <index>       # Resolve by picking a candidate
truecourse spec conflicts custom <id> --text "…"  # Resolve with a custom answer
truecourse spec conflicts revoke <id>             # Re-open a decided conflict
truecourse spec chains add --older A --newer B    # Manually mark a version chain (escape hatch)
truecourse spec chains list / remove …
truecourse spec docs skipped                      # Docs the LLM relevance filter excluded
truecourse spec docs include <path>               # Force-include a skipped doc
truecourse spec docs uninclude <path>

# Contract extraction (canonical spec → .tc artifacts)
truecourse contracts generate                     # Extract / re-extract TC contract files
truecourse contracts list                         # List generated contracts
truecourse contracts validate                     # Parse + resolve TC files; report unresolved refs

# Verification (code against contracts)
truecourse verify                                 # Full run: stashes dirty tree (prompts), writes verifier/runs + LATEST + history
truecourse verify --diff                          # Git diff: working-tree drifts vs committed baseline (added/resolved/unchanged)
truecourse verify --stash / --no-stash            # Pre-approve / skip stashing on a full run

# Inference (code → inferred contracts) — reverse-engineer undocumented decisions
truecourse infer                                  # Write inferred .tc files to contracts/_inferred/
truecourse infer --dry-run                        # Report what would be written, touch nothing
```

---

# Dashboard (web UI)

One web UI for both capabilities — browse code findings and business-logic drift side by side, with the architecture graph, analytics, and the spec/contracts/verify workflow.

```bash
truecourse dashboard                  # Start + open the dashboard
truecourse dashboard --reconfigure    # Re-prompt for console vs background service mode
truecourse dashboard stop             # Stop the dashboard
truecourse dashboard status           # Show dashboard status
truecourse dashboard logs             # Tail dashboard logs (service mode only)
truecourse dashboard uninstall        # Remove the background service
```

- **Code Analysis** — architecture graph, violations list, severity/category analytics, code hotspots, trend over time; toggle rules and silence noisy ones inline.
- **BL Drift** — the Spec tab walks you through resolving each conflict (pick / write custom / mark superseded / include skipped doc); Contracts shows the generated `.tc` artifacts; Verify shows the drift analytics + list, with a Runs history and a Normal / Git-Diff toggle.

---

# Common

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
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on your PATH. Deterministic rules run without it; LLM-powered rules and the Spec → Verify pipeline need it.

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

**`CLAUDE_CODE_MAX_CONCURRENCY`** caps how many Claude CLI processes TrueCourse spawns in parallel during a single run. Default `10`. Raise it on CI runners with spare headroom; lower it on resource-constrained machines (e.g. 8 GB laptops, shared VMs) to avoid OOM on large repos. Must be a positive integer.

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

## Telemetry

TrueCourse collects anonymous usage data (event type, language, file count range, OS) to improve the product. No source code, file paths, or violation details are collected. It is automatically disabled in CI environments.

```bash
truecourse telemetry status           # Check telemetry status
truecourse telemetry disable          # Opt out of anonymous telemetry
truecourse telemetry enable           # Opt back in
```

Or set `TRUECOURSE_TELEMETRY=0` to opt out.

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

## Community

Join the [TrueCourse Discord](https://discord.gg/8AYwf26A) to ask questions, share feedback, and follow what's shipping.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan** — [mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

MIT
