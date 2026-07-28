<p align="center">
  <img src="assets/logo.svg" alt="TrueCourse" width="300" />
</p>

<p align="center">
  <strong>AI Architecture & Code Intelligence Platform</strong>
</p>

<p align="center">
  <em>1,500+ deterministic rules, 100 LLM rules. JavaScript, TypeScript, Python, C#.</em>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://www.npmjs.com/package/truecourse"><img src="https://img.shields.io/npm/v/truecourse" alt="npm version" /></a>
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
  <a href="https://discord.gg/TanxB63arz"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

TrueCourse catches two classes of defect, through two independent tools — use either on its own or both together:

- **Code defects** (`truecourse analyze`) — from the categories linters cover (unused code, style, missing types) through to ones they don't reach: circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, performance footguns. Tree-sitter analysis combined with LLM review.
- **Business-logic drift** (`truecourse guard`) — when the implementation no longer matches what the docs say it should do. TrueCourse curates your PRDs/ADRs/READMEs into a spec corpus, an LLM authors **scenario tests bound to each spec section** once, and `guard run` executes them deterministically — a failing scenario means that section and the code disagree.

Both store their results under `.truecourse/` and surface them in a shared [dashboard](#dashboard-web-ui) for human review, with plain-text CLI output an agent can read directly.

<p align="center">
  <img src="assets/demo.gif" alt="TrueCourse Screenshot" width="100%" />
</p>

Jump to: **[Install](#install)** · **[1. Analyze](#1-analyze--code-intelligence)** · **[2. Spec → Guard](#2-spec--guard--business-logic-drift)** · **[Dashboard](#dashboard-web-ui)**

No setup step and no database: TrueCourse creates `.truecourse/` in your repo on first use and stores everything there as plain JSON files. For LLM-powered work it uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) by default, or a **provider API with your own key** — your first `truecourse` command asks which, and [`truecourse config llm setup`](#llm-transport-claude-code-or-api) changes it later. With neither available, deterministic analysis still runs and LLM-dependent features are skipped.

---

# Install

```bash
npm install -g truecourse
```

This puts the `truecourse` command on your PATH — every example below uses it. Prefer not to install globally? Run any command one-off with `npx truecourse <command>` instead.

See [Prerequisites](#prerequisites) for Node, Claude Code, and C# requirements.

---

# 1. Analyze — code intelligence

Static + LLM analysis of your code: architecture, security, bugs, performance, and more.

## Quick Start

```bash
cd <your-repo>
truecourse analyze          # Runs the full analysis in-process
truecourse list             # Show the violations it found
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

The deterministic scan runs in a worker thread with a per-file time budget, so a single pathological file (e.g. one that drives a rule's regex into catastrophic backtracking) is skipped-with-a-warning instead of freezing the whole run — the analysis always completes and writes its output. The budget defaults to 30s per file and is overridable with `TRUECOURSE_DET_FILE_TIMEOUT_MS` (milliseconds) for repos with unusually large legitimate sources.

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

# 2. Spec → Guard — business-logic drift

TrueCourse builds a curated spec corpus from your docs, then **guards** it: an LLM authors declarative scenario tests bound to each spec section once, and running them is fully deterministic — no model in the verification loop. A failing scenario means "this section and the code disagree" (a drift or a bug — the developer's call). This is a separate pipeline from `analyze`: it answers a different question, has different prerequisites (it reads your docs), and runs on a different time scale.

> **Prerequisite:** the spec scan and guard generator need an LLM. By default they shell out to the Claude Code CLI (`claude -p`) — install Claude Code and sign in once before running `spec scan` or `guard generate` — or point them at a provider API instead with [`truecourse config llm setup`](#llm-transport-claude-code-or-api). `guard run` needs neither — it's deterministic.

## Quick Start

```bash
cd <your-repo>
truecourse spec scan                    # Curate docs → corpus (areas + overlap flags)
truecourse spec conflicts list          # Review flagged overlaps (resolve with `spec conflicts resolve`)
truecourse guard generate               # Author scenario tests from spec sections (classify → generate → birth-validate)
truecourse guard run                    # Run the committed scenarios; exits non-zero on any drift (CI gate)
```

Resolve conflicts and review section coverage, scenarios, and run results visually in the [dashboard](#dashboard-web-ui)'s Guard section, or drive every step from the CLI.

> Like `analyze`, the spec → guard track requires a **git repository** — TrueCourse's baselines are commit-anchored (committable `LATEST.json`, diff vs HEAD). On a non-git folder these commands stop with a clear message and the dashboard hides their actions.

## How it works

Stages run in order, each producing committable artifacts the next consumes:

**1. Spec consolidation** — Walks every `.md` file in the repo (PRDs, ADRs, RFCs, READMEs, design notes; `.truecourse/`, `node_modules/`, `.git/` etc. are skipped), plus any OpenAPI / Swagger `.yaml`/`.yml`/`.json` doc (admitted structurally — see "Which documents are scanned"). An LLM relevance filter drops obvious non-spec material (task lists, research logs, AI agent prompts), preceded by a deterministic (zero-LLM) pre-filter that drops whole non-spec directory trees the classifier can't separate by content — agent-config trees (`agents/rules/**`, `agents/skills/**`, keeping the repo's own skill docs whose leaf names an API surface — `…/skills/*-api/**` — or matches the repo's product identity), changelogs/release-notes, and template/boilerplate dirs; OpenAPI docs bypass the filter and every prose-only stage. For the docs that remain, an LLM tags each into **areas** (`product/concern`) and flags within-area **overlaps** where two docs may disagree. Output: `.truecourse/specs/corpus.json` (the curated corpus every downstream stage consumes — kept docs + area tags, docs grouped by area, overlap flags, and the relevance-dropped docs; committable) and `.truecourse/specs/decisions.json` (the user's resolutions: `manualAreas`, `manualIncludes`, `manualExcludes`, and conflict verdicts — committable).

Only genuine within-area **disagreements** flag as overlaps — docs that agree never surface. You resolve them in the dashboard's Guard → Coverage tab or via `spec conflicts` (pick a side or dismiss).

**2. Guard generation** (`truecourse guard generate`) — Splits each kept doc into sections and, per section: **classifies** whether the section makes a claim a driver can assert (two drivers today — `cli` invokes your project's binary, `api` drives your HTTP service; a non-testable verdict carries a one-sentence reason and surfaces as a visible coverage gap), **authors** one or more declarative YAML scenarios from the section's claim plus the code, and **birth-validates** each one by running it immediately — the outcome becomes the test's status. Every authored test is committed, so a test that fails at birth (the spec and the code already disagree) lands as a **failing test** you can open, re-run, and resolve, not as a separate species of report entry. Output, all committable: `.truecourse/scenarios/<area>/*.yaml` (the scenarios), `scenarios/recipe.json` (how to build/prepare the repo for a run), and `scenarios/manifest.json` (section ↔ scenario bindings + section fingerprints, so re-generates only touch changed sections).

**3. Guard run** (`truecourse guard run`) — Fully deterministic: builds the repo via the recipe, executes every committed scenario — including the ones that were already failing at birth — and writes the run to `.truecourse/guard/` (per-run snapshots, `LATEST.json`, per-failure evidence transcripts). A test that was red at birth simply comes back green once the code catches up. Exits non-zero on any drift, so it drops straight into CI. No LLM, no API key, no `claude` binary.

**Not every red test is drift.** A scenario walks a flow: some steps assert a spec claim (they carry a milestone), others only prepare the world — the seeding request at the head of a flow, a login. When the step that fails is one of the *preparation* steps, the run annotates the result **blocked precondition**: the scenario still fails, but the documented behavior was never actually exercised, so the fix is the setup (seed the row, declare the fixture, supply the credential), not the code. The CLI prints it on its own line under the failure and the dashboard marks the test "setup failed", distinctly from a real expectation mismatch. It is an annotation only — it never changes an outcome and never softens a CI gate.

The section ↔ scenario binding is **bidirectional**: code changed → its scenarios fail (code-side drift); a spec section edited → its scenarios go stale (spec-side drift). The spec document itself becomes the coverage UI — every section visibly carries its proof and its status.

## What it catches

Any documented behavior a scenario can drive and assert (today through your project's CLI or its HTTP API; web/tui drivers are planned): wrong responses and exit codes, missing or mistyped output fields, illegal state transitions, bypassed validation and auth rules, silently-dropped side effects, formulas producing wrong results — plus the reverse direction: spec sections whose scenarios went stale because the docs changed out from under them.

## Setup

The spec, the scenarios, and a guard baseline are committable so they travel with the repo; everything else is local-only. Per-repo layout under `.truecourse/`:

```
.truecourse/
├── specs/                  ← curated corpus (committable)
│   ├── corpus.json          ← kept docs + area tags, docs-by-area, overlap flags, dropped docs
│   └── decisions.json       ← user resolutions: conflict verdicts + manual areas + manual includes/excludes
├── scenarios/               ← the guard scenario corpus (committable)
│   ├── recipe.json           ← how to build/prepare the repo for a run
│   ├── manifest.json         ← section ↔ scenario bindings + section fingerprints
│   └── <area>/*.yaml         ← the scenario tests
├── guard/                   ← guard run store (mirrors analyze; `truecourse guard run`)
│   ├── runs/                 ← per-run snapshots (gitignored)
│   ├── LATEST.json           ← current run state (committable)
│   ├── history.json          ← per-run summaries (gitignored)
│   ├── evidence/<runId>/     ← per-failure transcripts (gitignored)
│   └── result.json           ← last `guard generate` summary (gitignored)
└── .cache/                  ← LLM caches (gitignored)
```

Like analyze, `guard/LATEST.json` is the committable baseline — commit it after merging to `main` (re-run `truecourse guard run`, commit the result), not from feature branches.

### The recipe — `scenarios/recipe.json`

The recipe tells guard how to build your repo and what binary the scenarios exercise:

```json
{
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm turbo build --filter=...{./tools/cli}",
  "entry": ["node", "tools/cli/dist/index.js"],
  "env": { "MY_FLAG": "1" }
}
```

- `install` *(optional)* — one shell command, run in the repo root before every build, to fetch
  dependencies (e.g. `npm ci`). Needed wherever the tree is a fresh checkout with no
  `node_modules`; omit it when the build needs no dependency fetch.
- `build` — one shell command, run in the repo root before scenarios execute.
- `entry` — the entrypoint argv for `cli` scenarios; each scenario's command is appended to it.
  Repo-relative. Optional when the repo only has `api` scenarios.
- `env` *(optional)* — extra environment variables for every scenario run.
- `api` *(optional)* — the api driver's preparation, for repos whose specs describe an HTTP
  service. `serve` is the argv that starts the server (the runner allocates a free port and
  injects it as `PORT`, then boots one fresh server per scenario in that scenario's sandbox
  cwd — state files written there are isolated per scenario); `healthPath` (default `/`) is
  polled until it answers 2xx (budget `readyTimeoutMs`, default 30s); `env` adds server-only
  variables; `services` *(optional)* holds one-shot `up`/`down` shell commands (run once per
  run, in the repo root) for datastores the server needs — guard runs your commands, it does
  no container orchestration itself:

  ```json
  {
    "build": "pnpm build",
    "api": {
      "serve": ["node", "dist/server.js"],
      "healthPath": "/health",
      "services": { "up": "docker compose up -d db", "down": "docker compose down" }
    }
  }
  ```

  Servers that don't read `PORT` take the number where they expect it: write the literal
  `${PORT}` anywhere in the `serve` argv or in an `api.env` value and the runner substitutes the
  port it allocated for that boot (e.g. `"serve": ["uvicorn", "app.main:app", "--port", "${PORT}"]`
  or `"env": { "ASPNETCORE_URLS": "http://127.0.0.1:${PORT}" }`). The recipe keeps the template,
  so a port allocation never changes the recipe fingerprint.

  Api scenarios then drive the booted server with `request` steps (method/path/headers/body),
  assert on `status`, `headers`, `body`, and JSON paths (`json`), and chain calls by
  `capture`-ing values from responses into `${var}` placeholders — from the JSON body via
  `capture` (a dotted path) or from a response header via `captureHeaders`
  (`{ "next": "Location" }`, case-insensitive; redirects are never followed, so a 3xx's
  `Location` is observable). Both feed the same `${name}` namespace, and a path or header that
  isn't there fails the step.

  **Cookies are automatic.** Every scenario gets its own cookie jar for the life of its server:
  whatever a step's response sets via `Set-Cookie` is replayed on the scenario's later
  requests, honoring `Path`, `Max-Age`, and `Expires` — so a session-cookie login is just a
  first step, with nothing to declare and nothing to capture. The jar is never shared between
  scenarios (each boots a fresh server, so a sibling's login can't authenticate yours), and a
  step that writes its own `Cookie` header overrides the jar for that one request. `Secure` is
  ignored on purpose (the server under test is loopback http); `HttpOnly` and `SameSite` are
  browser concepts with nothing to enforce here.

  `credentials` *(optional)*
  names request-header secrets the runner injects where a scenario writes `{{cred:<name>}}`
  (each `header` + a `value`/`valueFromEnv`/`fromRequest` source, never committed into a
  scenario); an
  optional `satisfies` on a credential names the OpenAPI security scheme it fulfills, so
  guard generate maps that scheme to it directly instead of inferring from the header.
  A `satisfies` naming a scheme **no** OpenAPI doc in the corpus declares is a typo that
  would silently un-map the scheme, so `guard generate` **refuses to run** and names the
  credential, the bad key, and the known scheme names (`guard recipe` shows the same
  verdict); if the corpus has no OpenAPI doc at all it is a warning, not a stop.
  `seed` *(optional)* mints credentials and fixtures at run time — see
  [Seeding](#seeding--apiseed) below.

  **`fromRequest` — log in instead of writing a seed script.** When all a repo needs is "call
  the login endpoint, use what it returns", a credential can name that call directly and skip
  `api.seed` entirely:

  ```json
  {
    "api": {
      "serve": ["node", "dist/server.js"],
      "credentials": {
        "owner": {
          "header": "Authorization",
          "description": "org owner",
          "fromRequest": {
            "method": "POST",
            "path": "/auth/login",
            "json": { "email": "dev@example.com", "password": "devpassword" },
            "capture": "token",
            "template": "Bearer ${value}"
          }
        }
      }
    }
  }
  ```

  The runner makes that one call once per run — after `services.up` and the seed, against the
  server it already booted to health-check the build — and the captured value becomes the
  credential. `capture` is a dotted path into the JSON response body (`""` is the whole body);
  use `captureHeader` instead when the token rides a response header. `template` is **opt-in**:
  without it the captured value is injected **verbatim**, so write `"Bearer ${value}"` when the
  API expects a scheme (the Authorization shape warning below will tell you if you forgot).
  A login that can't be reached, times out, or comes back without the declared value stops the
  whole run as **`credential-request-failed`** — never a silent un-authenticated run.

  **What survives.** The same contract `api.seed` carries, and it matters here: guard boots one
  fresh server *per scenario*, so a token minted against the preflight server is still valid
  only if the auth state outlives that process. A **stateless signed token** (a JWT signed with
  a static secret, verifiable by any instance) is the case this is built for, as is a session
  row in an external datastore `services.up` brings up. An app that keeps sessions in process
  memory will 401 in every scenario — seed a real store, or log in inside the scenario itself
  (the cookie jar makes that a one-step affair). Finally: `fromRequest` lives in committed
  `recipe.json` and enters the recipe fingerprint whole (unlike an inline `value`, which is
  stripped), so a changed login path re-plans authoring — point it at a development account the
  repo already commits, never a real password.

  A credential value is injected **verbatim** into its header, so a value destined for
  `Authorization` that does not begin with an auth-scheme token (`Bearer `, `Basic `, …)
  is almost always a raw token that will 401 on every request: the run **warns** at start
  (naming the credential, never the value) and carries on. Seed-minted values are checked
  the same way.

It's discovered **once**, on your first `guard generate`, and never touched again. Discovery tries
a **deterministic proposer first**: for a simple single-app repo (JS/TS, Python, C#) it reads your
own declarations — the committed lockfile (`npm ci` / `pnpm install --frozen-lockfile` /
`yarn install --immutable` / `uv sync` / `poetry install` / `pip install -r requirements.txt`), the
build script (else the `"true"` no-op; .NET restores in-build), a plain `scripts.start` argv or the
`uvicorn` / `flask` / `manage.py` / `dotnet run` invocation its framework implies, `bin` for the cli
entrypoint, the derived route surface for the health path, a datastore-declaring `docker-compose`
file for `services`, and your OpenAPI `securitySchemes` for **credential stubs** (a `valueFromEnv`
name and a printed TODO — never a fabricated secret). Anything ambiguous — a workspace monorepo,
two ecosystems at the root, several `bin` entries, a `start` script that is really a watcher — falls
back to the **LLM proposer**. Either way the ENGINE verifies before anything is written: it runs the
install and build, probes the cli entrypoint, and boots the api server to its health path, so a
recipe on disk is one that actually worked. It is otherwise —
**the file is yours to edit**: an existing `recipe.json` always wins, and it's committed so the
whole team runs the same preparation. Edit it when the discovered command isn't what you want —
for example, if your build tool's cache can serve stale output across branch switches, harden the
build (`turbo build --force …`, or a clean step) at the cost of slower runs. Recipe edits change
the recipe fingerprint, so the dashboard flags runs made under an older recipe.

`truecourse guard recipe` is the recipe's own command, so you never have to wait for a generate to
see or change it. With no flags it prints the recipe as loaded (inline credential values masked;
`valueFromEnv` names shown), whether it parses, and whether its discovery inputs have moved since
the last run. `--init` derives one for a repo that has none, and `--refresh` re-derives over an
existing one — replacing it only if the new recipe verifies, and printing a diff of what changed
(no backup file: `recipe.json` is committed, so git is the undo). Both are **non-interactive** —
they never prompt, and whatever discovery couldn't decide (a credential's env var, a security
scheme with no mappable header) prints as a TODO list.

### Seeding — `api.seed`

Some claims can't be asserted from an empty database: they need a real account, a real token, or
a row that already exists. `api.seed` is the **authenticated one-shot** that mints them — one
command you write, run once per run, whose output the whole run reuses:

```json
{
  "build": "pnpm build",
  "api": {
    "serve": ["node", "dist/server.js"],
    "healthPath": "/health",
    "services": { "up": "docker compose up -d db", "down": "docker compose down" },
    "seed": {
      "command": "node scripts/guard-seed.mjs",
      "provides": {
        "credentials": {
          "owner": { "header": "Authorization", "description": "org owner", "satisfies": "bearerAuth" }
        },
        "fixtures": { "org": ["id", "slug"] }
      }
    }
  }
}
```

- `command` — one shell command, run in the repo root.
- `provides` — the **static declaration**: what the seed is promising to emit. It is the catalog
  authoring sees and the contract the runner validates the seed's output against. Note what is
  *not* here: no values. A declared credential carries only its `header`, an optional
  `description` (a short phrase naming the principal — "org owner", "regular member" — so
  authoring picks the right one for a role-sensitive claim), and an optional `satisfies` (the
  OpenAPI security scheme it fulfills, exactly like a static credential). Fixtures are
  `name → [field, …]` — the field names scenarios may reference. Because no runtime value is
  declared, no secret ever reaches `recipe.json` or the recipe fingerprint; changing `provides`
  *does* re-key authoring, since it changes what scenarios can be written against.
- A credential name may not be declared in **both** `api.credentials` and
  `api.seed.provides.credentials` — one name has exactly one source, and the recipe fails to
  load otherwise.

**The manifest.** The runner sets `GUARD_SEED_OUT` to a temp file path; the command writes its
results there as JSON:

```json
{
  "credentials": { "owner": { "value": "Bearer eyJhbGci…" } },
  "fixtures":    { "org": { "id": 42, "slug": "acme" } }
}
```

Every declared credential must come back with a non-blank string `value`, and every declared
fixture field must be present — a gap is a hard **`seed-failed`** stop that names what's missing,
never a silent skip (as is a non-zero exit, a timeout, a missing file, or unparseable JSON; the
command's combined stdout + stderr tail rides the message). Keys the recipe never declared are
ignored with a warning. Fixture values keep their **native JSON type** — a manifest number stays
a number.

**When it runs.** Once per run, in the repo root, only when the run has api scenarios to execute:
after `api.services.up` (so migrations and the datastore are ready) and **before any server
boots**. It runs with the server's environment — the recipe-level `env` merged with `api.env` —
so a `DATABASE_URL` you declared for the server reaches the seed too, and both talk to the same
store.

**Using it in scenarios.** Seeded credentials merge into the same pool as static ones, so a
scenario writes `{{cred:owner}}` in a header value — credentials resolve in **header values
only**, never in a path or body, and never in an expectation (there a `{{cred:…}}` stays literal
and mismatches loudly). Fixtures are ids and handles, not secrets, so `{{fixture:org.id}}`
resolves **anywhere**: path, query string, header value, request body, and expectation matchers.
When a JSON leaf is *exactly* one placeholder it substitutes the native value, so
`{"orgId": "{{fixture:org.id}}"}` sends the number `42`; embedded in a longer string it renders
as text. Referencing a fixture or field the seed never provided is a scenario error, not a
silent empty string.

**Redaction.** Every resolved credential value — seeded or static — is masked out of all evidence
transcripts and failure output as `«cred:<name>»`, including its JSON-escaped form, so a service
that echoes the header back can't leak it into a transcript. A secret the seed itself echoed
before failing is masked in the `seed-failed` message too. Fixtures are deliberately *not*
redacted: they're the ids you want to read in a transcript.

**What survives, and what doesn't.** Guard boots **one fresh server per scenario**. Seeded state
therefore survives only when it lives in an **external datastore** brought up by
`api.services.up` — a Postgres, a Redis, anything outside the process. An app that keeps its
state in memory loses everything the seed did the moment the next scenario's server starts, and
every `{{fixture:…}}` will point at a row that no longer exists. If your app is in-memory,
either give it a real store for guard runs (via `api.env`) or have each scenario create what it
needs through the API itself.

### External dependencies — reach for your app's own fakes first

Guard scenarios are **hermetic**: nothing assumes network access to a third party, and a run that
depends on Stripe or SendGrid being reachable isn't a test, it's a weather report. When the app
under test calls an external service, the recommended first answer is the app's **own** test
doubles — most codebases already have them behind an env flag or a serve flag. Turn them on
through the recipe:

```json
{
  "api": {
    "serve": ["node", "dist/server.js"],
    "env": { "PAYMENTS_FAKE": "1", "EMAIL_TRANSPORT": "memory" }
  }
}
```

That keeps the fake under the app team's control, where it already tracks the real integration.
When the app has no fake of its own but *does* read the dependency's base URL from an env var,
the second answer is a scenario-declared stub — see [`setup.http`](#scripted-third-party-stubs--setuphttp)
below. Claims that genuinely can't be driven without a third party settle as visible `blocked-on`
coverage gaps rather than fabricating a pass — guard would rather show you the hole. The hole is
**named**: `guard generate` detects which third-party SDKs the repo imports (stripe, sendgrid,
s3, …) from the analysis pass it already runs, tells the authoring model about them, and stamps
them into the gap — so a blocked flow reads `blocked on stripe: <claim>` and `guard status`
breaks the blocked count down per service instead of one opaque "external-service" bucket. The
full detected list also rides `guard/result.json` (`externalServices`) and the dashboard's
generate overview. The other recurring hole has a canonical name too: when what's missing is
**pre-existing data** — a record the API can't create through its own endpoints and no fixture
provides — the flow settles on `missing-data` plus the entity it needed (`blocked on
missing-data, an already-cancelled booking: <claim>`), which the dashboard reads as "needs seed
data" and counts as one bucket instead of scattering across free text.

### Scripted third-party stubs — `setup.http`

Some claims are *about* the third party: "an unmapped upstream code still succeeds", "an upstream
5xx becomes a 502 that leaks nothing", "we never call the payment API in dry-run mode". A scenario
can declare a **stub** for that dependency — a loopback HTTP server the runner boots **before** the
app starts, scripted with exactly the responses the flow needs. It works whenever the app reads the
dependency's base URL from an **env var**; the stub's origin is substituted into `setup.env` as
`${HTTP_STUB:<name>}`.

```yaml
setup:
  env:
    FORECAST_BASE_URL: ${HTTP_STUB:forecast}   # the app's own base-URL override
  http:
    forecast:
      routes:
        - method: GET
          path: /v1/forecast                    # exact pathname (or one trailing `/*`)
          status: 200
          json: { current: { weather_code: 4 } } # the scripted upstream response
          expect:                                # …and what the app MUST have sent
            query: { timeformat: unixtime, temperature_unit: celsius }
            headers: { accept: application/json }
          calls: 1                               # exactly once — no retries
steps:
  - request: { method: GET, path: /v1/weather?lat=52.52&lon=13.41 }
    expect:
      status: 200
      json:
        current.condition: { equals: unknown }
```

**Both halves are asserted.** Responses are scripted, and `expect` (`bodyContains`, `query`,
`jsonPath`, `headers`) checks the request the app sent — so "the app called the third party
wrongly" is a red test, not an invisible pass. `calls` pins the exact number of hits; `calls: 0`
asserts the app *never* touches that route.

**A call nothing scripted fails the scenario**, naming the method and path received
(`unmatched: "404"` on the stub relaxes that to "answer 404 and say nothing"). A scenario passes
only when its steps pass **and** its stubs saw exactly what was declared; a stub violation is
reported on the step it happened during, with the received request in the evidence transcript
(resolved credentials the app forwarded upstream are masked as `«cred:<name>»` like everywhere
else). A stub that can't start — or a `${HTTP_STUB:…}` naming a stub the scenario never declared —
is an **error**, never a silent skip.

Stubs are available to both drivers (a CLI that calls a service over HTTP reads a base URL from
the environment too), and a third party with **no** base-URL override stays an honest
`blocked-on` gap.

## Commands

```bash
# Spec consolidation (docs → curated corpus)
truecourse spec scan                              # Curate docs into corpus.json (areas + overlap flags)
truecourse spec status                            # Summary: docs, areas, open vs resolved overlaps

# Conflict resolution — flagged within-area overlaps
# (agent-friendly; also available in the dashboard Spec tab)
truecourse spec conflicts list                    # List flagged within-area overlaps
truecourse spec conflicts show <area>             # An area's overlapping docs with prose excerpts
truecourse spec conflicts resolve <n|area> \      # Pick a side or dismiss a detector false-positive
  --right <doc> | --dismiss [--note <text>]
truecourse spec docs list                         # List the kept (corpus) docs + area tags
truecourse spec docs skipped                      # Docs the relevance filter excluded
truecourse spec docs include <path>               # Force-include a skipped doc (re-scans)
truecourse spec docs uninclude <path>             # Remove a force-include override
truecourse spec docs exclude <path>               # Force-exclude a kept doc (re-scans)
truecourse spec docs unexclude <path>             # Remove a force-exclude override

# Guard — spec-section-bound scenario tests (author once, run deterministically)
truecourse guard generate                         # Author scenarios from spec sections (classify → generate → birth-validate)
truecourse guard run                              # Build via the recipe + run committed scenarios; exits non-zero on any drift (CI gate)
truecourse guard run --scenario <id>              # Run a single scenario
truecourse guard run --verbose                    # List every scenario result (one ✓ line per pass; default shows failures only)
truecourse guard recipe                           # Show the preparation recipe (secrets masked) + whether its inputs drifted since the last run
truecourse guard recipe --init                    # Derive, verify and write a recipe for a repo that has none (non-interactive; prints TODOs)
truecourse guard recipe --refresh                 # Re-derive over an existing recipe; replaces it only if it verifies, printing the diff
truecourse guard flows                            # List the synthesized flows with per-surface coverage (--show <id> for one flow's detail)
truecourse guard status                           # Compact summary: section coverage, last run, last generate (LLM-free, no re-run)
truecourse guard drifts                           # List the latest run's non-pass scenarios, most severe first (paginated; --all / --offset / --json)
```

---

# Dashboard (web UI)

One web UI for both capabilities — browse code findings and business-logic drift side by side, with the architecture graph, analytics, and the spec-curation + guard workflow.

```bash
truecourse dashboard                  # Start + open the dashboard
truecourse dashboard --reconfigure    # Re-prompt for console vs background service mode
truecourse dashboard stop             # Stop the dashboard
truecourse dashboard status           # Show dashboard status
truecourse dashboard logs             # Tail dashboard logs (service mode only)
truecourse dashboard uninstall        # Remove the background service
```

- **Code Analysis** — architecture graph, violations list, severity/category analytics, code hotspots, trend over time; toggle rules and silence noisy ones inline.
- **Guard** — Coverage shows each spec doc's sections with their scenario coverage and walks you through resolving spec conflicts (pick / write custom / mark superseded / include skipped doc); Scenarios lists the committed scenario corpus with the recipe and last-generate summary; Runs shows each run's drifts with per-failure evidence.

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
| C# | Supported * |
| Go | Planned |
| Rust | Planned |
| PHP | Planned |

\* Analyzing C# requires the .NET 8 SDK — its **semantic** rules run in a Roslyn host (build-required; analysis fails fast without it). See [Prerequisites](#prerequisites).

## Prerequisites

- Node.js >= 20
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on your PATH — optional. The default `cli` transport spawns it for LLM-powered work; deterministic rules, [API mode](#llm-transport-claude-code-or-api), and the `agent` transport don't need it.
- [.NET 8 SDK](https://dotnet.microsoft.com/download) — **required to analyze C#** (not needed for other languages). C#'s semantic rules run in a Roslyn host you build once (`dotnet build -c Release tools/csharp-roslyn-host`, or point `TRUECOURSE_ROSLYN_HOST` at a prebuilt binary). Analyzing a repo that contains C# without the host **fails fast** with a build-the-host message — there is deliberately no tree-sitter-only fallback, since a silent half-analysis is worse than a clear error.

## LLM transport (Claude Code or API)

Every LLM-powered step — `analyze`'s LLM rules, and the whole Spec → Guard pipeline (`spec scan`, `guard generate`) — reaches the model through a pluggable **transport**:

| Mode | How it reaches the model | Needs |
|---|---|---|
| **Claude Code** — `cli` *(default)* | spawns `claude -p …` per call | the `claude` binary on PATH, signed in. No API key. |
| **API** — `api` | calls your provider directly: **Anthropic, OpenAI, AWS Bedrock, or GitHub Copilot** | a model id + an API key. No `claude` binary. |
| **`agent`** | a **filesystem mailbox** under `--io <dir>` | nothing — no `claude` binary, no API key |

The choice between Claude Code and API is a **saved, per-user setting**; `agent` is a per-run mode for an orchestrating agent (below). All three send identical prompts and parse identical schema-validated JSON — only the delivery differs.

### First run

The very first `truecourse` command you run — whichever it is — asks once and saves the answer:

```
◆ How should TrueCourse run its LLM calls?
│ ● Claude Code (recommended)   uses your existing Claude Code login, per-stage model tiers, no API key needed
│ ○ API — bring your own key    Anthropic, OpenAI, AWS Bedrock, GitHub Copilot
```

**Claude Code** saves the choice and continues into your command. **API** walks provider → model → API key → optional fallback model and base URL, then makes one live call to prove the configuration works — a configuration that fails its probe is never saved. In a non-interactive shell (CI, scripts, git hooks) nothing is asked and nothing is written: Claude Code stays the default, exactly as before.

### `truecourse config llm`

```bash
truecourse config llm setup            # Re-run the wizard: pick the transport, store API credentials
truecourse config llm show             # Active transport, saved API config (key masked), per-stage models
truecourse config llm test             # One live call against the saved API configuration
truecourse config llm use <mode>       # Flip the saved transport: claude-code | api
```

`setup` takes flags for non-interactive use (CI, dotfiles) — passing `--transport` skips every prompt:

```bash
truecourse config llm setup --transport claude-code

truecourse config llm setup --transport api \
  --provider anthropic --model claude-sonnet-4-5 --api-key-stdin < key.txt

truecourse config llm setup --transport api \
  --provider openai --model gpt-4o --api-key-env OPENAI_API_KEY --no-test
```

| Flag | What it does |
|---|---|
| `--transport <claude-code\|api>` | what to save; its presence is what makes the run non-interactive |
| `--provider <anthropic\|openai\|bedrock\|copilot>` | required in api mode |
| `--model <id>` | required in api mode — every stage runs on it |
| `--fallback-model <id>` | tried once if the primary call errors |
| `--api-key-stdin` | read the key from stdin (recommended) |
| `--api-key-env <VAR>` | store the *name* of an env var; the key is read fresh on every run |
| `--api-key <key>` | discouraged — it stays in your shell history (the command warns) |
| `--base-url <url>` | gateway or self-hosted endpoint speaking the provider's protocol |
| `--header <k=v>` | extra request header (repeatable) |
| `--region` / `--access-key-id` / `--secret-access-key` / `--session-token` | Bedrock; omit any of them to fall through to the ambient AWS credential chain |
| `--no-test` | save without the live provider probe (air-gapped setups) |

### Where the selection lives

`~/.truecourse/config.json` — per-user, written `0600` inside a `0700` directory, deliberately **not** the committable per-repo `.truecourse/config.json`. `TRUECOURSE_HOME` relocates the whole directory.

```jsonc
{
  "llm": {
    "transport": "api",                     // "claude-code" (default) | "api"
    "api": {
      "provider": "anthropic",              // anthropic | openai | bedrock | copilot
      "model": "claude-sonnet-4-5",         // required in api mode — every stage runs on it
      "fallbackModel": "claude-haiku-4-5",  // optional: tried once if the primary errors
      "apiKey": "sk-ant-…",                 // optional: omit to take the key from the environment
      "apiKeyEnv": "MY_KEY_VAR",            // optional: NAME of an env var, resolved on every run
      "baseURL": "https://gateway/v1",      // optional: gateway / self-hosted endpoint
      "headers": { "X-Team": "core" },      // optional
      "region": "us-west-2"                 // bedrock only, with accessKeyId / secretAccessKey / sessionToken
    }
  }
}
```

The `api` block persists even while `transport` is `claude-code`, so flipping between the two never re-asks for credentials.

**Where the key comes from**, in order: `llm.api.apiKey`, then the variable named by `llm.api.apiKeyEnv`, then the provider's standard variable — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `COPILOT_API_KEY`. Bedrock has none of these: omitted credentials fall through to the ambient AWS chain. Store no key at all and TrueCourse reads it from the environment on every run.

**`TRUECOURSE_LLM_TRANSPORT=claude-code|api`** overrides the saved selection for a single run or a CI job.

In API mode nothing shells out to `claude`, so its login preflight is skipped; instead an unusable provider configuration aborts up front — before any pipeline work or cost — with a pointer to `truecourse config llm setup`. Credentials are entered through the CLI or the config file only: the dashboard reads the selection (so dashboard-triggered scans, generates, and analyses use the same one) but never edits it.

### Per-run override — `--llm-transport`

`--llm-transport <cli|agent|api>` overrides the saved selection for one command: `cli` forces Claude Code, `api` forces the configured provider, `agent` uses the mailbox.

In **`agent`** mode the tool doesn't call the model itself: for each prompt it writes `requests/<id>.json` (`{ stage, system, user, schema, … }`) into the `--io` directory and waits for a matching `responses/<id>.json` (`{ text }`). An **orchestrating agent that is itself an LLM** — e.g. a [Claude Code routine](https://code.claude.com/docs/en/routines) — watches that directory and answers each prompt. This lets guard generation and `analyze`'s LLM rules run **inside a headless cloud session with no `claude` binary and no API key**.

```bash
# whatever you selected at first run
truecourse analyze --llm
truecourse guard generate

# force one mode for this run
truecourse analyze --llm --llm-transport api
truecourse spec scan      --llm-transport cli

# agent transport: the tool parks prompts in ./io and an external agent answers them
truecourse analyze --llm --llm-transport agent --io ./io
truecourse spec scan      --llm-transport agent --io ./io
truecourse guard generate --llm-transport agent --io ./io
```

Accepted by: `analyze`, `spec scan`, `guard generate`. (On `analyze`, `--llm` / `--no-llm` is a *separate* flag — it decides **whether** LLM rules run; `--llm-transport` decides **how** to reach the model.)

## Configuration

In Claude Code mode TrueCourse talks to the model via the `claude` CLI. You can tune how that interaction behaves — which binary to invoke, which model to pass, timeouts, retries, and how many `claude` processes to run in parallel — through environment variables. (They apply to Claude Code mode only; in [API mode](#llm-transport-claude-code-or-api) the provider config carries the equivalent settings.)

For packaged installs (`npx truecourse` or `npm install -g truecourse`), the simplest place to set them is `~/.truecourse/.env`. The file is loaded automatically on every invocation:

```
CLAUDE_CODE_BINARY=claude             # override the `claude` binary on PATH (CLAUDE_CODE_BIN also accepted)
CLAUDE_CODE_MODEL=                    # Claude Code --model flag (empty = default)
CLAUDE_CODE_TIMEOUT_MS=120000         # per-call timeout (ms)
CLAUDE_CODE_MAX_RETRIES=2             # retry attempts on parse/validation failure
CLAUDE_CODE_MAX_CONCURRENCY=10        # max concurrent `claude` processes per run
```

Every command that uses Claude (`analyze` with LLM rules, `spec scan`, `guard generate`) runs a quick up-front preflight: it makes one tiny `claude` call to confirm the CLI is installed and logged in, and aborts with the CLI's own error message if not — so an expired login is caught immediately instead of failing every extraction subprocess at the end of a long run. In API mode that preflight is skipped and the saved provider configuration is validated instead. `CLAUDE_CODE_BINARY` is the canonical way to point at a non-default binary; `CLAUDE_CODE_BIN` is honored as a legacy alias.

**`CLAUDE_CODE_MAX_CONCURRENCY`** caps how many Claude CLI processes TrueCourse spawns in parallel during a single run. Default `10`. Raise it on CI runners with spare headroom; lower it on resource-constrained machines (e.g. 8 GB laptops, shared VMs) to avoid OOM on large repos. Must be a positive integer.

For a one-off override, prefix the command:

```bash
CLAUDE_CODE_MAX_CONCURRENCY=2 truecourse analyze
```

### Per-stage model selection

Each LLM-powered pipeline stage resolves its model independently, so you can run cheap stages on Haiku and reserve Opus for scenario generation. Resolution precedence: `TRUECOURSE_MODEL_<STAGE>` (per-stage) › `TRUECOURSE_MODEL` (global) › `.truecourse/config.json` (`llm.stages.<id>`) › `llm.api.model` (API mode only) › the built-in default. `truecourse config llm show` prints the effective model + source for every stage.

The built-in defaults below are Claude Code tier aliases, which mean nothing to a provider API — so in API mode your one configured `llm.api.model` takes their place and runs every stage. The explicit overrides above still win; in API mode they must name a model id your provider accepts.

| stage | env override | default |
|---|---|---|
| doc relevance keep/drop | `TRUECOURSE_MODEL_SPEC_RELEVANCE` | haiku |
| area tagging | `TRUECOURSE_MODEL_SPEC_AREA_TAG` | sonnet |
| overlap flagging | `TRUECOURSE_MODEL_SPEC_OVERLAP` | haiku |
| guard section classify/extract | `TRUECOURSE_MODEL_GUARD_EXTRACT` | sonnet |
| guard scenario generate | `TRUECOURSE_MODEL_GUARD_GENERATE` | opus |
| guard recipe derivation | `TRUECOURSE_MODEL_GUARD_RECIPE` | sonnet |

`TRUECOURSE_FALLBACK_MODEL` sets the `--fallback-model` used when the primary is overloaded (in API mode `llm.api.fallbackModel` is the last resort). `TRUECOURSE_MAX_CONCURRENCY` caps concurrent LLM calls across every stage (default `min(cpus, 4)`) and the guard runner's parallel scenario sandboxes. `TRUECOURSE_MAX_API_CONCURRENCY` caps concurrent api-driver scenario boots separately (default `min(TRUECOURSE_MAX_CONCURRENCY, 3)`, clamped to it): an api scenario boots a whole target server that lives for the scenario, so running boots at the full sandbox width can starve the host — this bounds the number of resident servers. The api and cli pools SHARE the `TRUECOURSE_MAX_CONCURRENCY` budget, so a mixed-driver recipe never runs more than that many scenarios in flight at once (the api pool draws from the budget; cli takes the remainder, never throttled below it); a single-driver run uses the whole budget for that driver. `TRUECOURSE_LLM_TIMEOUT_SCALE` multiplies every stage's per-call timeout by a float (default `1`); a slow model or proxy that trips the built-in ceilings can widen them all with one knob — e.g. `TRUECOURSE_LLM_TIMEOUT_SCALE=3` for a slow proxy. `TRUECOURSE_LLM_LOG` / `TRUECOURSE_LLM_DUMP` enable per-call logging.

### Which documents are scanned

`truecourse spec scan` discovers every markdown file in the repo — `.md`, `.mdx`, `.markdown`, `.mdown`, and `.mkd` — outside build and vendor directories. MDX is scanned like any other markdown: headings, prose, and fenced code are read normally, and JSX is passed through untouched, so docs sites built on Mintlify, Docusaurus, or Nextra are covered without extra configuration.

**OpenAPI / Swagger documents are auto-detected as spec sources too.** A `.yaml`, `.yml`, or `.json` file whose top level declares an `openapi` or `swagger` version is admitted into the corpus automatically — structurally, without the relevance filter — and each of its **operations** (an HTTP method on a path) becomes a guardable spec section: `guard generate` authors `api`-driver scenarios against them, and `guard run` flips a scenario stale when its operation is edited (or orphans it when the operation is deleted). Ordinary `.json`/`.yaml` config — `package.json`, `tsconfig.json`, lockfiles, compose files — is never mistaken for a spec (it carries no `openapi`/`swagger` key). **Split specs are supported**: both in-file `$ref`s (`#/…`) and external `$ref` targets (`./schemas/todo.yaml`, `../../shared/spec/responses/error.yaml#/NotFound`) are resolved, so a spec spread across many files (an entry `openapi.yml` referencing per-area path files that reference shared schema files) inlines to the same operation slices its bundled form would produce. External targets are confined to the repo (network, absolute, and directory-escaping refs are never read and stay literal), cycles terminate, and the fully-resolved document is capped at 5 MB.

Files with any other extension (and yaml/json that isn't an OpenAPI doc) are never discovered, and a force-include (`truecourse spec docs include <path>`) cannot bring one into the corpus — it bypasses the relevance filter, not discovery.

To scan only part of a repo, set `spec.include` globs in `.truecourse/config.json`. Note that scope narrows the set of discovered files (markdown and OpenAPI docs alike); it cannot widen the scan to other file types.

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

TrueCourse collects anonymous usage data to improve the product — one event per command (`analyze`, `spec_scan`), each carrying only coarse, bucketed counts (file/finding *ranges*, duration range), the surface (CLI vs dashboard), OS, and tool version. No source code, file paths, identities, or violation details are collected. It is automatically disabled in CI environments.

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
pnpm build              # Build all packages — required before the first `pnpm test` (tests resolve workspace packages from their dist/)
dotnet build -c Release tools/csharp-roslyn-host   # One-time, needs the .NET 8 SDK — see note below
pnpm dev                # Start dashboard at http://localhost:3000 (server on :3001, Vite on :3000)
pnpm test               # Run tests
```

`pnpm dev` expects a `.truecourse/` folder at the repo root — created automatically on the first `truecourse analyze` against the repo (or simply `mkdir -p .truecourse`).

The full test suite requires the C# Roslyn host to be built (same requirement as [analyzing C#](#prerequisites)): the C# e2e test fails without it, and the Roslyn semantic-rule tests silently skip. CI builds it before running tests (`.github/workflows/test.yml`); do the same locally, once per checkout/worktree.

## Community

Join the [TrueCourse Discord](https://discord.gg/TanxB63arz) to ask questions, share feedback, and follow what's shipping.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan** — [mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

MIT
