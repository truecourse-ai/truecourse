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

## Enablement

Enterprise mode turns on when WorkOS is configured (or
`TRUECOURSE_EDITION=enterprise`). When off, the dashboard runs exactly as
the community edition with no authentication. The GitHub App additionally
requires the `GITHUB_APP_*` env vars to light up `github-gate`.
