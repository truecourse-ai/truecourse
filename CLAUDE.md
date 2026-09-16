# TrueCourse — Claude Instructions

## Key Files to Keep Updated

- **README.md** — Must reflect the current state of the project. When adding new packages, endpoints, environment variables, or changing the project structure, update the README to match.

## Project Layout

- `apps/dashboard/client/` — Vite + React Router frontend (Tailwind CSS, dark mode)
- `apps/dashboard/server/` — Express + Socket.io HTTP layer that serves the dashboard. Thin adapter over `@truecourse/core`; contains the routes, the sockets, the middleware, the background job types, the two auth modes (`auth/`, see MODES below), the LOCAL FOLDER provider (`local/`) and the server-only services (the run clone, the run watch, the workspace's LLM).
- `apps/landing/` — Public marketing site (Vite + React + Tailwind v4). Standalone, deployed separately. `pnpm --filter @truecourse/landing dev` runs it on port 3100.
- `packages/core/` — The framework-agnostic engine the server runs: the agent-session workstreams (setup, generate, the scan, adjudication), the guard reads every view is composed from, the store SEAMS (guard, spec, context, sessions, registry, overlays), the LLM transport and session-driver construction, the logger and the errors.
- `packages/shared/` — Shared Zod schemas and TypeScript types, plus the engine contracts no package owns alone: the `LlmTransport` seam (`@truecourse/shared/llm`), the document-discovery rules (`.truecourseignore`, the skip list) and the WORK-TREE LAYOUT (`@truecourse/shared/work-tree`) every producer and consumer of a run's `.truecourse/` tree derives its paths from.
- `packages/source-facts/` — The per-file facts the interface mapper reads (tree-sitter WASM + the TypeScript compiler).
- `packages/spec-consolidator/` — The deterministic half of the scan: discovery, prefilter, collision pairing, pointer verification, area grouping, the corpus/decisions stores. Holds no LLM runner and no `LlmTransport` reference.
- `packages/guard-runner/` — The deterministic runner: the recipe, the drivers (CLI, API, web), the world, the evidence, and the readers/writers over a run's `guard/` and `scenarios/` documents.
- `packages/guard-generator/` — The deterministic half of generation: the work plan, the section plan, the recipe proposal, the suppression rules, and the one-shot stages the agent sessions are injected into.
- `packages/interface-mapper/` — The deterministic interface catalog: CLI (tree + probes), API (route registrations, OpenAPI contracts), RPC routers and web places/resources derived from `@truecourse/source-facts`'s per-file facts. Feeds guard setup's `interfaces` step and the interface authoring engine; depends only on `@truecourse/shared` and `@truecourse/guard-runner`.
- `packages/llm-api/` — The direct-API `LlmTransport` (`createApiTransport`) on the Vercel AI SDK: `anthropic | openai | bedrock | copilot`, `generateObject` when the request carries a schema, per-call StageUsage. The only package allowed to import `ai` / `@ai-sdk/*` (enforced by `tests/architecture/ee-import-boundary.test.ts`). Also home to the **api-mode session driver** (`createApiSessionDriver`) — the per-turn loop the agent sessions run on in `api` mode — and the per-provider cache/tool-call tuning table it applies.
- `packages/llm-claude-agent/` — The Agent SDK **session driver** (`createClaudeAgentSessionDriver`): claude-code mode of the agent loop, one streaming-input `query()` subprocess per session, tools as in-process MCP handlers, outcome via native json-schema output. Also the Agent SDK **one-shot transport** (`createClaudeAgentTransport`): claude-code mode's `LlmTransport` for the single-prompt leaf stages (realization match, world classify, claim diff, recipe proposal, visual judge) — one tool-less `query()` per call on the same login, with a rejected rate limit or the harness's synthetic limit notice surfacing as a FAILED call. Operator mode hands it to every run. The only package allowed to reference `@anthropic-ai/claude-agent-sdk` (enforced by the same boundary test), which is an OPTIONAL peer behind a lazy import — never a compile-time dependency (its optionalDependencies drag a ~300MB binary).
- `packages/agent-loop/` — The agent loop, defined in ONE package: the session contract (transcript events, session defs, the `SessionDriver` seam, sessions-store shapes) and the policy shell `runAgentLoop` (budgets, ceilings, resume grants, malformed-outcome policy, seq/ts stamping, depth-1 children). Driver-agnostic by construction — imports neither `ai` nor the Agent SDK nor node builtins; one package per backend implements the seam (`llm-api`, `llm-claude-agent`).
- `packages/core/src/services/guard-setup/` — `guard setup`'s agent sessions, injected into `@truecourse/guard-generator`'s `runGuardSetup` (which stays core-free) by `commands/guard-setup.ts`: `recipe-repair` (loop only on the failure path of deterministic recipe discovery, iterating in one persistent `WorkingSandbox`), `dependency-catalog` (classify the starting state after the deterministic externals skeleton; add-only fold into `scenarios/dependencies.json`), `interfaces-step` + `reconcile-interfaces` (the deterministic interface catalog from `@truecourse/interface-mapper`, a reconcile session that settles tree-vs-probe disagreements, and the `services/interface-author/` engine; the derived catalog is `guard/interfaces.json`, the authored one `guard/interfaces.authored.json`), `seed-session` (prove-by-execution seed authoring against the live services; the fold re-proves the outcome in a fresh world and restores the tree on refusal) and `auth-proof` (one short session per user-registered supplied dependency; proof-class, never cached). `session-context.ts` is the holder of the run record + driver every seam draws from, eager and keyed by repo identity.
- `packages/core/src/services/guard-generate/` — `guard generate`'s agent sessions (claim extraction per doc, flow synthesis per area plus one epic pass, the flow-worker pool that authors and proves each flow's scenarios, the fidelity children), injected into `@truecourse/guard-generator`'s `generateGuards` by `commands/guard-in-process.ts`, which owns the run record and hands the seams its driver. `services/guard-adjudicate/` is the post-run half: one session per failing scenario on the board, classifying it as a bug, a doc drift or a test defect, folded onto the stored run and rendered as the findings report. `services/llm/guard-visual-judge.ts` is the run's one LLM stage — a vision verdict on a failing web step's screenshot, opt-in and annotation-only.
- `packages/core/src/services/spec-scan/` — The spec scan as agent sessions, the loop's first production consumer: `orchestrate` (≤1 scope session whose standing instructions ride every downstream briefing and cache key), `curate-doc` (pooled, one coherent keep/skip/tag judgment per doc — it may page a long doc and peek at a referenced one), `settle-areas` (a true barrier, concurrency 1) and `overlap` (pooled, one session per deterministic COLLISION CLUSTER). `run.ts` is the whole scan: discovery → prefilter → the four steps → the deterministic fold (pointer re-anchoring, cross-area dedup, high-confidence auto-apply) → `writeCorpus`. Two invariants: FAIL-OPEN per item (a dead session never drops a doc), and the ONE-ABORT rule — a kind whose every session died transport-class throws BEFORE anything is written. `@truecourse/spec-consolidator` keeps the deterministic half (discovery, prefilter, collision pairing, pointer verification, area grouping, the corpus/decisions stores); it holds no LLM runner and no `LlmTransport` reference at all.
- `packages/llm/` — `@truecourse/llm`: the LLM-stage cache seam — the content-addressed `KvCacheStore` the engine's runners read to skip re-running the model for unchanged inputs. Its own package because `guard-generator` and `spec-consolidator` read it and cannot depend on core; boot installs the Postgres store over it.
- `packages/db/` — `@truecourse/db`: the Postgres schema (drizzle) + `createDb` (one pool, migrations at boot, a dedicated advisory-lock pool). One schema and one migration history for the whole product.
- `packages/data-store/` — `@truecourse/data-store`: Postgres implementations of core's storage seams (the workspace's specs, context, guard, the guard overlays, the session runs, the `repositories`-derived registry, the LLM KV cache) over a content-addressed `content` table. The CONNECTED REPOSITORIES themselves are here too (`PgRepositoryStore` over the `repositories` table, the contract in `@truecourse/shared`), because a repository can come through any provider. Installed by the dashboard server at boot (`apps/dashboard/server/src/stores.ts`). The jobs and notifications stores live here too (`jobs-store.ts`), consumed by `@truecourse/jobs`.
- `packages/github-app/` — The GitHub App protocol: webhook receiver, connect API, and the App's own rows (`PostgresInstallationStore`: its installations as `provider_accounts` rows, attached to workspaces through `provider_account_links` — GitHub allows one installation per account, so two workspaces reading the same account share the row, while a repository still belongs to one workspace). Connect is the App's user OAuth: the callback exchanges GitHub's code and attaches every installation the person can reach (`oauth.ts`), bound to the session that started the trip by a signed `state` (`connect-state.ts`). The repositories it connects are written through the provider-generic `RepositoryStore` its routers are handed. The webhook handles `installation`, `installation_repositories` and `push`; every other event, `pull_request` included, is authenticated, acknowledged and ignored until the pull request flow is built.
- `packages/jobs/` — `@truecourse/jobs`: the generic background job runner. A Postgres-backed queue (graphile-worker) with a tracked row per job, the shared lifecycle harness (`executeJob`: row bookkeeping, the stepped checklist, the standardized notification, the settled hook), a local cancel registry, the LISTEN/NOTIFY event hub, and the three routers the server mounts (`/api/events`, `/api/jobs`, `/api/notifications`). Enqueues are single-flight per `(workspace, key)`, and an enqueue may also name a QUEUE (graphile's `queueName`) — every job sharing a queue name runs one at a time, in enqueue order, waiting IN the queue as a `queued` row rather than in this process, which is how the dashboard's three heavy repository jobs (`repo.guard-setup` / `repo.guard-generate` / `repo.guard-run`) are rationed to one at a time per workspace while a `context.sync` or `context.scan` still runs beside them. Job TYPES live with their consumer — the dashboard server's are in `apps/dashboard/server/src/jobs/tasks/`.
- `ee/packages/client/` — `@truecourse/ee-client`: the enterprise edition's CLIENT features, registered into the open shell's registries by `src/edition.tsx` — the Settings › Connections tab, Azure DevOps among the repository providers, and the workspace switcher with its Create workspace dialog. Reached only through the client's `@edition` alias (see EDITIONS below).
- `ee/packages/server/` — `@truecourse/ee-server`: the enterprise edition's SERVER features, exported as `eeServerFeatures`. Today that is the three `/api/auth/workspaces` routes behind more than one workspace. Not a process of its own: the open server's entry finds this package beside its tree at boot and registers the list (see EDITIONS below).
- `tests/` — All tests (centralized, not colocated). Organized by package: `tests/shared/`, `tests/core/`, `tests/server/` and `tests/dashboard-server/` (routes and core services), `tests/guard-runner/`, `tests/guard-generator/`, `tests/dashboard-client/`, plus `tests/ee-server/` and `tests/ee-client/` for the enterprise bundle.
- `tests/fixtures/` — Fixture repos the tests drive: `guard-fixture-cli/` (the `relkit` CLI), `guard-fixture-api/` (the `todos` + `api-v2` HTTP servers) and `guard-fixture-web/` for the guard drivers, `recipe-propose/` and `route-manifest-monorepo/` for the deterministic recipe/route derivations

## Development Commands

```bash
docker compose up -d   # Postgres 16 on 127.0.0.1:5432 — the whole of the storage
TRUECOURSE_MODE=local pnpm dev   # Start the client + server (turbo), no sign-in
pnpm build        # Build all packages
pnpm test         # Run all tests (vitest)
pnpm typecheck    # Typecheck every package
```

## Editions

**The product is open except three things**, which live in `ee/` and REGISTER into
the open shell rather than being imported by it: the document Connections
(Settings › Connections and its connectors), repository providers beyond the
open edition's (which is Azure DevOps today), and more than one workspace (the
switcher, Create workspace, and the `/api/auth/workspaces` routes). Everything
else — the engine, sign-in, one workspace with its members, connecting a
repository, Code, Context, Flows, runs and evidence, Agent, Home, Notifications,
and Settings' Members, Repositories and Models — is open.

GitHub is the provider that connects today, and a folder on this machine in
local mode. GitLab and Azure DevOps are listed as coming soon.

**One build, one image, one process entry.** The image carries both editions
and nothing in the Dockerfile or a release script picks one; which edition a
process is comes from whether `ee/` sits beside the open tree.

The dependency runs ONE WAY, from `ee/` inward: no open source file reaches
into `ee/`, and the one seam on each side is pinned by
`tests/architecture/ee-import-boundary.test.ts` — `main.tsx`'s `@edition`
import on the client, `edition-loader.ts` on the server. The client's build
config and stylesheet (`vite.config.ts`, `globals.css`) point the alias and
Tailwind's source scan at the bundle by path; they sit outside the scanned
source roots, so moving the bundle means moving those two lines by hand.

- **Client** — `apps/dashboard/client/src/dashboard/shell/registry.ts` holds the
  three seams (a settings tab, a repository provider, the workspace switcher).
  `main.tsx` imports `registerEditionFeatures` from `@edition`, an alias the
  vite config points at `ee/packages/client/src/edition.tsx` when the checkout
  has one and at `dashboard/shell/open-edition.ts` when it does not, so the
  choice is made when the bundle is built.
- **Server** — `apps/dashboard/server/src/features.ts` is the registry, and
  `apps/dashboard/server/src/index.ts` is the ONE process entry, for every
  edition. Boot's first step after the log is `edition-loader.ts`, which looks
  for `ee/packages/server` beside its own tree (`dist/` built, `src/` under tsx
  and the tests), registers the bundle's exported `eeServerFeatures` when it is
  there, registers nothing when it is not, and logs which edition it found and
  the path it probed either way. A bundle that is present but cannot load or
  exports no feature list stops the boot, naming it. `GET /api/capabilities`
  reports the result as `edition`, and the client's workspace switcher draws
  only when the server says `enterprise`.

## Modes

**A server is TOLD how it runs — `TRUECOURSE_MODE`, `hosted` (the default) or
`local` — and never guesses.** Everything downstream takes the same three things
either way (a session verifier, a public auth router, the workspace's people),
so no route, job or store knows which mode it is in.

- **Hosted** — WorkOS signs people in (`auth/workos-auth.ts`), a workspace is
  the session's organization, and the gate refuses a request with no session.
  The organization on a session is a claim made when its token was minted, so
  the verifier confirms the membership behind it (cached a minute per pair, and
  forgotten at once by the server that removes a member); a session whose
  membership ended runs org-less, and `/api/auth/me` moves it into the user's
  other workspace or leaves it to name one. The client re-probes the session on
  any 401 after load and reloads when the answer moved.
- **Local** — one developer's machine: one implicit person and one implicit
  workspace behind a fixed organization id (`auth/local.ts`, `org_local`), the
  gate answering that session for every request with no cookie to read and no
  WorkOS client built at all. The client learns which it is from
  `GET /api/capabilities` (`mode`), which is public, and hides sign-in,
  sign-out and everything else that assumes an identity provider.

**The LOCAL FOLDER provider** (`apps/dashboard/server/src/local/`) exists only
in local mode: a path on this machine becomes a repository the way a connected
one does — the same `repositories` row, with the folder's absolute path as its
`location` — and every run works on a COPY of it under the run-clones dir
(`createRunCopy`), never on the developer's tree. It has no webhook, so its
documentation re-reads on a Sync now or on the watcher it installs over the
folder. On the client it is a repository provider like any other
(`dashboard/data/providers.ts` → the registry seam), offered only when the server
says it is local.

## Storage

**One storage: Postgres.** `DATABASE_URL` is required in every mode and WorkOS auth in hosted mode only (`createAuth('local')` builds no WorkOS client), and boot (`apps/dashboard/server/src/index.ts` → `stores.ts`) fills every one of core's store seams with its `@truecourse/data-store` implementation over a content-addressed `content` table. The seams exist only because `packages/core` cannot depend on `packages/data-store` — the dependency runs the other way — so nothing is installed by default and a process that never booted fails loud instead of inventing an empty store. A repository exists by being connected — through the GitHub App, or as a folder on this machine in local mode — scoped to its workspace and identified by its key (`owner/repo`, or `local/<folder>`); the rows live in `repositories` (with the provider accounts that brought them in `provider_accounts`), and the "registry" is a live view of that table, not one of its own. A run gets its files through the work-tree seam, which dispatches on the repository's provider: the App clones through an installation, the local provider copies the folder.

Onboarding runs as BACKGROUND JOBS, not inside the request that asked for it: connecting a repo creates NO context source and links none, and enqueues `repo.guard-setup` straight from its link hook, which chains `repo.guard-generate` when its recipe gate held, which chains `repo.guard-run` — the BASELINE RUN — once a scenario set is stored (`apps/dashboard/server/src/jobs/`). What a repository READS is Context's side: sources are made there, the connect dialog's Context step links the ones that already exist, and the FIRST `context.sync` of a repository's own source starts `repo.guard-setup` too when that repository has no setup bundle yet. Generate and Run enqueue their links by hand, and a decision that clears the last block on a generate (the final conflict resolved, the last finding dismissed) enqueues it through the `guard-generate-enqueue` seam. There is NO per-repository scan: documentation belongs to the workspace (see CONTEXT below), and the one Document scan is `POST /api/context/scan`. The routes enqueue and answer `202 { jobId }`; progress rides the repo's socket room (`spec:progress` / `spec:complete`) and the job's own SSE stream. Disconnecting a repo cancels whatever it has in flight.

**A run works on a copy.** There is no persistent working copy: each run clones the repo into an ephemeral per-workspace dir under the runtime directory (`run-clone.service.ts`, swept at boot) and deletes it when the run settles. Because `guard setup` writes files INSIDE that tree, its durable outputs travel as the **setup bundle** — a `guard_setup_sets` row per (repo, commit) over content-addressed bodies (`saveGuardSetupBundle`/`loadGuardSetupBundle`, collected/materialized by `@truecourse/core/services/guard-setup/bundle`): the setup report, the recipe, the dependency catalog and its settle record, the seed script, and the derived and authored interface catalogs with their findings ledger. The job materializes the newest bundle into its clone before running and saves the result after, which is what carries setup's per-step settle spine across commits; `GET /api/repos/:id/guard/setup[?commit=]` reads the report back out of it. The bundle never carries the two overlays (`dependencies.local.json` / `externals.local.json`): a repo keeps its registered instances as ONE encrypted row (`guard_dependency_overlays`, both overlays as one blob under `TRUECOURSE_SECRET_KEY`, the `guard-overlays` seam in core), which every job materializes into its clone beside the bundle and never collects back — a secret enters only through `PUT /guard/dependencies`. That route and `GET /guard/dependencies` compose the working-tree reader over a SCRATCH TREE of the stored state (`lib/guard-read-tree.ts`: the bundle, the scenario set, the generate report, the decisions, the overlays) with an EMPTY host env, and refuse what a hosted repo cannot hold: a `path` / `config-dir` registration (no machine behind it) and a recipe edit (a new variable, a new base-URL variable, an account mode).

`guard generate` is bracketed the same way (`jobs/materialize-guard.ts`): the job materializes the stored spec, the repo's guard decisions, the BASELINE scenario set and report, then the newest setup bundle over them, runs the engine on the workspace transport with a `guard-generate` run record keyed by repo identity, and saves the scenario tree (`guard_scenario_sets`), the report (`guard_results`, flagged `is_baseline` — the job only runs on the default branch) and the birth-finding transcripts under the clone's commit. A corpus with open conflicts stores a blocked `open-conflicts` report and settles as a warning; a cancelled generate stores nothing. The run record is created BEFORE the gates, so a generate a gate stopped (blocked corpus, declined estimate, unusable provider config) is still listed in Activity with its reason.

**CONTEXT — documentation is the WORKSPACE's, not a repository's.** A workspace has SOURCES (`context_sources`: a repository's own markdown, or an llms.txt documentation site), each source yields DOCUMENTS (`context_documents`, bodies content-addressed under `context:ws:<org>`), a SYNC reconciles a source against its scope (`context_syncs`; the `context.sync` job, single-flight per source — on add, on Sync now, on a push to a repository source's default branch, and a daily sweep of the sites), and a repository is LINKED to the sources it reads (`context_bindings`). One ref grammar addresses every document: `context/<sourceId>/<docPath>` (`core/src/lib/context-ref.ts`). The `context.scan` job — one per workspace, single-flight and coalescing — materializes every source's documents into a scratch tree, runs the scan engine over it in UNIVERSE MODE (no repository clone), and stores the corpus, the decisions and a snapshot of every kept document's body as the WORKSPACE spec set (`workspace_spec_sets` under `spec:ws:<org>`, decisions scope `ws:<org>`) — the only curated corpus there is, since a repository's is derived from it on read; its run is recorded under `workspace:<org>`, so it appears on the Agent page with no repository. A repository's corpus is its SLICE — the workspace corpus cut down to the sources it links — derived on read (`GET /api/repos/:id/spec/corpus`) and materialized into every guard job's clone with the documents' bodies under `context/` (`jobs/materialize-spec.ts`). When a scan changed the corpus and no conflict is open, the RIPPLE enqueues Flow setup or Flow generation for every repository whose slice moved (`jobs/context-ripple.ts`). Boot installs the repo-doc reader over both stores: a `context/` ref resolves through the workspace (the live body, else the scan's snapshot) — never from a tree or the provider — and any other ref names no document at all. Every context mutation moves the workspace's changed-at stamp, which `GET /api/context/staleness` (and the per-repository `GET /spec/staleness`) compares against the corpus to draw the amber dot on Context's Scan button.

`guard run` is the last link (`jobs/tasks/repo-guard-run.ts`): the job materializes the baseline scenario set and the newest setup bundle, runs the deterministic runner, and saves the run snapshot as the repo's baseline run (`guard_runs`, `is_baseline`) plus every scenario's evidence bundle — transcripts as text, a browser run's screenshots and session video as BYTES (base64 in the content pool; `readGuardEvidenceBytesAt` decodes by file name) — which `GET /guard/evidence/visuals` and `/guard/evidence/visual` read back. A run also records its COVERAGE beside the snapshot (`guard_runs.sections` / `guard_runs.flows`): every section and every flow as the word it wore then, which is what Home's trend counts and its changes widget follows; a run stored before flows were recorded has its own filled in from its snapshot on the next read. A stored run's envelope carries its provenance — `origin`, and a `pullRequest` the pull request flow will set — and `GET /guard/history?all=1` lists every stored run of the repo with both (the default stays the baseline trend), which is what the connected repo's Runs tab reads. The visual judge (the one LLM call a run can make) is parked behind `TRUECOURSE_GUARD_VISUAL_JUDGE=1` and rides the workspace transport when on.

**Runs and jobs settle together.** A run's record and its sessions' transcripts are rows (`activity_runs` + the append-only `activity_events` journal), which is what the Agent page reads and follows; the job that carried it is a row of its own. A restart kills both, so ONE boot sweep settles them with ONE word: `reconcileStoredRuns()` marks every run a dead process left `running` as `interrupted` (its live sessions `parked`), and the job queue marks its abandoned rows `interrupted` too (`interruptOrphaned`).

**The LLM is per workspace.** Each saves an API provider on the Models page (encrypted under `TRUECOURSE_SECRET_KEY`), probed before every run, and the server threads the resulting transport and session driver into the pipeline call — credentials travel with the run and never become a process default. `TRUECOURSE_LLM_TRANSPORT=claude-code` in the server's env is **operator mode** — every workspace runs on the process's own `claude` login and the Models page is read-only; for a self-hosted single-operator instance only.

### The work tree

The engine reads and writes a `.truecourse/` directory inside a RUN'S WORKING DIRECTORY: the corpus and decisions it scans, the recipe and scenarios it runs, the guard run store and its evidence, the per-stage caches, the run's own LLM diagnostics. A job materializes what a run needs into that tree out of Postgres and collects the result back out; nothing in it outlives the run, is shown to anyone, or is committed.

`packages/shared/src/fs/work-tree.ts` (`@truecourse/shared/work-tree`) owns the LAYOUT — every path inside a work tree is derived there, so its shape is one file's business and no producer or consumer spells a segment itself. It lists the whole tree; add a document by adding it there.

### The runtime directory

Machine-local scratch, never state: the per-run clones a job works in (`run-clones/`), the live progress journals the run watcher tails (`sessions/`), and the server's log (`logs/`). A booting process sweeps what a crashed one left behind. `TRUECOURSE_RUNTIME_DIR` relocates it (the container image points it at its data volume); by default it is `~/.truecourse-runtime`. `TRUECOURSE_LOG_DIR` relocates the log alone. See `packages/core/src/config/runtime-dir.ts`.

### The pre-flight estimate

The LLM estimate (Document scan and Flow generation) is **token + ceiling-cost**: token math is deterministic and offline; cost multiplies the high end of each stage's call range by per-token prices and ignores prompt-caching discounts, so the real bill lands at or below it. The single source is `packages/core/src/services/llm/{token-estimator,spec-estimate,model-prices}.ts`. Both estimates are **cache-aware** and label the subject "N of M … changed"; when nothing changed the estimate has no stages and the confirm is skipped. Prices come from OpenRouter's public model list, fetched at most once a day and held in memory; set `TRUECOURSE_NO_PRICE_FETCH=1` to skip the network and use the bundled list prices (air-gapped; the test suite sets this).

## Rules

- **No workarounds.** Always find and fix the root cause. Do not use hacks, fallbacks, or temporary patches to bypass issues. If something isn't working, investigate why and fix it properly.
- **Dev servers.** Do not start, stop, or restart dev servers. The user manages `pnpm dev` from their terminal. If a restart is needed (e.g. `.env` change), tell the user.
- **Storage.** Everything durable is Postgres, reached through the store seams in `packages/core` (`setGuardStore` / `setSpecStore` / …). Nothing is installed by default: a process that never ran `installDbStores` fails loud rather than inventing an empty store. A run's `.truecourse/` working tree is scratch — never read back after the run settles.
- **No Claude Code session details in commits/PRs/issues.** Never put a `Claude-Session:` trailer or any `https://claude.ai/code/session…` URL into a commit message, PR body, or issue body — strip them before committing or opening the PR/issue. Default commit/PR formatting is otherwise fine.

## Releasing

There is no npm publishing. Creating a GitHub Release (a stable `vX.Y.Z` tag) on a `main` commit deploys production; **Deploy (prod)** dispatch on `main` re-rolls main's HEAD. Both refuse commits not on `main`. Staging deploys from a `deploy-dev` PR label or dispatch (`.github/workflows/deploy-{dev,prod}.yml`). See `infra/azure/vm/DEPLOYMENT.md`.

## Testing

- When running tests, save the full output to a file and read from it — do NOT run tests multiple times with different grep patterns. For example: `pnpm test 2>&1 | tee /tmp/test-output.txt` then read the file.
- The full suite needs `pnpm build` run once first (tests resolve workspace packages from `dist/`) and Playwright's Chromium (`pnpm --filter @truecourse/guard-runner exec playwright-core install chromium`): the guard web-driver suites fail hard without it, by design. CI installs both in `.github/actions/setup`.
- CI runs the suite in 4 shards (`vitest --shard=i/4`) in `test.yml`. Shard assignment is a hash of the file path, so tests must not depend on running in the same process as another file — they already can't, since vitest isolates every file.
- `tests/setup.ts` hides the developer's global/system git config from the whole suite (`GIT_CONFIG_GLOBAL=/dev/null`), so host settings like `commit.gpgsign` can't leak into temp fixture repos. Tests that commit must set `user.name`/`user.email` per-repo. It also pins `TRUECOURSE_RUNTIME_DIR` to a per-process temp dir, so a run's scratch never lands in the developer's home.
- No store is installed by default, so a test installs the seams it reads. `tests/helpers/` holds the doubles: the registry (`test-fixture.ts`), the guard store backed by the run's working tree (`work-tree-guard-store.ts`), the session runs, the LLM cache, the guard overlays, the spec and context stores. Each install helper sets the seam through BOTH module specifiers — `@truecourse/core/…` resolves to `dist` under vitest while `../../packages/core/src/…` resolves to source, and they are separate instances with separate state.

## Conventions

- All tests live in the `tests/` directory at the repo root, not colocated with source files
- Types shared between frontend and backend go in `packages/shared`.
- Every path inside a run's `.truecourse/` working tree is derived in `packages/shared/src/fs/work-tree.ts`. Adding a document to the tree means adding it there, never spelling the segments at the call site.
- A new piece of durable state is a store SEAM in `packages/core` plus its Postgres implementation in `packages/data-store`, installed in `apps/dashboard/server/src/stores.ts`. `packages/core` must never import `packages/data-store`.
