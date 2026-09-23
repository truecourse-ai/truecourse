# TrueCourse — Claude Instructions

TrueCourse turns the documentation a team writes into tests that prove the
product does what the documents promise. A workspace gathers documents from its
sources, curates them into one corpus, derives a flow from what that corpus
claims, writes and proves a test per flow, and runs them. The dashboard is
where that is started and watched.

## This file instructs; the code describes itself

What is here is what you cannot read off the tree: the rules, the decisions
already made, and where to start looking. How a package works, what a function
does and which job runs when are in the code, and the detail about a module
belongs in the comment at the top of that module, where it moves with what it
describes. So do not restate code here — a description in this file goes stale
in silence, and the next session will trust it over the tree.

## Rules

- **No workarounds.** Find and fix the root cause. No hacks, no fallbacks, no
  temporary patches to get past something. If it is not working, find out why.
- **Dev servers belong to the user.** Never start, stop or restart one. If a
  restart is needed, say so and leave it to them.
- **Keep `README.md` true.** A new package, endpoint or environment variable is
  a change to the README in the same breath.
- **No Claude Code session details in commits, PRs or issues.** Strip any
  `Claude-Session:` trailer or session URL before committing or opening one.

## Commands

```bash
docker compose up -d              # Postgres, which is the whole of the storage
TRUECOURSE_MODE=local pnpm dev    # client + server, no sign-in
pnpm build                        # every package
pnpm test                         # the whole suite (vitest)
pnpm typecheck
```

The suite needs `pnpm build` once first, since tests resolve workspace packages
from `dist/`, and Playwright's Chromium, without which the web-driver suites
fail hard by design. Save a run's output to a file and read it back rather than
re-running with different filters.

## Where to look

- `apps/dashboard/` — the product: a Vite + React client, and an Express server
  that is a thin adapter over the engine. `apps/landing/` is the marketing
  site, standalone and deployed on its own.
- `packages/core/` — the engine the server runs, and the store seams everything
  durable reaches Postgres through. `packages/shared/` — what both sides use.
- The rest of `packages/` holds the deterministic halves of the pipeline (the
  document scan, flow generation, the runner, the interface catalog), the two
  LLM backends and the agent loop between them, the database and its store
  implementations, the background job runner, and the GitHub App.
- `ee/` — the enterprise edition, client and server.
- `tests/` — every test, named after the package it covers, with the fixture
  repos they drive under `tests/fixtures/`.

Whatever file you open, its module comment is the first thing to read.

## Decisions

These are settled. Work with them rather than around them, and raise it with
the user if one looks wrong.

**Editions.** The product is open except three things, which live in `ee/` and
REGISTER into the open shell rather than being imported by it: the document
Connections, repository providers beyond the open edition's, and more than one
workspace. One build and one process entry carry both; which edition a process
is comes from whether `ee/` sits beside the open tree, and what a workspace may
USE of it is a per-workspace grant an operator makes. The dependency runs ONE
WAY, from `ee/` inward — no open source file reaches into `ee/`, and the one
seam on each side is pinned by a test in `tests/architecture/`.

**Modes.** A server is TOLD how it runs (`TRUECOURSE_MODE`, `hosted` or
`local`) and never guesses. Both hand everything downstream the same things, so
no route, job or store knows which mode it is in.

**Storage.** One storage: Postgres. `packages/core` owns a seam per kind of
durable state and must never import `packages/data-store`, which implements
them; the server installs them at boot. Nothing is installed by default, so a
process that never booted fails loud instead of inventing an empty store. A new
piece of durable state is therefore three edits: the seam, the implementation,
the installation.

**A run's work tree.** A run works on an ephemeral copy of the repository with
a `.truecourse/` directory inside it. All of it is scratch: a job materializes
what the run needs out of Postgres and collects the result back, and nothing in
the tree outlives the run, is shown to anyone, or is committed. Every path
inside it is derived in `packages/shared/src/fs/work-tree.ts` — add a document
by adding it there, never by spelling the segments at the call site.

**Generated state is versioned, never overwritten.** Everything a run
produces is a series: each producing run inserts a new version stamped with its
run and model, and the current one is the newest of its scope. A rollback
inserts a copy. Only the decisions ledgers are edited in place.

**Cache keys never fold a prompt's text.** Each LLM stage carries a hand-bumped
`*_STAGE_VERSION`: a prompt change that fixes wrong output bumps it in the same
commit, and any other prompt edit invalidates nothing. A flow and a setup step
settle by NAMED inputs, so changing what a key folds is a change to that list
of names.

**Conventions.** Tests live in `tests/`, never beside the source. Types shared
between client and server live in `packages/shared`. Comments say what is true
now, never what the plan was or which change introduced it.

## Releasing

There is no npm publishing. A GitHub Release on a `main` commit deploys
production, and staging deploys from a `deploy-dev` pull request label or a
dispatch; both refuse commits not on `main`. See `infra/azure/vm/DEPLOYMENT.md`.
