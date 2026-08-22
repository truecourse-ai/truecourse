# One Product Plan: one edition, provider-connected repos, hosted setup, local runner

The plan of record for collapsing TrueCourse into ONE product. Scope: four
decisions, taken together on 2026-08-21, each of which changes the shape of
the codebase:

1. **One edition.** No open-source vs enterprise split in what ships.
   Everyone runs the same product; enterprise features turn on by the
   workspace's PLAN, never by which build was installed.
2. **Repos connect through a source-control provider.** GitHub first,
   GitLab and Azure DevOps behind the same seam. No local git repositories in
   the product, no directory picker, no walking up from a working directory.
   Every connected repo gets a pull-request gate, open-source repos included.
3. **Setup happens online; runs can happen locally.** Spec scan, guard setup,
   scenario generation, interface authoring, adjudication, decisions: all of
   it runs in the hosted product, in the dashboard. There is ONE CLI, and its
   job is to download a connected repo's scenarios, run them on the
   developer's machine, and report the run back online as a local run.
4. **Analyze and contracts are discontinued.** Code analysis (rules,
   violations, the architecture graph, code-derived flows, the diff gate, the
   C# Roslyn host), the `.tc` contract corpus, verify, and infer are deleted
   outright. The only analyzer code that survives is what interface mapping
   needs (parsers, per-file extraction, the service/database/external-service
   detectors).

This document is SELF-COMPLETE for its scope. It sits beside
`docs/AGENTIC_PIPELINE_PLAN.md`, which remains the plan of record for HOW the
spec-to-scenario engine works; §9 of this document lists the amendments that
plan takes from this one. Where the two disagree, this document wins on
product shape (what ships, where it runs, how repos connect) and the agentic
plan wins on engine behavior (sessions, ontology, runner semantics).

STATUS: proposed, awaiting the decisions in §11. Nothing in this document is
implemented.

Working rules, inherited from the agentic plan: design content is
behavior-level ("how it should work"); the inventories in §10 name packages
and commands because a deletion plan cannot avoid naming what it deletes,
but they are inventories, not file-level specifications. Implementation
agents derive their own plans from this document.

---

## 1. Why

- **Two products cost twice and sell once.** The open-source dashboard and
  the hosted enterprise dashboard share code through a plugin seam, a
  capability list, a one-way import boundary, two build pipelines, and two
  storage backends behind nine adapter seams. Every feature is designed
  twice (file store, then database; local buttons, then hosted jobs) and
  tested twice. The first enterprise evaluation (2026-08-13) surfaced the
  cost directly: a PR run had nowhere to store state locally, and the EE
  port of every new store was a second project behind the first.
- **Local repos are the wrong unit.** A repo on one developer's disk has no
  pull requests, no team, no baseline that others inherit, and no gate. The
  committed-baseline convention (`LATEST.json` after merging to main)
  exists only to simulate what a server does for free: own the default
  branch's state. Everything the product is for (catching a behavioral
  regression before merge) needs the repository as the provider sees it.
- **Analyze is not the product.** The spec-to-scenario pipeline is. Analyze
  is a second engine with its own rule catalog (958 rules across three
  languages, a .NET semantic host, a false-positive automation loop, a
  nine-tab dashboard section), its own store, its own gate, and its own
  telemetry, none of which the guard pipeline consumes. Interface mapping
  uses the analyzer's parsers and detectors and nothing else.
- **The CLI should not carry an LLM.** Today every LLM stage can run on a
  developer's machine through their Claude Code login or their own API
  key, so the CLI drags a transport selector, a global config file, a model
  table, a price cache, and a first-run wizard. Once setup runs online, the
  CLI's only work is to execute scenarios and report, which needs none of
  it.

## 2. The product after the change

One hosted web application, one CLI, one source of truth.

- A **workspace** is the tenant. A user signs in, belongs to one or more
  workspaces, and each workspace has a PLAN. Plans decide which features
  are on (§3).
- A workspace **connects repositories** through a source-control provider
  connection (§4). Connecting a repo starts onboarding: the spec corpus is
  scanned, guard setup runs, scenarios are generated, all as hosted jobs,
  all visible (and steerable, per the agentic plan's interactive sessions)
  in the dashboard.
- Every connected repo has a **pull-request gate** (§5). The gate runs the
  repo's scenarios on each pull request and posts a check through the
  provider.
- Everything the engine produces (corpus versions, decisions, interfaces,
  flows, scenarios, runs, evidence, sessions) lives in the hosted store,
  keyed by workspace, repo, ref and commit (§7). Nothing TrueCourse owns is
  committed into the user's repository, and nothing the product needs is
  read from a developer's disk.
- The **CLI** (§6) signs in to the hosted product, identifies the repo from
  the checkout's remote, downloads the scenarios that apply to the current
  commit, runs them locally, and uploads the run. The dashboard shows it as
  a local run next to the hosted ones.
- The **LLM** runs only in the hosted product (§8). A workspace either
  brings its own provider key or uses the product's metered allowance,
  depending on plan. The CLI never makes an LLM call.

What does NOT change: the engine. The ontology (claims, flows, interfaces,
scenarios, sandbox), the agent loop and its two session drivers, the
deterministic runner, the scenario schema, the step drivers (CLI, API,
web), the reference-first method, the sessions store's event shape, the
versioned store model. This plan moves the engine into one place and
removes what surrounds it; it changes no engine behavior. Any engine change
discovered to be necessary is recorded in the agentic plan, not here.

## 3. One edition, plan-gated features

### 3.1 The rule

There is one build, one deploy, and one boot path. "Community" and
"enterprise" stop existing as modes. The server always requires a database,
always requires authentication, always loads every feature module. Whether a
feature is USABLE by a workspace is an ENTITLEMENT question answered per
request, never a boot question answered per process.

The `ee/` directory stays, for licensing: code under it is governed by the
commercial license, code outside it by MIT. What changes is the membership
rule. `ee/` holds enterprise FEATURES (the things an enterprise plan
unlocks). Everything a workspace on any plan uses is outside `ee/`, which
now includes the things the hosted product is made of: the database store,
the job runner, the provider connections and the pull-request gate,
authentication, the hosted LLM transport, error tracking. Those were
enterprise-only because the open-source product had to run without them;
with one product they are the product.

Import direction is unchanged: `ee/` imports from the rest, the rest never
imports from `ee/` statically. The loader seam survives with a narrower
job: it loads the enterprise feature modules, which register routes, nav
entries and hooks exactly as today. What the seam no longer does is decide
the edition, swap storage backends, install auth, or advertise a
process-wide capability list. A deployment without `ee/` present (an
external contributor's checkout) boots and runs the full base product; the
enterprise features are simply absent, and the entitlement resolver reports
them as unavailable.

### 3.2 Entitlements replace capabilities

Today a process-global capability list is computed once at boot, served
from an unauthenticated endpoint, and used by the client to show or hide
surfaces. One capability (`local-filesystem`) is an inverse gate for "there
is a working tree here", and it is the only one the open-source product
actually consumes; several others are advertised and read nowhere.

After the change:

- A workspace has a PLAN (a named tier). A plan maps to a set of
  ENTITLEMENTS (named features: `sso`, `scim`, `connectors`, `self-hosted`,
  `audit-log`, `retention`, `roles`, a private-repo allowance, a seat
  allowance, a metered LLM allowance). Entitlements are the gating unit;
  plan names are a pricing decision (§11) and can change without touching
  code.
- The entitlement set is resolved PER REQUEST from the session's workspace
  and served from an authenticated endpoint. The client holds it in the
  same context the capability list lives in today, refetched on workspace
  switch. Server routes enforce it; client gating is a courtesy.
- The public, pre-login endpoint keeps one job: "which enterprise feature
  modules are deployed here" (so the login page can offer SSO, and a
  checkout without `ee/` renders an honest UI). It carries nothing about any
  workspace.
- The working-tree inverse gate dies with local repos. Every surface it
  hid in hosted mode (directory picker, local Generate/Run buttons, the
  file explorer) is deleted, not gated.

### 3.3 Where the plan comes from

Two entitlement SOURCES, one resolver:

- **Hosted:** the workspace's plan is a row the product owns (the existing
  per-workspace settings table is the natural home: it is already keyed by
  workspace and already carries one feature switch). How the row is set
  (billing integration, manual operator action) is outside this plan;
  day one is an operator-set field in the admin console.
- **Self-hosted (an enterprise entitlement):** a signed license key in the
  deployment's configuration names the plan and the seat/repo allowances.
  The resolver reads it the same way it reads the row, so every feature
  check in the codebase is one function, never "if hosted".

### 3.4 Authentication and roles for everyone

Every user signs in. WorkOS AuthKit stays as the identity provider: it
already serves the sessions, and it carries both the social logins a free
workspace wants (GitHub sign-in is the obvious first, since the first
provider connection is GitHub) and the enterprise SSO/SCIM connections an
enterprise plan unlocks. A new workspace is created at first sign-in exactly
as today.

A minimal role model is introduced, because a pull-request gate that anyone
in the workspace can make blocking is not acceptable at team scale: `admin`
(connect and unlink repos, change gate policy, manage providers and keys,
manage members) and `member` (everything else, including chatting with
sessions, resolving conflicts and dismissing claims). WorkOS organization
membership roles are the source; the product reads them and enforces them
on write routes. The operator flag (TrueCourse staff) is unchanged.

### 3.5 The dashboard: enterprise structure, the open-source idiom (decision 2026-08-21)

The one dashboard takes its STRUCTURE from the hosted enterprise dashboard
and its IDIOM from the recent open-source work on the agentic branch. Both
exist today; neither is rebuilt from nothing.

**Structure (from the enterprise shell).** Sign-in and workspace switch;
the workspace home (overview of connected repos, gate activity, and the
jobs in flight); Repositories (connect, policy, unlink); Notifications
(the durable feed and the bell); Settings as a hub (members and SSO,
providers, models, integrations, plan); Admin for operators. Below that,
the repo console: selecting a repository opens its page, whose menu is
Pull requests (that repository's gate feed: each pull request, its check,
its runs hosted and local, its spec-change offer) followed by the guard
tabs in the curated order the enterprise lens already uses (Coverage,
Tests, Interfaces, Runs, Activity, plus Sources and Dependencies, which
return for everyone; they were hidden in hosted mode only because they
read the working tree, and they are row-backed now). Two things from
today's navigation go: Pull requests is NOT a top-level entry (the
cross-repo feed collapses into the workspace home's activity; the page
itself lives under the repository), and the section switcher between Code
Analysis and Spec Guard is deleted with Code Analysis, so the repo page has
one menu and no toggle. Jobs and sessions stream live into every page
through the one event connection the shell already holds.

**Idiom (from the agentic branch, carried over whole).** These are the
product's visual language and the enterprise pages are restyled onto
them, never the reverse:

- The panel idiom: every left panel collapses and resizes the same way
  (a fixed-height header carrying the panel's name and a collapse chevron,
  a thin button strip when collapsed, a drag-to-resize edge), with the
  page-level collapsible aside for Sources, Dependencies, Activity and the
  Runs columns. Session state only, nothing persisted.
- The quiet status idiom: a status is a colored dot plus a full-contrast
  word, capsules only for neutral bounded labels, the muted ground a step
  darker in light and a step lighter in dark, hover help in popovers.
- Spec Guard as the primary lens: a bare repo address lands on Coverage;
  the coverage Overview is read-only composition bars on the validated
  palette with freshness stamps.
- The one-column test workspace: verdict band, evidence filmstrip and
  replay, collapsible step records with the failing step open, long-form
  records behind drawers, the ruling beside the evidence it was made on.
- The Sources page as shared-list-left, detail-right, add-in-a-dialog,
  progress inline; the Interfaces tab reading each surface in its own
  words; driver chips on every test row and filter.
- The Activity surface: runs, sessions, transcript and chat, with
  multi-select status filter chips and a neutral-surface transcript.
- The brand: the twin-sail mark, the wordmark face, the horizontal and
  stacked logo set.

The shared components those pages rest on (the one list component for
every list, the empty-state component, previewable rows, the hover
popover) are the platform's; the enterprise pages that still carry their
own tables, capsules and accordions move onto them in Phase B.

## 4. Connecting repositories through a provider

### 4.1 The provider seam

The product never speaks GitHub. It speaks to a SOURCE-CONTROL PROVIDER
contract, and GitHub is the first implementation. GitLab and Azure DevOps
are the next two, and the contract is designed so that adding one is a new
adapter package plus its webhook receiver, with no change to the gate, the
jobs, the stores or the dashboard.

The contract, as the product needs it (every operation keyed by a
connection, never by a global token):

- **Connection lifecycle.** Start a connection (the install/authorize URL
  the user is sent to), complete it (the callback that binds the provider's
  installation, group or organization to a workspace), list the
  repositories a connection can see, revoke it. A connection belongs to
  exactly one workspace; a repository belongs to exactly one connection.
- **Repository facts.** Stable provider id, full name, default branch,
  visibility (public/private; the plan's private-repo allowance reads it),
  the web URL, and the clone URL.
- **Clone credentials.** A short-lived credential for cloning a repo and
  fetching a pull request's head, scoped to the connection. The hosted
  runner and the gate use it; it never reaches the client or the CLI.
- **Reading files at a ref** without a clone (the spec corpus is read this
  way when no checkout is needed).
- **Pull requests.** List and read (number, head and base ref and sha,
  author, fork-ness, state), list the files a pull request changed (spec
  change detection), read the actor's permission on the repo (the
  checkbox-comment trigger requires write permission).
- **Checks.** Open an in-progress check on a commit, complete it with a
  conclusion (success, failure, neutral, error-as-failure), a title, a
  summary body, and bounded inline annotations. Where a provider has no
  checks concept, the adapter maps to commit statuses and a comment.
- **Comments.** Create, find-by-marker and update a pull-request comment
  (the checkbox offers live here).
- **Webhooks.** Verify a delivery's signature and normalize it into the
  product's EVENTS: connection created/removed, repository added/removed
  from a connection, pull request opened/updated/reopened/closed/merged,
  push to the default branch, comment edited. Everything downstream
  consumes events, never provider payloads.
- **Remote URL parsing.** Given a git remote URL, say which provider and
  which repository it names. The CLI's repo identification (§6) is built
  on it.

Internal vocabulary is provider-neutral: "pull request" is the product's
word (GitHub and Azure DevOps use it; GitLab's "merge request" is the same
object), "connection" is the word for an installation, group authorization
or organization authorization, and "check" is the word for the gate's
verdict as posted. The dashboard shows the provider's own term and icon
next to provider links.

### 4.2 What the user does

1. Sign in. Create or pick a workspace.
2. Add a provider connection (GitHub today). The user is sent to the
   provider, authorizes the app for an organization or an account, and
   returns.
3. Pick repositories to connect. Each connection lists what it can see;
   connecting a private repository is checked against the plan's allowance.
4. Onboarding runs (§4.3). The dashboard shows the jobs and their sessions
   live; the user can steer.
5. From then on every pull request on that repository is gated (§5).

A repository connected in one workspace cannot be connected in another
(today's rule, kept). Unlinking a repository keeps its history read-only
until an admin deletes it.

### 4.3 Onboarding: setup online

Connecting a repository enqueues the onboarding chain on the default branch
head: spec scan (corpus version 1), guard setup (recipe, dependency
catalog, interface catalog, auth verification), guard generate (flows,
scenarios), then a baseline run. Each step is the agentic plan's command,
executed by the hosted runner as a job with sessions the user can watch and
steer in the dashboard's Activity surface. A step that ends with pending
questions (a session could not settle something without the user) does not
block the chain; it reports the questions, and answering them re-runs only
what they invalidate.

There is no "setup" anywhere else. The things that used to be authored on
disk (spec decisions, the recipe, the dependency declarations and their
supplied values, dismissed claims, authored interfaces) are authored in the
dashboard and stored as rows. Supplied dependency values (API keys for a
real external account, credentials for a supplied instance) are stored
encrypted, the same way the LLM provider key is today, and entered only
through the dashboard.

Every subsequent push to the default branch refreshes the baseline: the
spec corpus is re-scanned (cache hits make an unchanged corpus free),
interfaces re-derived, generation re-run for what changed, and a baseline
run recorded. This is the agentic plan's versioned store model (§3.8 there)
with rows instead of files: each version carries its parent pointer, the
ref and sha it came from, and content-addressed pointers to unchanged
items.

## 5. The pull-request gate for everyone

The gate is the existing Spec Guard gate, made provider-neutral and made
universal. Its semantics are unchanged and restated here because they are
now the product's core promise:

- **New failures versus base.** The check fails only on scenarios that pass
  on the base and fail on the head. Pre-existing red never blocks unrelated
  work.
- **Baseline from the default branch**, refreshed on every push to it and
  coalesced under load; a miss or a race does a lazy base run on the gate's
  own checkout. No baseline at all yields a neutral check.
- **Cold generate on first contact.** A pull request that arrives before
  onboarding finished generates on its own checkout rather than staying
  neutral.
- **Impacted-only by default**, full board on request (the agentic plan's
  PR scope rule). The verdict says which it was.
- **Decisions honored.** Repo-level dismissals and the PR-scoped overlay
  both apply; the overlay promotes into the repo's decisions on merge and
  is discarded on close.
- **Stale bindings are annotations, never failures.**
- **Error is a failure-styled check**, never silent neutral. The kill switch
  and the per-repo blocking/advisory policy are unchanged.
- **Spec changes in a pull request** are offered a regenerate-and-re-gate
  through a checkbox comment; fork pull requests gate read-only.

What changes:

- **One check, not two.** The Code Quality check dies with analyze. The
  gate posts exactly one check, named for the product.
- **Gate runs carry a provenance.** Every run record says which provider
  posted it, and every run record (hosted or local, §6) says where it
  executed.
- **Hosted execution is isolated.** Today the gate builds and runs the
  customer's application inside the web server's own container. That is
  acceptable for one evaluation and not for a product that gates
  open-source repositories from strangers. The executor seam already
  separates "decide and post" from "build and run"; behind it the hosted
  runner executes each run in a fresh, resource-bounded, network-policed
  sandbox (one container per run is the baseline design), with supplied
  dependency values injected at start and destroyed at end. The web tier
  never runs customer code. The infrastructure shape (which container
  service, which image) is a deployment decision outside this plan; the
  contract is: the runner receives a checkout, a recipe, a scenario set,
  the resolved dependency values and a time budget, and returns a run
  report plus evidence.

## 6. The CLI

### 6.1 Purpose

One CLI, named `truecourse`, published as today. Its purpose is narrow: run
a connected repository's scenarios where the developer is, and report the
run to the product. It exists because some applications cannot be built in
a hosted sandbox (private package registries, licensed toolchains, hardware
dependencies, a database only reachable from the office network), and
because a developer fixing a red scenario wants the loop on their own
machine.

The CLI makes no LLM call, holds no LLM configuration, reads no spec, derives
no interface, generates nothing, and never writes into the repository. It
does not ship the analyzer, the parsers, the generator, or the dashboard
server.

### 6.2 Commands

- `truecourse login` / `logout` / `whoami`. Browser or device-code sign-in
  against the hosted product; the token lives in the user's home directory
  with restrictive permissions. A `TRUECOURSE_TOKEN` environment variable
  serves CI.
- `truecourse run [--scenario <id>]... [--all] [--ref <name>]`. The
  default and the reason the CLI exists:
  1. Identify the repository from the checkout's git remote through the
     provider seam's remote-URL parsing, and the commit from HEAD. Refuse a
     remote that is not a connected repository in any of the user's
     workspaces, naming what it found.
  2. Download the RUN BUNDLE for that commit: the recipe, the scenario
     set that applies (the commit's own generation if the product has one,
     else the baseline's, with the scope rule of §5 applied to the diff
     against the base), the dependency DECLARATIONS (never supplied
     values), and the ids of the flows and claims the scenarios prove. The
     bundle is a read-only download into a cache outside the repository.
  3. Resolve supplied dependency values from the local environment, by the
     declared names. A declared value with no local source is a blocked
     scenario with that reason, exactly as the hosted runner reports it.
  4. Execute with the deterministic runner, printing the run's moving
     counters and a deep link to the run in the dashboard. A dirty working
     tree is allowed (that is the point of a local run) and recorded as
     such.
  5. Upload the run: per-scenario verdicts and step actuals, the evidence
     (transcripts, screenshots), the environment facts (OS, dirty tree,
     CI-or-not, runner version). Upload failures are reported loudly and
     the run stays on disk for `truecourse run --resume-upload`.
- `truecourse status`. The repo's last hosted and local runs for the
  current commit and the open pull request, if any.
- `truecourse pull`. Writes the run bundle to a directory for inspection
  (reading a scenario's YAML before running it). Never into the
  repository.

Everything else that the CLI does today (spec scan, sources, docs include
and exclude, conflicts, guard setup, generate, recipe, seed, interfaces,
author, adjudicate, flows dismissal, findings, externals, dependencies,
the LLM transport configuration, the dashboard service installer, the git
hooks, the rules and analyze families, the Claude Code skills and the
editor extension) is deleted from the CLI. Their surviving functions exist
only in the dashboard.

### 6.3 Local runs in the product

A run record carries an ORIGIN: `hosted` (the runner) or `local` (the CLI),
plus for local runs the uploading user and the environment facts. The
dashboard shows local runs in the same Runs list and on the pull request's
timeline when the commit is a pull request head, labeled as local.

A local run NEVER changes a check's verdict in this plan's scope. The gate's
verdict comes from hosted execution only, so a verdict is always
reproducible by the product. Allowing a local run to satisfy a gate for
repositories the sandbox cannot build is a later decision (§11); the run
record's origin field is what would carry it.

Visual judgment of web-driver evidence (the screenshot judge) is an LLM
stage and therefore hosted: the CLI uploads the screenshots, the product
judges them and completes the run's verdict server-side. A local run of a
web scenario is `pending-judgment` until then, never `passed` on the
strength of an unjudged screenshot.

Triage and adjudication of failures run hosted on the uploaded evidence,
exactly as for a hosted run. The developer reads the verdict in the
dashboard.

## 7. Storage: one store

- **One backend.** Postgres, always, with the content-addressed pool for
  large payloads (corpus docs, evidence, transcripts). The file-based
  implementations of the store seams are deleted, and with them the
  per-repo `.truecourse/` directory, the committed-baseline convention,
  the gitignore template, the global registry of project paths, the
  walk-up from a working directory, the lock file, the per-repo UI state
  file, and the global config file that held the LLM transport selection.
  Tests run against in-process Postgres (already a dev dependency for the
  enterprise store tests); the seams stay as interfaces so tests can
  substitute fakes, but there is one production implementation each.
- **The sessions store** of the agentic plan (§3.9 there) lands directly as
  its row form: a runs/sessions table and an append-only transcript-events
  table keyed (workspace, repo, run, session), the loop's sink inserting
  rows. The "file vertical first, then EE port" sequencing is withdrawn;
  there is one vertical.
- **Versioned state** (agentic plan §3.8) lands as rows keyed (repo, ref,
  parent) from the start: corpus versions, generation records, run records,
  each with parent pointers and content-addressed item pointers. The PR
  delta-version is a row parented on the baseline row.
- **The user's repository carries nothing.** No `.truecourse/`, no
  committed scenarios, no corpus snapshot, no decisions file. The
  reviewable-in-a-PR property of committed scenarios is replaced by the
  dashboard's version-by-version diff view and by the gate's own summary
  of what changed in the scenario set for that pull request.
- **Secrets** (provider credentials, LLM keys, supplied dependency values,
  connector tokens) are encrypted at rest under the deployment's master
  secret, as today. The CLI token is the one secret that lives on a
  developer's disk.
- **Tenancy gets a local workspace row.** Today tenancy is a bare
  workspace id on a dozen tables with WorkOS as the only record of the
  organization. The plan (§3.3) needs a row the product owns; that row
  becomes the parent every workspace-scoped table references.
- **Retention** is an enterprise entitlement applied by the store (runs
  and transcripts past the window are pruned; pointers keep baselines
  alive).

## 8. The LLM in one place

- Every LLM call happens in the hosted runner or the web tier. The two
  session drivers of the agentic plan (the direct-API driver and the Agent
  SDK driver) both remain, because both run against an API key; what dies
  is the per-user transport CHOICE installed on a developer's machine
  through the Claude Code login. The driver a deployment uses is an
  operator decision, never a user's.
- A workspace's LLM access is one of: **bring your own key** (the existing
  Models page, any plan) or the **product's metered allowance** (a plan
  entitlement with a budget; the run's pre-flight estimate is checked
  against what is left, and an exhausted allowance ends the run with that
  reason, never silently). Which of the two applies is an entitlement.
- The pre-flight estimate and the per-run cost accounting are unchanged in
  method; their surface moves entirely into the dashboard (the CLI never
  needs them).
- The LLM call caches (content-keyed, per stage) are already global,
  repo-agnostic rows; unchanged.

## 9. Amendments to the agentic pipeline plan

The engine plan stays the plan of record for engine behavior. It takes
these amendments from this document; they are to be recorded there as
dated decisions when this plan is accepted.

- **§3.1 transport modes.** Both session drivers remain; "claude-code mode"
  no longer means a user's Claude Code login. The driver is a deployment
  setting. The global config file, `config llm` command family and the
  first-run transport wizard are deleted.
- **§3.6 observability.** "The CLI shows moving counters and prints the
  deep link" now applies to `truecourse run` only. Setup, scan, generate
  and authoring have no CLI surface; their progress is the dashboard's
  alone.
- **§3.7 interactive sessions.** Unchanged in substance. The session API's
  host is the hosted runner from day one; there is no local run-process
  host.
- **§3.8 versioned state.** "Main owns committed baselines" becomes "the
  default branch owns baselines, stored as rows". Nothing is committed;
  the file-snapshot mirror is withdrawn. The rest (parent pointers,
  content-addressed pointers, derived diffs, PR delta versions, impacted
  scope) is unchanged.
- **§3.9 sessions store.** The file layout is withdrawn; the row layout
  that section already specifies for EE is the only layout. The sink is
  still the seam. The three day-one schema decisions (actor, monotonic
  sequence, endpoint as URL plus token) stand.
- **§4 reference corpus.** The corpus's SUBJECT was TrueCourse's own analyze
  and dashboard documentation (two areas, 51 scenarios). That subject is
  deleted with analyze. The corpus is re-authored against the one
  product's documentation (connecting repos, the gate, the dashboard, the
  CLI) once that documentation exists (§10.7); the authoring method and
  the anti-overfit rules are unchanged. Until then the benchmark is the
  guard fixture repos.
- **§6 spec scan.** The scan reads documents from the hosted runner's
  checkout or through the provider's file API, never from a developer's
  working tree. The `sources` (llms.txt sites) feature is unchanged; its
  snapshots are rows.
- **§7 guard setup.** `dependencies.local.json` (the gitignored supplied
  values overlay) is withdrawn; supplied values are encrypted rows entered
  through the dashboard, and the CLI resolves them from the local
  environment by declared name (§6.2). The committed
  `dependencies.json` becomes a row. Setup's sandbox is the hosted
  execution sandbox of §5.
- **§9 guard run.** The runner executes in two places with one
  implementation: the hosted sandbox and the CLI. Run records gain
  `origin`. The screenshot judge runs hosted on uploaded evidence.
- **§10 web driver.** The hosted sandbox image carries the browser; the
  CLI installs it on demand as today.
- **Phase 0.** Its deletions stand; this plan's §10 is a second, larger
  Phase 0 that lands before the workstreams continue.

## 10. What is deleted, what moves, what is kept

Inventories. Each line is "name: disposition". A disposition of DELETE
means removed entirely in this plan; MOVE means it leaves `ee/` for the
base product or changes package; KEEP means unchanged or edited in place;
REPLACE means the capability survives with a new implementation named in
this document.

### 10.1 The analyze family: DELETE

- The analyze commands and their CLI surface: `analyze`, `list`, `rules`
  (all subcommands), `hooks` (the pre-commit diff gate), the Claude Code
  skills shipped with the CLI (analyze, fix, hooks, list), the `.tc`
  editor extension and its silent installer.
- In core: the analyze pipeline (analyzer service, graph service, flow
  service, the violation services, rules service, analysis persistence and
  registry, the deterministic-scan worker, the analyze and diff commands,
  the analysis store and its lock, the snapshot types, the UI-state store,
  the rule-domain progress module, the LLM context router and the CLI LLM
  provider that only analyze used, the analyze telemetry events and
  language detection).
- The analyzer package's rule engine: all rule trees, the rule engine, the
  deterministic scan, data-flow, the schema index, the Roslyn host client,
  the LSP client and servers, the flow tracer and analysis graph, the layer
  detector, the split analyzer, the module and entity extractors, the
  repository-level entry point. The `pyright`, `smol-toml` and `minimatch`
  dependencies go with them.
- The C# Roslyn host (`tools/csharp-roslyn-host`) and every CI step that
  installs .NET or builds it. Interface mapping keeps C# tree-sitter
  support; it never used the semantic host.
- The dashboard's Code Analysis section (all nine tabs), the pages, hooks,
  contexts, components, API client functions and socket events that serve
  it; the analyses, graph, files, violations, databases, flows, analytics
  and rules routes; the analytics and watcher services; the analyze
  progress and stash-confirm socket protocol.
- The shared analyze types (analysis, entity, violations, code violations,
  database, code-derived flows, analytics, rules) and schemas.
- The enterprise analyze store, its tables (analyses, analysis current,
  analysis history), the analyze lock, the Code Quality check (gate
  decision, runner, handler, comment), the per-repo code-quality gate
  settings, the per-workspace `code_analysis_llm` switch, the workspace
  overview's violation numbers, and the Pull Requests page's default lens
  on Code Quality.
- Tests: the analyzer suite, the analyze CLI suites, the analyze core
  suites, the analyze fixtures (every `sample-*-project-*` fixture, the
  C# symbol index and deterministic-scan fixtures). Edit, not delete: the
  global test setup's parser boot, telemetry and repo-events tests, the
  shared schema test.
- Scripts: compare-analyses, dump-analysis, regenerate-expected-graph.
- The false-positive automation loop (`docs/fp-automation/`) and the CI
  workflows and labels that serve it (the campaign-close release trigger,
  the human-review blocker, the routine-activity notifier's `fp-*` scopes).
  Tag push becomes the only npm release trigger.
- Assets: the analyze-era screenshots and demo recordings.
- The analyze telemetry events. (Guard emits no telemetry event today;
  whether the one product needs client-side telemetry at all, given the
  server sees every run, is a §11 question.)

### 10.2 The contracts family: DELETE

- The contract extractor and contract verifier packages, the contract
  store, the inferred-action store and inferred-decisions overlay, the
  `infer` path inside the spec command, the contracts and infer fixtures,
  their test suites, the dead wire types for inferred decisions and
  contract diffs, the enterprise inferred-actions table, and the stale
  contract-era build artifacts. The CLI package's declared dependencies on
  both packages are already unused.

### 10.3 The analyzer's surviving core: KEEP, renamed

What interface mapping needs, and only that: the tree-sitter parser and
grammars (TypeScript, JavaScript, Python, C#), language configuration, the
file walker, the per-file analysis (imports, exports, functions, classes,
calls, HTTP calls, route registrations, web routes and redirects, CLI
commands, outbound requests, request contracts), the dependency graph with
module resolution, the service detectors, the database detectors and
schema parsers, the external-service, datastore-URL and outbound-request
collectors, and the patterns those read. The package is renamed to say
what it is now (a source-facts extractor for interface mapping), its
exports trimmed to that surface, and the estimate's token constants move
out of the deleted context router into the estimator.

### 10.4 The local product: DELETE or REPLACE

- The local dashboard command and its background-service installer
  (launchd, systemd, Windows service, log rotation): DELETE. The dashboard
  is hosted.
- `truecourse add`, the project registry, the walk-up resolution, the
  directory picker and browse route, the repo list's local paths: DELETE.
  REPLACED by provider connections (§4).
- The `npm` distributable's server bundle, client bundle, WASM copy,
  Roslyn publish, skills and extension copy: DELETE. The distributable is
  the CLI bundle alone.
- The per-repo `.truecourse/` layout, the gitignore template, the
  committed-file conventions in CLAUDE.md: DELETE. REPLACED by §7.
- The file implementations of every store seam (analysis, spec, guard,
  inferred-action, repo config, UI state, registry, KV cache, sessions
  file sink, the file gate store): DELETE. One implementation each.
- The global config file and the `config llm` command family, the
  first-run transport wizard, the CLI LLM pre-flight, the model table's
  per-stage selection as a user setting: DELETE. REPLACED by §8.
- The community-prompts nudges (Discord, star): DELETE.
- The edition detector, the boot-time capability list, the
  `local-filesystem` gate and every site that reads it, the dead
  `RequiresCapability` component, the test-only `pr-gates` name, the
  unconsumed `guard` and `sso` capabilities: DELETE. REPLACED by
  entitlements (§3.2).
- The one-way boundary test's rules that exist only to keep the base
  product free of the database, cloud SDKs and enterprise packages: edit
  to the new rule (no static import of `ee/` from outside it; the AI SDK
  and Agent SDK confinement rules stay).

### 10.5 From `ee/` into the base product: MOVE

- The database package and migrations, the data-store package (minus the
  analyze stores), the content pool, the jobs runner (queue, harness,
  events hub, orphan settlement, coalescing, chains, backfill), the
  notifications feed and bell, the workspace settings, the LLM provider
  configuration and the hosted LLM transport, the admin console, error
  tracking, the log transport, the auth routes and session verifier, the
  workspace home, the repositories page, the pull requests page (re-homed under the repository, §3.5), the settings
  hub, the Models page, the jobs context and progress popup.
- The GitHub App package: MOVE and SPLIT. The provider-neutral half
  (connection and repository tables, the gate decision and runner, the
  baseline runner, onboarding, head regeneration, the spec-change offer,
  pull-request state, the notifications e-mailer) becomes the base
  product's provider-neutral gate; the GitHub-specific half (app auth,
  Octokit client, webhook signature and payload parsing, check and comment
  posting, setup callback) becomes the first provider adapter behind the
  §4.1 contract. Tables gain a provider column; the drift-era column names
  on gate runs are renamed to what they hold; the dead registry table and
  the retired blob storage package are deleted.
- The dashboard client's enterprise shell pieces (page shell, nav slot,
  user menu, auth context, PR-scope gate) become the shell of the one
  product.

### 10.6 Staying in `ee/`: KEEP

- SSO and SCIM (WorkOS enterprise connections), the members page.
- Knowledge connectors (Jira, Confluence) and the workspace knowledge page
  with its sync jobs.
- Workspace-level spec sets and repo inheritance.
- Retention, audit log, roles beyond admin/member, self-hosted licensing:
  new, and enterprise.

Each is gated by an entitlement, registered through the loader seam, and
absent without error when `ee/` is not present.

### 10.7 Documentation, site, reference: EDIT

- README: rewrite for the one product (sign in, connect, gate, CLI run).
  The analyze section, the local storage layout, the transport
  configuration, the per-stage model selection and the language-support
  table go.
- CLAUDE.md and AGENTS.md: rewrite the layout, storage and conventions
  sections (AGENTS.md is already stale). CONTRIBUTING.md: rewrite the
  project structure and the areas-where-we-need-help list.
- The Mintlify docs site: the analyze and dashboard-analysis pages go; the
  connect, gate, CLI and plans pages are new. Feature changes update the
  docs site, not the README.
- The landing site presents no analyze surface today; it needs the plan
  and sign-in story, not removals.
- `docs/SPEC_GUARD_PLAN.md` is already slated for deletion; the guard
  findings corpus (`docs/findings/`) stays as guard evidence; the CI speed
  plan is moot once the Roslyn suites are gone and is deleted with them.
- `reference/`: the two areas and 51 scenarios describe the deleted
  product. The hand-authored interface catalog is pinned by a guard test;
  keep the catalog and the authoring guide, delete the analyze-subject
  areas, and re-author per §9.
- The repo's own dogfood store (`.truecourse/` and its backups at the repo
  root) is deleted with the file store.

### 10.8 Target package layout (proposed)

A sketch, not a file list. Names are illustrative.

- `apps/web/` (the one dashboard: client and server; was `apps/dashboard`)
- `apps/landing/`
- `packages/shared/`, `packages/agent-loop/`, `packages/llm-api/`,
  `packages/llm-claude-agent/`, `packages/llm/` (cache seam): unchanged
- `packages/source-facts/` (the trimmed analyzer, §10.3)
- `packages/interface-mapper/`, `packages/spec-consolidator/`,
  `packages/guard-generator/`, `packages/guard-runner/`: unchanged
- `packages/core/` (engine services and commands; no analyze, no file
  stores, no local config)
- `packages/db/` (schema and migrations), `packages/store/` (the one
  store implementation), `packages/jobs/` (runner, events, chains)
- `packages/scm/` (the provider contract, the gate, onboarding, the
  pull-request model), `packages/scm-github/` (adapter one), later
  `packages/scm-gitlab/`, `packages/scm-azure-devops/`
- `packages/entitlements/` (plans, resolver, license keys)
- `tools/cli/` (login, run, status, pull)
- `ee/packages/{sso,connectors,knowledge,...}` (enterprise features,
  each registering through the loader seam)

## 11. Decisions to take before implementation

Each with a recommendation. One answer per item; the doc is updated with
the answer and the date.

1. **Plan names and the split.** Recommendation: three plans. `Free` (public
   repositories only, bring-your-own LLM key, limited seats), `Team`
   (private repositories, metered LLM allowance, admin/member roles),
   `Enterprise` (everything in §10.6 plus self-hosting). Pricing is
   outside this document; the entitlement mechanism does not depend on
   the names.
2. **Local runs and the gate.** Recommendation: local runs never satisfy a
   check in this plan; revisit once the hosted sandbox's build coverage is
   measured on real repos.
3. **One store, tests on in-process Postgres.** Recommendation: yes, delete
   the file implementations; the seams stay as interfaces.
4. **Supplied dependency values for local runs.** Recommendation: local
   environment only, by declared name; the CLI never downloads a secret.
5. **Reference corpus subject.** Recommendation: re-author against the one
   product's own docs once §10.7 lands; benchmark on the guard fixture
   repos meanwhile.
6. **CLI telemetry.** Recommendation: delete the PostHog client from the
   CLI; the server records every run it receives, which is the signal that
   mattered.
7. **Sentry placement.** Recommendation: base product, enabled by DSN;
   the original reason for EE-only (keeping the open-source server free of
   the dependency) no longer applies.
8. **Identity provider for free sign-in.** Recommendation: WorkOS AuthKit
   with GitHub as the first social login; no second identity system.
9. **Repository visibility and the free plan.** Recommendation: public
   repositories are free on any provider; private repositories count
   against the plan's allowance.

## 12. Sequencing

Five phases, each landing green on its own. Phase A first because it
shrinks everything the others touch; B and C may proceed in parallel once A
is in; D needs C's remote-URL parsing and B's auth; E trails everything.

- **Phase A: delete.** §10.1 and §10.2 in full, §10.3's trim. The guard
  pipeline's behavior is unchanged; its tests are the acceptance bar. Pure
  removal, no new feature.
- **Phase B: one edition.** §3 and §7: the single boot path, Postgres
  only, auth for all, the workspace row, entitlements and the plan field,
  the role model, the trimmed loader seam, the deletion of the local
  product (§10.4), the moves (§10.5) that are not provider-specific.
- **Phase C: the provider seam.** §4 and §5: the contract, the
  provider-neutral gate, the GitHub adapter, the one check, the
  provider-neutral tables, webhook normalization, remote-URL parsing.
  GitLab and Azure DevOps adapters are separate later projects against the
  finished contract.
- **Phase D: the CLI.** §6: login, run bundle, local execution, upload,
  local runs in the dashboard, hosted judgment of uploaded evidence.
- **Phase E: documentation and the hosted sandbox.** §10.7 and §5's
  isolated executor. The sandbox is listed last only because the gate runs
  today without it; for gating strangers' repositories on the free plan it
  is a precondition, and the free plan does not open before it lands.

The agentic plan's workstreams continue on top of Phase A's result; their
sessions land in the hosted runner as Phase B makes it the only runner.
