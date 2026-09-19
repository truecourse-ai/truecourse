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

Two licenses, split by directory.

**MIT** covers everything outside `ee/`: the engine, the dashboard, the server,
the shared packages and the tests. That is the whole product except the three
features below. Use it, fork it, run it in production, sell what you build on
it. See [LICENSE](LICENSE).

**The TrueCourse Enterprise Edition License** covers `ee/` and everything under
it. That directory holds three features: the document Connections (Settings ›
Connections, and the Jira and Confluence source drivers), repository providers
beyond the open edition's, and more than one workspace. You may read, copy and
modify it for development and testing. Using it in production, or providing its
functionality to anyone else as a hosted service or otherwise, needs a
TrueCourse Enterprise subscription. See [ee/LICENSE](ee/LICENSE).

The split is by directory and nothing else. `ee/` depends on the open tree and
registers into it; no open file imports `ee/`, which is pinned by a test. So a
checkout with `ee/` removed is the MIT product, whole and working.
