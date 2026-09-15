# Pull request flow: an epic of its own

The pull request flow's spec: the decision of 2026-09-14 with the product
owner, after the one-app migration (PR #902) and the deletion of the old gate.
Nothing is built from it yet.

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

The gate is GONE — the spec half and the guard decisions overlay both. It was
all unreachable: nothing wrote its tables, no client read them. The epic starts
from a clean floor rather than someone else's half-built one.

What survives, and is what the epic builds on:

- **The webhook**, whole: it verifies a signature, resolves the installation and
  handles `installation`, `installation_repositories` and `push`. A
  `pull_request` or `issue_comment` event is received and ignored. Wiring a
  handler back is where this epic starts.
- **The workspace scan**, its corpus, its decisions and the ripple — the engine
  the overlay will run.
- **The jobs queue**, its single-flight per (workspace, key) and its heavy lane,
  which already rations the three heavy repository jobs to one at a time.
- **The run pipeline**: setup, generation and runs, already clone-and-copy, with
  a per-run working directory that is swept when the run settles.

What was deleted and must be REBUILT rather than revived: the pull-request
spec routes and their scope parsing, the per-pull-request corpus re-curation,
the spec decisions overlay, the guard decisions overlay (`guard:<repo>#pr/<n>`)
with its promote and discard, the `?pr=` query parameter on every guard route,
the gate-pending and gate-heads lookup seams with the pull-request run timeline
and the `pending` half of the `/guard/latest` envelope they fed, the re-gate
task, the App store's baseline, runs and pull-request half, the client's
plumbing, the connect summary's conflict count, and five tables — `gh_baselines`, `gh_runs`, `gh_prs`, `spec_sets`,
`pending_guard_baselines`. There is no client surface.

## 4. What the check reports, in order of value

1. **Conflicts the pull request creates** against the rest of the workspace: the
   new text contradicting another source. Only a workspace-wide view can see it.
2. **Sections that moved, and the flows that go stale** with them, since a
   changed section breaks the fingerprint its scenarios bind to.
3. **Which other repositories are affected**, computed from the bindings: the
   ripple that would fire on merge, named now rather than as a surprise later.
4. **The pull request's own run**: the flows regenerated at the head, executed,
   pass or fail. This is the part that becomes history.

## 5. What the migration taught, which this epic must not relearn

- **A write must land where its read comes from.** The old gate wrote decisions
  into a repository ledger while the corpus read folded the workspace's, so the
  action changed nothing and said nothing. If a pull request shows an overlay,
  every decision made on it must be read back from that same overlay.
- **One ledger, or a scope that is honest about itself.** Decisions are the
  workspace's. A pull request that needs its own must say so in the address of
  the row, and must sweep it — an overlay nobody promotes or discards is what
  made the last one dead weight.
- **A decision is a promise, not an effect.** An include or exclude changes
  nothing until the next scan applies it. The product shows this: the row says
  "at the next scan" and the workspace's changed-at stamp lights the Scan
  button. A pull request check must be equally explicit about what is already
  true and what is merely decided.
- **Conflicts stop generation, by design.** `POST /guard/generate` refuses a
  repository whose workspace slice has open conflicts, and the engine refuses
  again inside. A pull request that introduces a conflict therefore REPORTS it
  rather than generating past it, and says which repositories it blocks.
- **Clearing the last conflict starts what it blocked**, judged per repository
  against its own slice, since a conflict in documents a repository never reads
  never blocked it. A pull request's preview of the ripple follows the same
  rule.
- **The scan is cache-aware per document.** An overlay scan pays for the
  documents the pull request changed plus the settle and overlap passes, not for
  a whole corpus. That is what makes this affordable at all.
- **Pull requests are a provider's idea.** Local folders have none, and the
  provider registry is where a second provider would bring its own. The check
  must be offered by the provider, not assumed by the app.
- **A tab that reads a route nobody mounts is worse than no tab.** The old Pull
  requests tab shipped against a route that had never been wired and showed its
  own error. The surface lands with its route or not at all.

## 6. Open questions

- **Decisions inside a pull request.** Proposed: one ledger, the workspace's, and
  a conflict that exists only in the overlay is a finding to fix in the pull
  request rather than a verdict to record. The alternative (pull-request-scoped
  decisions that graduate on merge) is what the old gate did, is what was just
  deleted, and doubles the ledger.
- **A spec-only pull request** on a repository that is a source but is not
  connected in Code: no flows to run, but the workspace is still affected.
  Proposed: check it, and report only the conflicts and the affected repositories.
- **Cost.** An overlay scan on every push to every pull request is real money.
  Proposed: run only when the pull request touches files inside that source's
  scope, and only for the latest head.
- **Where the temporary state lives.** There is no storage for it any more: an
  overlay is a WORKSPACE corpus at a source's commit, and the scenario set and
  setup bundle a pull request produces are per-pull-request too. Design the keys
  with their sweep in mind, since everything a pull request makes is discarded
  when it closes or merges — and the run that survives it must not be.
- **What a check says on GitHub.** The old gate posted checks and review
  comments; that code is gone. Decide what the pull request shows in the
  provider's own interface, and what it shows in the product, before building
  either.
