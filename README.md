<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/truecourse-logo-horizontal@2x.png" />
    <img src="assets/truecourse-logo-horizontal-light@2x.png" alt="TrueCourse" width="320" />
  </picture>
</p>

<p align="center">
  <strong>Tests that prove your product does what your documentation promises.</strong>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
  <a href="https://discord.gg/TanxB63arz"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

TrueCourse reads the documentation a team already writes (PRDs, ADRs, READMEs,
a documentation site) and turns it into tests that run.

It curates those documents into a corpus of **claims**, works out the **flows** a
user takes through the product, writes a test for each one against the real
interfaces, and runs them. A failing test means the product and the documentation
disagree, and it names which section.

**[docs.truecourse.dev](https://docs.truecourse.dev)** has the guides: connecting
documentation and a repository, how flows and claims fit together, the drivers,
and self-hosting.

## Run it locally

```bash
docker compose up -d                    # Postgres, the whole of the storage
pnpm install
TRUECOURSE_MODE=local pnpm dev          # http://localhost:3000
```

`TRUECOURSE_MODE=local` is one machine: no sign-in, one implicit person in one
implicit workspace, and folders on this machine can be connected as repositories.
It needs `DATABASE_URL` and `TRUECOURSE_SECRET_KEY`; the compose defaults are in
`.env.example`.

First stop is **Settings › Workspace**: say what your product is, in one
sentence. Documentation is kept or dropped by whether it describes that product,
so nothing connects — no repository, no documentation source, no scan — until the
workspace has said it. A hosted workspace states it when it is created; a local
one has no Create workspace dialog, so that page is where it is set.

## Run it on Claude Code

To run on your own Claude Code login instead of an API key:

```bash
docker compose up -d
pnpm install
TRUECOURSE_MODE=local TRUECOURSE_LLM_TRANSPORT=claude-code pnpm dev
```

This needs the `claude` binary on your PATH and signed in. Every run then uses
that login and the Models page is read-only; leave the variable out to save a
provider and key on that page instead.

One model runs everything — every call and every agent session of a run. On a
Claude Code login that model is `opus`, and `TRUECOURSE_MODEL` names another;
`TRUECOURSE_FALLBACK_MODEL` is what a call retries on when the primary is
overloaded. A workspace with its own API key names its one model on the Models
page instead, and these variables do not apply to it.

Every LLM call is a turn of an agent session, whether the work takes thirty
turns or one, so what a run spent is one record per session kind. Each turn is
priced at its model's published rates from OpenRouter's model list, one rate
per kind of token (input, output, cache read, cache write); until that list has
been fetched, or for a model it does not price, turns are recorded unpriced, and
a workspace on TrueCourse credits does not start a run at all. Settings › Usage
reads it back.

## Telemetry

The app sends product analytics to PostHog. The server sends every product
action: a repository connected or disconnected, a scan, setup, generation or run
starting and finishing, a context source added, a tool connection saved or
removed, a conflict resolved, a finding dismissed, a provider saved, an invite
link minted, a workspace created. Each
carries identifiers and kinds only, never a document, a key, a token or an
invite URL. It reads `POSTHOG_DISABLED`, `POSTHOG_KEY` and `POSTHOG_HOST` from
the repo-root `.env`.

The browser sends what only it can see: pageviews, autocaptured clicks and form
submits, the signed-in person's id, email and workspace, and the Join Discord
click. Three build-time variables control it:

| Variable | What it does |
| --- | --- |
| `VITE_POSTHOG_DISABLED` | `1` turns it off entirely: the client never starts. |
| `VITE_POSTHOG_KEY` | Send to your own PostHog project instead of TrueCourse's. |
| `VITE_POSTHOG_HOST` | The PostHog host. Default: `https://us.i.posthog.com`. |

`POSTHOG_DISABLED=1` turns off both halves at once, so a development machine
sends nothing.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the development setup, the project
structure and what makes a good pull request.

## Community

Join the [TrueCourse Discord](https://discord.gg/TanxB63arz) to ask questions,
share feedback, and follow what's shipping.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan**,
[mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

**MIT** for everything outside `ee/`. See [LICENSE](LICENSE).

**Enterprise** for `ee/`, which holds the document Connections, the extra
repository providers and multiple workspaces. Free to read and modify for
development; production use needs a subscription. See [ee/LICENSE](ee/LICENSE).
