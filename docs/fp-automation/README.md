# FP Detection Automation — Design

A loop that runs Truecourse against open-source repos, identifies false
positives (FPs), and converts each one into a fixture + visitor fix, one PR at
a time. Sessions are short-lived and triggered by GitHub events; cross-session
state lives in two places: a committed campaigns file
(`docs/fp-automation/campaigns.yaml` — which repos in what order, plus
baseline / final analyze results) and GitHub issues (one per rule with FPs).

The loop runs on **[Claude Code Routines](https://code.claude.com/docs/en/routines)**
— Anthropic-managed cloud sessions triggered by GitHub events. No
self-hosted runners, no `claude-code-action`, no VM you operate.

Status: design only. Not yet wired up.

## Goal

Targets and order are defined in `docs/fp-automation/campaigns.yaml`.
Sessions pick the first campaign with `status: pending`. When a campaign
finishes, sessions update that file in the campaign-close PR.

For each target OSS repo:

1. `pnpm install && pnpm build:dist` in the truecourse working copy,
   then `cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs analyze
   --no-llm --no-stash --no-skills` (the CLI operates on the cwd and
   writes results to `<cwd>/.truecourse/LATEST.json` — there's no path
   argument and no `--output` flag). Deterministic rules only — keeps
   cost bounded. We always invoke via the freshly-built `dist/`
   artifact — same bytes publish.yml will ship to npm. We never
   `npx truecourse` or `npm install truecourse`.
2. Triage violations into TPs / FPs.
3. For every rule with at least one FP, file one GitHub issue labelled
   `fp-fix` describing the rule, the target repo, links to OSS snippets,
   and the FP count. Open a discovery PR labelled `fp-discover` that
   updates `campaigns.yaml` with `status: discovering` + baseline
   numbers. The user reviews and merges this PR when ready to start
   the inner loop.
4. **Merging the discovery PR** lands the baseline on main and fires
   `fp-next-fix` (via its discovery-PR trigger). The fix loop then
   consumes the open `fp-fix` issues one at a time:
   a. Paraphrase one FP-triggering snippet from the issue into the
      `sample-js-project-positive` (or `…-python-positive`) fixture — the
      positive project asserts **zero violations**, so adding FP code there
      makes the test fail until the visitor is fixed.
   b. Add a paraphrased true-bug counterpart to the `…-negative` fixture
      with a `// VIOLATION: <rule-key>` comment, so we don't over-correct
      and break genuine detection.
   c. Fix the visitor / rule until both tests pass and full `pnpm test` is
      green.
   d. Commit, push to `claude/fp-fix/<rule-key>`, open a PR that closes the
      issue.
5. When the PR merges (closing the issue), the routine fires again and the
   next `fp-fix`-labelled issue is picked up automatically.
6. When no `fp-fix` issues remain for the current target, fp-next-fix
   **re-runs analyze against the freshly-built local dist** (containing
   every merged fix). If TP ≥ 90 %, it opens a **campaign-close PR**
   (see below) that bumps the version and flips campaign `status: done`.
   If TP < 90 %, it files new `fp-fix` issues; the campaign continues
   without a release.
7. When the campaign-close PR merges, two routines fire in parallel:
   `fp-campaign-close` pushes `vX.Y.Z` (publish.yml ships from dist —
   byte-equal to what fp-next-fix just verified), and `fp-discover`
   starts the next pending campaign.

### Campaign-close PR

When fp-next-fix's queue-empty path measures `tp_rate >= 0.90` against
the freshly-built dist, it opens a campaign-close PR that:

- Sets `status: done` for the campaign in
  `docs/fp-automation/campaigns.yaml` and fills `final.*` (analyzed_at,
  target_ref, total_violations, tp, fp, tp_rate).
- Bumps the patch version (FP fixes are bug fixes) in all four required
  places, per CLAUDE.md:
  1. `tools/cli/package.json`
  2. `packages/core/package.json`
  3. `apps/dashboard/server/package.json`
  4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call
- Carries the **`fp-campaign-complete`** label.
- Branch name `claude/fp-campaign-close/<owner>-<repo>`.

On merge, `fp-campaign-close` pushes the tag (publish.yml ships to npm)
and `fp-discover` fires on the same event to start the next pending
campaign — both routines run in parallel, each doing one job.

### Borderline FPs

Classification is not always clean. If a session is uncertain whether a
violation is a TP or FP, it does **not** auto-fix. Instead it posts a
comment on the relevant `fp-fix` issue tagged `borderline:`, with the OSS
snippet URL and a one-paragraph case for each interpretation. The user
triages these by adding `fp-confirmed` or `tp-confirmed` labels; the loop
only auto-fixes the confirmed FPs.

### Visitor refactors

If fixing a rule requires a refactor beyond the visitor itself — extracting
new type info, threading a new data-flow channel, changing the rule's
contract — the session does **not** attempt it. It still opens the PR with
the fixture additions and a `## Refactor needed` section in the PR body
describing what would be required, then labels the PR `needs-design` and
ends. The user decides whether to greenlight the refactor in a follow-up
or skip the rule.

### Fixture convention (confirmed against the repo)

| Fixture                  | Test asserts                                       | FP workflow role     |
|--------------------------|----------------------------------------------------|----------------------|
| `…-positive` project     | **Zero** violations across the whole project       | host for FP cases    |
| `…-negative` project     | Violations match `// VIOLATION: rule-key` comments | host for regression / true-bug cases |

`tests/analyzer/js-positive.test.ts`:
> Runs the full analyzer against `sample-js-project-positive` and asserts
> **ZERO code violations. Any violation found is a false positive.**

So an FP fix means:
- drop the paraphrased FP into `tests/fixtures/sample-{js,python}-project-positive/` (no annotation — its presence asserts "should not fire");
- drop the paraphrased true-bug into `…-project-negative/` with `// VIOLATION: <rule-key>`;
- before the visitor fix, the positive test fails;
- after the fix, both tests pass.

## Architecture

```
┌──────────────────────────┐        ┌─────────────────────────┐
│ campaigns.yaml           │───────▶│ Routine: fp-discover    │
│ ordered repo list +      │ pick   │ trigger: same as        │
│ baseline / final results │  next  │  fp-campaign-close,     │
└──────────────────────────┘        │  + Run now for bootstrap│
                                    │ (analyze via node       │
                                    │  dist/cli.mjs --no-llm, │
                                    │  files fp-fix issues)   │
┌─────────────────────────┐         └────────────┬────────────┘
│ Discovery PR            │◄─────────────────────┘
│ branch: claude/         │  baseline + status: discovering
│   fp-discover/<repo>    │  PR labelled fp-discover
│ label: fp-discover      │
└──────────┬──────────────┘
           │ you merge the discovery PR
           │ (baseline lands on main + fires fp-next-fix)
           ▼
┌─────────────────────────┐
│ N × GitHub issues       │
│ label: fp-fix           │  (already filed by fp-discover,
│ one per rule with FPs   │   before the discovery PR merged)
└──────────┬──────────────┘
           │ oldest open issue
           ▼
┌──────────────────────────────────────────────────────────┐
│ Routine: fp-next-fix                                     │
│ trigger A (bootstrap): pull_request.closed               │
│   Is merged=true, Head Branch starts-with                │
│   claude/fp-discover/, Labels is-one-of fp-discover      │
│ trigger B (continue):  pull_request.closed               │
│   Is merged=true, Head Branch starts-with                │
│   claude/fp-fix/, Labels is-one-of fp-fix                │
│                                                          │
│ 1. Pick oldest open fp-fix issue                         │
│ 2. Clone target OSS repo, re-confirm FP                  │
│ 3. Paraphrase into …-positive fixture (no annotation)    │
│ 4. Paraphrase true-bug into …-negative (+ marker)        │
│ 5. Fix visitor, full tests green                         │
│ 6. Push claude/fp-fix/<rule-key>, open PR (closes #N)    │
│ — OR, if queue empty and TP ≥ 90%:                       │
│   open campaign-close PR on claude/fp-campaign-close/*   │
│ — OR, if queue empty and TP < 90%: re-discover           │
└──────────────────────────────────────────────────────────┘
           ▲                              │
           │ on fp-fix PR merge           │
           │                              ▼
┌──────────────────────────────────────────────────────────┐
│ Routine: fp-campaign-close (parallel with fp-discover)   │
│ trigger: pull_request.closed                             │
│   Is merged=true, Head Branch starts-with                │
│   claude/fp-campaign-close/,                             │
│   Labels is-one-of fp-campaign-complete                  │
│                                                          │
│ 1. Read new version from tools/cli/package.json,         │
│    sanity-check the 4 locations agree                    │
│ 2. git tag vX.Y.Z, git push origin vX.Y.Z                │
│    (publish.yml ships dist/ to npm + creates GH Release) │
│                                                          │
│ No analyze, no verification — fp-next-fix already        │
│ measured TP ≥ 90% against the same dist artifact         │
│ publish.yml is about to ship.                            │
└──────────────────────────────────────────────────────────┘
```

No subscriptions, no idle waits, no runners — each merge fires a fresh
Anthropic cloud session via the routine's GitHub trigger.

## State: one issue per FP rule

Each `fp-fix` issue is the source of truth for one (rule, target repo) pair.
Body is a machine-readable YAML block followed by a human-readable section.

```yaml
target_repo: vercel/next.js
target_ref: main@abc1234              # commit pinned for reproducibility
rule_key: bugs/missing-await
fp_count: 41
samples:                              # up to 5 representative FP locations
  - url: https://github.com/vercel/next.js/blob/abc1234/packages/next/src/server/lib/router-utils/filesystem.ts#L210
    why_fp: "promise is awaited inside Array.from(..., async fn) which we don't follow"
  - url: …
status: open                          # open | in_review | merged | skipped | blocked
pr: null                              # filled when the fix PR is opened
```

Labels:
- `fp-fix` — gates the **fp-next-fix** routine.
- `fp-target:<owner-repo>` — groups issues by campaign; used to detect
  "campaign done" (no open issues with this label and `fp-fix`).
- `fp-in-progress` — concurrency lock; set by the routine the moment it
  picks an issue, before doing anything else.
- `fp-skipped` / `fp-blocked` — set by the session when bailing out.

The Claude session is the only writer. Ordering is "oldest open issue
without `fp-in-progress` first".

## Triggers: three Routines

All three routines run as Anthropic-managed cloud sessions on the same
cloud environment. Configuration is set up via the web UI at
[claude.ai/code/routines](https://claude.ai/code/routines).

**Prompt convention**: the routine config in the web UI holds a tiny
**bootstrap prompt** that points to the real prompt file in the cloned
repo. The actual instructions live under
`docs/fp-automation/prompts/<routine>.md` — this is the source of
truth, edited via PR and reviewable in diffs. The routine config
itself doesn't need to be kept in sync after the bootstrap prompt is
set.

Bootstrap prompt template (paste this into the routine's prompt field,
substituting the right file name):

```
Execute the instructions in `docs/fp-automation/prompts/<routine>.md`
from the cloned `truecourse-ai/truecourse` repository. Treat that file
as the authoritative prompt; follow every step exactly. If the file is
missing or unreadable, post a short failure note in the session and end.
```

The three actual bootstrap prompts (paste verbatim into each routine):

- `fp-discover`:
  > Execute the instructions in `docs/fp-automation/prompts/fp-discover.md` from the cloned `truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow every step exactly. If the file is missing or unreadable, post a short failure note in the session and end.

- `fp-next-fix`:
  > Execute the instructions in `docs/fp-automation/prompts/fp-next-fix.md` from the cloned `truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow every step exactly. If the file is missing or unreadable, post a short failure note in the session and end.

- `fp-campaign-close`:
  > Execute the instructions in `docs/fp-automation/prompts/fp-campaign-close.md` from the cloned `truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow every step exactly. If the file is missing or unreadable, post a short failure note in the session and end.

To change a prompt: edit the file under `docs/fp-automation/prompts/`,
open a PR, merge. The next routine fire reads the new version. No
web-UI edit needed.

### 1. `fp-discover` — populate issues for a campaign

| Field | Value |
|---|---|
| **Trigger** | GitHub event: `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-campaign-close/` AND `Labels` is one of `fp-campaign-complete` |
| **Bootstrap** | First-time run is **Run now** from the routine page (no PR has merged yet). Same button works for any manual re-run. |
| **Repositories** | `truecourse-ai/truecourse` |
| **Branch push policy** | Default (`claude/`-prefixed only) |
| **Environment** | **Default** (shared by all three routines; no customization needed) |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-discover.md` |

`fp-discover` shares its trigger event with `fp-campaign-close` — both
routines fire in parallel on every campaign-close PR merge.
`fp-discover` reads `campaigns.yaml` on `main` (the merged PR already
flipped the just-closed campaign to `status: done`) and picks the next
`pending` one.

Steps the session takes:
1. Read `docs/fp-automation/campaigns.yaml`. Pick the first campaign
   with `status: pending`. If none, end with "no pending campaigns".
2. Set its `status: discovering` on a `claude/fp-discover/<owner>-<repo>`
   branch + PR.
3. `pnpm install && pnpm build:dist` in the truecourse working copy
   (produces `dist/cli.mjs`, byte-equal to what publish.yml would
   ship). We never analyze via `npx truecourse` or `npm install`.
4. Clone the target repo at HEAD; record commit SHA as `target_ref`.
5. `cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm
   --no-stash --no-skills`. Read results from
   `/tmp/target/.truecourse/LATEST.json` (the `LatestSnapshot.violations[]`
   array).
6. Per rule with ≥ 1 violation: sample up to 10 violations, classify
   TP/FP. If FP rate ≥ 10 %, file an `fp-fix` +
   `fp-target:<owner>-<repo>` issue using the YAML schema above.
   Borderline cases get a comment on the issue, not auto-fix.
7. Commit a `baseline.*` update to the same discovery PR.
8. End. fp-next-fix fires automatically when the user merges the
   discovery PR (via fp-next-fix's Trigger A — `Head Branch` starts
   with `claude/fp-discover/`, `Labels` is one of `fp-discover`) and
   then on every subsequent fp-fix PR merge (Trigger B).

### 2. `fp-next-fix` — consume one fp-fix issue on each merge

| Field | Value |
|---|---|
| **Triggers (2)** | Both are `pull_request.closed` on `truecourse-ai/truecourse` |
| **Trigger A — discovery PR merge (bootstraps inner loop)** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-discover/` AND `Labels` is one of `fp-discover` |
| **Trigger B — fp-fix PR merge (continues inner loop)** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-fix/` AND `Labels` is one of `fp-fix` |
| **Repositories** | `truecourse-ai/truecourse` (target OSS repo cloned inside the session into `/tmp/target`) |
| **Branch push policy** | Default — branches are `claude/fp-fix/<rule-key>`, which fits the `claude/`-prefix rule |
| **Environment** | **Default** |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-next-fix.md` |

Why two triggers: the inner loop kicks off when you merge the
discovery PR (the moment baseline lands on main, and all fp-fix issues
have been filed). From the first fp-fix PR onward, each merge fires
the next session via Trigger B. This eliminates the manual "Run now
on fp-next-fix" bootstrap step that the previous design required, and
guarantees `campaigns.yaml`'s baseline numbers are on main before any
fp-fix work begins.

Steps the session takes:
1. List open issues with label `fp-fix` (excluding `fp-in-progress`).
   Pick the oldest. If none → go to "queue empty" path below.
2. Add label `fp-in-progress` to the issue (concurrency lock).
3. Parse the YAML block from the issue body. Clone target repo at
   `target_ref` to `/tmp/target`.
4. `pnpm install && pnpm build:dist`, then
   `cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm
   --no-stash --no-skills`. Read `/tmp/target/.truecourse/LATEST.json`
   and filter `.violations[]` to this rule. (Always dist, never
   `npx truecourse`.)
5. Re-confirm the FP still reproduces. If not (upstream fixed, or a
   previous fix already resolved it), close the issue with comment
   "no longer reproduces" and end.
6. Pick the most representative FP sample. Paraphrase (rename
   identifiers, change trivial structure, drop unrelated context) into
   `tests/fixtures/sample-{js,python}-project-positive/`. **No** `// VIOLATION`
   comment — the positive project asserts zero violations.
7. Paraphrase a true-bug variant into `…-project-negative/` with a
   `// VIOLATION: <rule-key>` comment.
8. Run `pnpm test 2>&1 | tee /tmp/test.log`. Confirm the new positive
   case fails and the new negative case passes.
9. Edit the rule under `packages/analyzer/src/rules/<domain>/…` until
   both pass and full `pnpm test` is green. No unrelated changes.
10. Push branch `claude/fp-fix/<rule-key>`. Open a PR with:
    - Label `fp-fix` (required for the next trigger to fire).
    - Body that includes `Closes #<issue>` and links the OSS sample URLs.
11. Comment on the issue with the PR link; leave the issue open (it auto-
    closes when the PR merges).
12. End. The next merge of that PR will refire the routine.

**Queue empty path** (no open `fp-fix` issues for the current campaign):

1. `pnpm install && pnpm build:dist` to rebuild dist with all merged
   fixes on `main`.
2. Re-clone target at `baseline.target_ref` to `/tmp/target`, then
   `cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs analyze
   --no-llm --no-stash --no-skills`. Read
   `/tmp/target/.truecourse/LATEST.json`; compute TP rate from
   `.violations[]`.
3. **If ≥ 90 %**: open a **campaign-close PR** on
   `claude/fp-campaign-close/<owner>-<repo>` containing:
   - `docs/fp-automation/campaigns.yaml` updated (`status: done`,
     `final.*` filled),
   - patch version bumped in all four locations from CLAUDE.md,
   - label `fp-campaign-complete`,
   - body listing the campaign's rule fixes by PR number and the
     before/after TP-rate (noting the measurement was taken against
     `node dist/cli.mjs` from the freshly-built dist).
4. **If < 90 %**: file new `fp-fix` issues for newly-discovered FPs
   (same shape as discovery). Leave campaign `status: in_progress`.
   **No campaign-close PR is opened** — no release is cut.
5. End. The campaign-close PR merge fires `fp-campaign-close` and
   `fp-discover` in parallel.

**Refactor-required path**: comment on the issue with a `## Refactor
needed` note, add `fp-blocked` label, end. The user triages later.

### 3. `fp-campaign-close` — tag and chain to the next campaign

| Field | Value |
|---|---|
| **Trigger** | GitHub event: `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-campaign-close/` AND `Labels` is one of `fp-campaign-complete` |
| **Repositories** | `truecourse-ai/truecourse` |
| **Branch push policy** | Default — only needs to push a tag, not a branch |
| **Environment** | **Default** |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-campaign-close.md` |

Steps the session takes:
1. Read new version from `tools/cli/package.json`. Sanity-check the
   other three locations agree (CLAUDE.md "Releasing").
2. `git tag v<version> && git push origin v<version>`. The existing
   `.github/workflows/publish.yml` triggers, ships `dist/` to npm,
   creates the GitHub Release.
3. End. No verification step — fp-next-fix already measured TP ≥ 90 %
   against the same dist artifact publish.yml is shipping.

`fp-discover` listens to the same merge event and runs in parallel,
starting the next pending campaign from `campaigns.yaml`.

## Setup checklist

One-time, before the first run:

1. **Install the Claude GitHub App** on `truecourse-ai/truecourse`
   ([github.com/apps/claude](https://github.com/apps/claude)). Required
   for GitHub-event triggers to deliver webhooks.
2. **Enable "Automatically delete head branches"** in repo settings →
   General. Keeps `claude/fp-fix/*` and `claude/fp-campaign-close/*`
   branches tidy.
3. **Create the three routines** at
   [claude.ai/code/routines](https://claude.ai/code/routines), pasting
   the bootstrap prompts (see [Prompt convention](#triggers-three-routines)).
   Trigger configs are listed under each routine above — note that
   `fp-discover` and `fp-campaign-close` share the exact same trigger
   (they fire in parallel on each campaign-close PR merge).

   Use the **Default** environment for all three — no custom env is
   needed because:
   - Default already uses **Trusted** network access (allowlist covers
     npm, GitHub, and the OSS repos we clone over HTTPS).
   - pnpm is pre-installed; project deps (`pnpm install && pnpm build:dist`)
     run inside each session as the prompt's first step, not via a
     setup script. (Setup scripts run **before** the per-session repo
     clone, so they can't `pnpm install` anything from the repo.)
   - No env vars are required.
4. **Bootstrap the first campaign** by clicking **Run now** on
   `fp-discover` (no campaign-close PR has merged yet, so the GitHub
   trigger has nothing to fire on). It reads `campaigns.yaml`, finds
   the first pending campaign (today: `documenso/documenso`), files
   the initial `fp-fix` issues, and opens the discovery PR labelled
   `fp-discover`.
5. **Review and merge the discovery PR.** Merging it lands the
   baseline numbers on main *and* fires `fp-next-fix` (via its
   discovery-PR trigger), kicking off the inner loop on the first
   issue. From this first fp-fix PR onward, every fp-fix PR merge
   fires `fp-next-fix` automatically until the campaign queue is
   empty.
6. **Outer loop is fully automatic**: when the queue empties,
   fp-next-fix re-analyzes against the freshly-built dist; if TP ≥ 90 %
   it opens a campaign-close PR. Merging that PR fires
   `fp-campaign-close` (tags + publishes) and `fp-discover` (starts
   the next pending campaign's discovery) in parallel — and merging
   *that* next discovery PR restarts the inner loop. No "Run now"
   needed after the very first campaign.

## Acceptance criteria

An **fp-fix PR** is mergeable when:

- New positive-fixture case for the FP exists and the test passes (no
  violation fires).
- New negative-fixture case for the true-bug pattern exists with
  `// VIOLATION:` comment and the test passes.
- Full `pnpm test` is green (no regressions).
- PR body links the original OSS snippet (URL only — no paste, to keep
  clear of upstream licences) and shows the paraphrased fixture diff
  inline.
- PR closes its parent issue.
- Branch matches `claude/fp-fix/<rule-key>` and carries label `fp-fix`.

A **campaign-close PR** is mergeable when:

- The targeted campaign in `docs/fp-automation/campaigns.yaml` is updated
  to `status: done` with `final.*` filled.
- Patch version is bumped consistently in all four required locations
  (CLAUDE.md "Releasing" section).
- No other file changes (no fixture or visitor edits — those go in
  fp-fix PRs).
- Branch matches `claude/fp-campaign-close/<owner>-<repo>` and carries
  label `fp-campaign-complete`.

A repo is "done" when its campaign-close PR is merged and `vX.Y.Z` is
tagged. The 90 % gate was verified pre-merge by fp-next-fix against the
dist artifact; `fp-discover` fires on the same merge event to start the
next pending campaign automatically. The campaigns file is the audit
trail.

## Resolved decisions

1. **Runtime**: Claude Code **Routines** (Anthropic-managed cloud
   sessions). All three routines fire on `pull_request.closed` events
   with filters; `fp-discover` and `fp-campaign-close` share the same
   trigger and fire in parallel. First-time bootstrap is **Run now**.
   No self-hosted runners, no API tokens, no env vars.
2. **Verification is pre-release**, against the local `dist/` build:
   `pnpm build:dist` produces the exact artifact publish.yml ships to
   npm (no transformation in between). So `node dist/cli.mjs analyze`
   gives the same answer the eventual published version would. We
   never `npx truecourse` or `npm install truecourse` from any
   routine; the local dist is the authoritative invocation.
3. **Paraphrasing licence**: paraphrased snippets must be far enough from
   the original to stand alone. PR description links the source rather
   than embedding it. Open question — still worth a legal sanity-check
   before running across GPL/AGPL repos.
4. **Borderline FPs**: not auto-fixed. Session posts a `borderline:`
   comment on the issue with both interpretations; user adds
   `fp-confirmed` / `tp-confirmed` to decide.
5. **Visitor refactors**: not auto-attempted. Session opens the PR with
   the fixtures and a `## Refactor needed` note, labels it
   `needs-design`, ends.
6. **Cost control**: analyze runs `--no-llm` (deterministic rules only).
   Routine sessions draw down the claude.ai subscription's daily routine
   cap + regular subscription usage (not API spend on an
   `ANTHROPIC_API_KEY`).
7. **Branch hygiene**: branches use the `claude/` prefix
   (`claude/fp-fix/<rule-key>`, `claude/fp-campaign-close/<owner>-<repo>`,
   `claude/fp-discover/<owner>-<repo>`) to fit the routine default
   push policy. Auto-delete head branches on merge.
8. **Concurrency**: session adds `fp-in-progress` to the picked issue
   before doing anything else; competing sessions skip labelled issues.
9. **Target order**: `docs/fp-automation/campaigns.yaml` is the source of
   truth. Sessions pick the first non-`done`, non-`skipped` campaign.

## What's next

If green-lit:

1. Prompts are committed under `docs/fp-automation/prompts/`:
   - `fp-discover.md`
   - `fp-next-fix.md`
   - `fp-campaign-close.md`
2. Walk through the "Setup checklist" above to install the GitHub App,
   enable branch auto-delete, and create the three routines (all on the
   **Default** cloud environment).
3. Click **Run now** on `fp-discover` to start the first campaign.
   From there:
   - **Inner loop** (auto): fp-fix PR merges drive `fp-next-fix` until
     the campaign queue is empty.
   - **Outer loop** (auto): campaign-close PR merges fire
     `fp-campaign-close`, which tags + publishes + verifies against the
     just-published version. If TP < 90 % it files new fp-fix issues
     and the inner loop resumes.
   - **Next campaign** (manual): once a campaign reaches
     `status: done`, click **Run now** on `fp-discover` again.
