# Pull request flow: an epic of its own

Decided 2026-09-14 with the product owner, after the one-app migration (PR #902).
Nothing is built from this yet. Untracked, never committed.

## 1. The decision

A pull request is checked in two halves, and everything either half produces is
TEMPORARY, scoped to that pull request.

- **The spec half.** If the pull request's repository is connected as a context
  SOURCE and the pull request changes its documents, the scan re-runs and stores
  a version of the corpus for that pull request alone.
- **The code half.** Setup re-runs, to see whether the recipe changed or the
  interfaces moved, and generation follows for the flows that are new or
  changed. Every artifact it writes — a new flow, an edited one, a removed one —
  is stored for that pull request alone.
- **On merge, all of it is discarded.** What survives is the RUN: the pull
  request's own result, kept as history.

## 2. Why temporary, and never shared

Context belongs to the workspace. The corpus is built from every source at its
default branch, and each repository reads a slice of it. A pull request proposes
a different version of one source's documents, so scanning it into the shared
corpus would change what every other repository reads, from an unmerged branch.
The pull request's corpus is therefore an OVERLAY: the workspace's, with that one
source's documents taken from the head, stored under the head commit and never
promoted. The same holds for the code half: a pull request's scenarios are its
own until it merges.

On merge nothing new has to happen. The push to the default branch already
syncs the source, runs the workspace scan and ripples generation to every
repository whose slice moved. The pull request check is a preview of exactly
that, through the same engine.

## 3. What exists today (verified 2026-09-14, on PR #902)

- The webhook receives `pull_request` events, verifies them and resolves the
  installation, then DROPS them: nothing supplies the handler since the
  enterprise server was deleted (`packages/github-app/src/webhook.ts`, the
  `onPullRequest` hook).
- The pull-request-scoped write path survives in `apps/dashboard/server/src/routes/spec.ts`
  (`?pr=` + `?ref=`, the decisions overlay, `recuratePrCorpus`, the `pr.regate`
  enqueue) but is inert: no client calls it, and nothing installs the background
  runner the enqueue needs.
- The tables are kept for this epic and are NOT to be dropped: `gh_runs`,
  `gh_prs`, `gh_baselines`, and the per-commit corpus in `spec_sets`.
- There is no client surface at all: the Pull requests tab was removed with the
  route it read.

So this epic starts with: a webhook that authenticates and routes, a place to
hang the handler, a working per-commit corpus writer, storage for gate runs and
checks, one job runner, and no user interface.

## 4. What the check reports, in order of value

1. **Conflicts the pull request creates** against the rest of the workspace: the
   new text contradicting another source. Only a workspace-wide view can see it.
2. **Sections that moved, and the flows that go stale** with them, since a
   changed section breaks the fingerprint its scenarios bind to.
3. **Which other repositories are affected**, computed from the bindings: the
   ripple that would fire on merge, named now rather than as a surprise later.
4. **The pull request's own run**: the flows regenerated at the head, executed,
   pass or fail. This is the part that becomes history.

## 5. Open questions

- **Decisions inside a pull request.** Proposed: one ledger, the workspace's, and
  a conflict that exists only in the overlay is a finding to fix in the pull
  request rather than a verdict to record. The alternative (pull-request-scoped
  decisions that graduate on merge) is what the old gate did and doubles the
  ledger.
- **A spec-only pull request** on a repository that is a source but is not
  connected in Code: no flows to run, but the workspace is still affected.
  Proposed: check it, and report only the conflicts and the affected repositories.
- **Cost.** An overlay scan on every push to every pull request is real money.
  Proposed: run only when the pull request touches files inside that source's
  scope, and only for the latest head.
- **Where the temporary state lives.** `spec_sets` is keyed by repository and
  commit; an overlay is a WORKSPACE corpus at a source's commit. Either widen
  that key or give the pull request its own table. The same question applies to
  the scenario set and the setup bundle a pull request produces, and to how all
  of it is swept when the pull request closes or merges.
