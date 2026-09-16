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

## Run it on TrueCourse credits

A hosted deployment can let a workspace run without bringing a key of its own.
Set both of these in the repo-root `.env` and "TrueCourse credits" appears as a
choice on the Models page:

| Variable | What it does |
| --- | --- |
| `TRUECOURSE_CREDITS_OPENAI_API_KEY` | The platform's own OpenAI key. Read per run; never stored, logged or answered with. |
| `TRUECOURSE_CREDITS_MODEL` | The OpenAI model id those runs use. |

A workspace that picks it stores nothing — no key, no model — and spends a
BALANCE instead: one credit is a cent of model spend at list price, with nothing
added. Every call and every turn is checked against the balance before it is
made and debited after, against the same `llm_usage` row the Usage tab reads, so
Settings › Credits and Settings › Usage agree to the cent. A run that empties the
balance PAUSES: its sessions park with their journals intact, the feed says
"Paused, out of credits", and it carries on from where it got to when an
operator grants more (`/operator/credits`), when the workspace saves a key of its
own, or when somebody presses Resume. With either variable unset the choice is
not offered, and local mode has no credits at all.

## Telemetry

The app sends product analytics to PostHog. The server sends every product
action: a repository connected or disconnected, a scan, setup, generation or run
starting and finishing, a context source added, a conflict resolved, a finding
dismissed, a provider saved, an invite link minted, a workspace created, credits
granted or exhausted, a run paused or resumed. Each
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

MIT
