# TrueCourse Enterprise Edition (`ee/`)

Commercial-licensed enterprise features that layer onto the open-source
core. **Everything in this directory is governed by [`ee/LICENSE`](./LICENSE),
not the repository's root MIT license.**

> WorkOS authentication and the Postgres package (`@truecourse/db`) have moved
> into the base product — they now live in `apps/dashboard/server/src/auth/`
> and `packages/db/`, and are required for every deployment.

## Boundary rule

Imports are one-way: **`ee/` may import from OSS packages; OSS code must
never import from `ee/`.** OSS loads enterprise code only through the
sanctioned runtime seams (a server plugin loader and a client route/slot
registry), never via a static `import` of an `@truecourse/ee-*` package.
This keeps the OSS build free of commercial code and lets the community
edition run with `ee/` absent.

## Packages

- `packages/server` (`@truecourse/ee-server`) — enterprise server code
  (workspace, knowledge, admin, jobs, LLM config) that registers into the
  dashboard server's plugin seam. It also composes the GitHub App package
  below. Auth is no longer here — see the note above.
- `packages/client` (`@truecourse/ee-client`) — enterprise UI (the
  Workspace page, the GitHub integration page, and the Models page)
  contributed into the dashboard client's route + nav registries.
- `packages/github-app` (`@truecourse/ee-github-app`) — the hosted GitHub
  App PR gate (below). Composed by `ee-server`; lights up the `github-gate`
  capability when configured.
- `packages/llm` (`@truecourse/ee-llm`) — the API-backed LLM transport
  (below), built on the Vercel AI SDK.

## LLM providers (Models page)

The OSS/local product runs the `claude` CLI for all LLM work (spec scans,
guard scenario generation, analysis). A hosted enterprise deploy can't depend on
a per-user CLI binary, so the enterprise edition swaps in an **API transport**
that talks to **Anthropic, OpenAI, AWS Bedrock, or GitHub Copilot** (Copilot
via the OpenAI-compatible endpoint).

This rides a single OSS seam: every LLM call goes through `LlmTransport`
(`@truecourse/llm`, `getLlmTransport().complete(...)`). The default is the CLI;
`ee-server` calls `setLlmTransport(...)` at boot with an `AiSdkTransport` when a
provider is configured — so OSS is untouched and nothing in OSS imports the AI
SDK.

Admins configure the provider on the **Models** page (`/settings/models`, gated
by the `llm-config` capability). The API **key is encrypted at rest**
(AES-256-GCM, master secret from `TRUECOURSE_SECRET_KEY`) in the enterprise
Postgres (`llm_provider_config` table), never returned to the browser (only a
masked `••••1234`), and **validated with a live test call before saving**.
Saving is instant for the running process. Env vars (`LLM_PROVIDER` + keys) are
an alternative to the UI.

**Required for the Models page:** `DATABASE_URL` (ee is always Postgres) and
`TRUECOURSE_SECRET_KEY` (the encryption master secret). See `.env.example` for
the full provider env block.

## GitHub App (Spec Guard PR gate)

Enterprise users install the App and connect a repo. **Spec Guard** is the PR
gate: scenarios are generated server-side from the repo's spec corpus and run on
every pull request, so a behavioral regression against the spec is caught before
merge. Guard replaced the old contract-verify **drift gate** — same gate role,
new engine (spec-section-bound scenario tests that execute the repo's behavior,
not static `.tc` matching). There is no per-repo feature flag: guard is the only
spec-gating engine.

Every PR posts **two GitHub Checks**:

- **`TrueCourse / Code Quality`** — the `analyzeCore` violations gate. A distinct
  code-quality signal, unrelated to the spec gate; kept as-is.
- **`TrueCourse / Spec Guard`** — the guard gate (below).

Connecting a repo enqueues an onboarding generate job against the default branch,
so the repo is gated without manual setup. Scenarios, runs, decisions, and
evidence live server-side (Postgres + blob), keyed by repo and commit — no bot
commits into the repository.

### Gate semantics

- **New-failures-vs-base.** The Check **fails only on scenarios that pass on the
  base branch and fail on the PR head** — pre-existing red never blocks unrelated
  work. Blocking is per-repo configurable (advisory posts the same verdict as
  neutral).
- **Baseline.** Base results come from the stored baseline (refreshed on every
  merge to the default branch, coalesced under load) or the exact base-commit run;
  on a miss or race the gate does a **lazy base run** on its own checkout. With no
  baseline at all the Check is neutral ("baseline not established") — never a
  failure.
- **Cold-generate on first contact.** If a PR arrives before onboarding generation
  finished, the gate generates scenarios on its own checkout and persists them
  under the commit, so the gate is correct from first contact rather than
  neutral-until-someone-notices.
- **Dismissals honored.** Repo-level dismissed claims **and** the PR-scoped
  dismissals overlay are both excluded from the verdict; the overlay promotes into
  the repo's decisions when the PR merges.
- **Held scenarios excluded.** Only the committed scenario corpus runs; held
  (birth-passed-but-withheld) scenarios never reach the gate.
- **Stale bindings are annotations.** Scenarios whose bound spec section changed
  (stale) or disappeared (orphaned) surface as inline **warning annotations** on
  the doc section, never as failures — spec edits don't instantly red-flag a PR.
- **Neutral** = a repo with genuinely no spec documents (nothing to check), or the
  kill-switch (below).
- **Error Check** = the gate produced no verdict: build failure/timeout, run
  timeout, a broken built entry, generation failure, an unparseable committed
  recipe, or infra failure. An error settles as a **failure-styled Check** so a
  broken gate never silently passes — it never collapses to neutral.

A PR that **changes spec documents** is offered a checkbox comment that
regenerates scenarios for the PR head server-side and re-gates, so spec changes
and their scenario updates land together. Fork PRs are gated read-only via the
pull ref (which lives in the base repo).

### Capability

The enterprise server plugin advertises a `guard` capability **only after** the
guard subsystem (store, jobs, routes) registers successfully — a misconfigured or
dead job queue degrades visibly (guard actions stay hidden) instead of
half-working. Job-backed hosted generate/run and the gate surfaces gate on
`guard`; local-only guard actions gate on the community `local-filesystem`
capability and are hidden in hosted mode.

### Guard emails

Configured per-repo addresses (`notifyEmails`) are emailed via
[Resend](https://resend.com) — one message per recipient, so addresses aren't
disclosed to each other and one bad address can't fail the batch. Requires
`RESEND_API_KEY` + `RESEND_FROM`; absent, everything runs without email. Three
triggers, each gated on its own per-repo notification preference (all default on):

- **Gate failure** (`gateFailure`) — the **Spec Guard Check fails** on a blocking
  PR. Failure-only: no email for error Checks (infra/build/timeout — operator
  noise, visible in the jobs UI), neutral Checks, or stale/held-only outcomes.
- **Conflicts blocked** (`conflicts`) — scenario generation is blocked on open
  spec conflicts; links the Spec Guard → Coverage resolver.
- **Spec-regen offer** (`specRegen`) — a PR changed spec docs and the "regenerate
  guard scenarios" checkbox offer was posted; links the checkbox comment. Sent on
  the FIRST offer per PR only — re-arms on later pushes stay silent.

### Kill-switch and rollback (operators)

- **Kill-switch:** set `TRUECOURSE_GUARD_GATE_DISABLED` (truthy) to flip the gate
  to a **neutral Check with a "gate disabled" note** — no clone, no run. This
  stops a misbehaving gate in minutes without a redeploy. `0`/`false`/empty =
  enabled.
- **Rollback:** kill-switch first, then revision rollback if needed. Rollback is
  safe because every guard database migration is **purely additive** — the worst
  failure state is "temporarily un-gated," never "wrong engine." The verify engine
  never returns.
- **Concurrency:** `TRUECOURSE_GUARD_GATE_CONCURRENCY` bounds the worker pool (max
  concurrent guard-gate build+run executions per process, default 2) so concurrent
  PRs across tenants can't stampede the container. Gate execution is a durable job
  that survives a server restart; per-phase hard timeouts (build ~10 min, run
  ~15 min) settle a hung build as an error Check.

### Known v1 regression: workspace-level contracts

Workspace-level (cross-repo) contracts are **dropped in v1** with no guard
equivalent yet — a **documented known regression**, not a silent loss. The
cross-repo ripple that workspace contracts provided has no hosted guard analog
(workspace-level scenarios are a later design). **Contract generation code and
stores are dormant, not removed:** the data is preserved, and contracts return as
the planned **spec→code** linking layer (guard links spec→test today; contracts
will later link a failed scenario to the code that caused it). The client
Knowledge surface points at guard rather than presenting workspace contracts as a
live feature.

**Storage:** a `GateStore` interface — file-based by default
(`~/.truecourse/github-app/`), Postgres when `DATABASE_URL` is set (hosted).
Guard scenarios/runs/decisions are Postgres tables (additive migration) with
evidence transcripts in the blob store.

**Required GitHub App permissions:** Checks (write), Pull requests (write),
Contents (**read** — hosted guard stores scenarios server-side and needs no
commit-back), Metadata (read). Subscribe to `pull_request`, `push`,
`installation`, and `issue_comment` events. Set the webhook URL to
`<server>/api/ee/github/webhook` and the Setup URL to
`<server>/api/ee/github/setup`.

**Env** (see `.env.example`): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`; optional `RESEND_API_KEY` +
`RESEND_FROM` (guard-failure emails), `DATABASE_URL` (hosted Postgres store),
`TRUECOURSE_GUARD_GATE_DISABLED` (kill-switch — truthy disables the gate and PRs
get a neutral Check with a "gate disabled" note; `0`/`false`/empty = enabled),
and `TRUECOURSE_GUARD_GATE_CONCURRENCY` (max concurrent guard-gate build+run
executions per process, default 2).

## Error tracking (Sentry)

Server-side error tracking is **EE only** — the OSS server has no Sentry
dependency or import. `ee-server` initialises Sentry in its `register()` (which
the OSS loader awaits before building the app) and EE code reports exceptions
manually at the route/webhook seams (`observability/sentry.ts`,
`captureEeException`; the GitHub App reports from its fire-and-forget handlers
via `observability.ts`, `reportGithubError`). A failed Confluence/LLM key
connect therefore surfaces as a grouped issue **attributed to the customer org**
(`org_id`, plus `provider`/`connector`/`upstream_status` tags) instead of dying
silently on the server.

Two guarantees keep it strictly EE-scoped and secret-safe:

- **EE only.** The global uncaught-exception/unhandled-rejection integrations are
  removed, and `beforeSend` drops any event without our `component` tag — so an
  uncaught error from an OSS route is never sent.
- **Default-deny scrub.** `beforeSend` strips request data, breadcrumbs,
  contexts, stack-frame locals/source, and known secret shapes, and reduces the
  user to an opaque `org_id`. So the master secret, provider keys, integration
  tokens, Confluence page bodies, and customer source never leave the box.

Set `SENTRY_DSN` (EU-region DSN for EU residency) to enable; unset ⇒ no-op. See
`.env.example` for `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE`.

## Enablement

The enterprise plugin loads when `ee/` is present and built. Authentication
and Postgres are no longer the switch — the base dashboard server requires
both to boot. The GitHub App additionally requires the `GITHUB_APP_*` env
vars to light up `github-gate`.
