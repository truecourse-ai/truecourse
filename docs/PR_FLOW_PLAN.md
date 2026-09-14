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

## 3. What exists today (2026-09-14, after the gate was deleted on PR #902)

The gate is GONE. It was all unreachable — nothing wrote its tables, no client
read them — so carrying a half-wired version helped nobody, and the epic starts
from a clean floor rather than from someone else's half-built one.

What survives, and is what the epic builds on:

- **The webhook**, whole: it verifies a signature, resolves the installation and
  handles `installation`, `installation_repositories` and `push`. A
  `pull_request` or `issue_comment` event is received and ignored. Wiring a
  handler back is where this epic starts.
- **The workspace scan**, its corpus, its decisions and the ripple — the engine
  the overlay will run.
- **The jobs queue**, its single-flight and its heavy lane.
- **The run pipeline**: setup, generation and runs, already clone-and-copy.

What was deleted with it, and must be rebuilt rather than revived: the
pull-request-scoped write path in the spec routes, the per-pull-request corpus
re-curation, the decisions overlay scoped to a pull request, the re-gate task,
the baseline/runs/pull-request half of the App's store, the client's
pull-request plumbing, and five tables — `gh_baselines`, `gh_runs`, `gh_prs`,
`spec_sets` and `pending_guard_baselines`. There is no client surface.

One piece of the old gate is still in the tree and wants its own sweep: the
GUARD decisions overlay scoped to a pull request (`guard:<repo>#pr/<n>`), which
is unreachable but roughly as large again as the deletion above.

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
- **Where the temporary state lives.** There is no storage for it any more:
  an overlay is a WORKSPACE corpus at a source's commit, and the scenario set
  and setup bundle a pull request produces are per-pull-request too. Design the
  keys with their sweep in mind, since everything a pull request makes is
  discarded when it closes or merges.
