# TrueCourse Enterprise Edition (`ee/`)

Commercial-licensed enterprise features that layer onto the open-source
core. **Everything in this directory is governed by [`ee/LICENSE`](./LICENSE),
not the repository's root MIT license.**

## Boundary rule

Imports are one-way: **`ee/` may import from OSS packages; OSS code must
never import from `ee/`.** OSS loads enterprise code only through the
sanctioned runtime seams (a server plugin loader and a client route/slot
registry), never via a static `import` of an `@truecourse/ee-*` package.
This keeps the OSS build free of commercial code and lets the community
edition run with `ee/` absent.

## Packages

- `packages/server` (`@truecourse/ee-server`) — enterprise server code
  (WorkOS SSO/auth) that registers into the dashboard server's plugin seam.
  It also composes the GitHub App package below.
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
inference, verification, analysis). A hosted enterprise deploy can't depend on
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

## GitHub App (PR gate)

Enterprise users install the App and connect a repo; on every PR it:

1. **Spec scan** — if the PR changes spec docs, offers (a checkbox comment) to
   re-scan + regenerate contracts and commit them back.
2. **Infer** — offers to reverse-engineer undocumented decisions from the
   changed code and commit them under `.truecourse/contracts/_inferred/`.
3. **Drift gate** — automatically verifies the PR head against the base,
   posts a **blocking GitHub Check** (advisory is per-repo configurable),
   a summary comment, and inline comments on each new drift. Fails the PR
   when it introduces new contract drift. The baseline is refreshed on merge
   to the default branch. Fork PRs are gated (read-only via the pull ref).

Configured per-repo addresses are emailed via [Resend](https://resend.com)
when: the drift gate **fails** on a blocking PR, a PR **adds spec documents**
worth re-scanning, or inference **captures new contracts** from a PR's code.

**Storage:** a `GateStore` interface — file-based by default
(`~/.truecourse/github-app/`), Postgres when `DATABASE_URL` is set (hosted).

**Required GitHub App permissions:** Checks (write), Pull requests (write),
Contents (**read & write** — scan/infer commit regenerated and inferred
contracts back to the PR branch), Metadata (read). Subscribe to `pull_request`,
`push`, `installation`, and `issue_comment` events. Set the webhook URL to
`<server>/api/ee/github/webhook` and the Setup URL to
`<server>/api/ee/github/setup`.

**Env** (see `.env.example`): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`; optional `RESEND_API_KEY` +
`RESEND_FROM` (email) and `DATABASE_URL` (hosted Postgres store).

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

Enterprise mode turns on when WorkOS is configured (or
`TRUECOURSE_EDITION=enterprise`). When off, the dashboard runs exactly as
the community edition with no authentication. The GitHub App additionally
requires the `GITHUB_APP_*` env vars to light up `github-gate`.
