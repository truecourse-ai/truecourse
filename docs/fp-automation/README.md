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

1. Run `truecourse analyze --no-llm` (deterministic rules only — keeps cost
   bounded; LLM-rule FPs are a separate phase).
2. Triage violations into TPs / FPs.
3. For every rule with at least one FP, file one GitHub issue labelled
   `fp-fix` describing the rule, the target repo, links to OSS snippets, and
   the FP count.
4. The fix loop consumes the open `fp-fix` issues one at a time:
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
6. When no `fp-fix` issues remain open for the current target, re-run
   `truecourse analyze --no-llm`. If TP rate ≥ 90 %, open a **campaign-close
   PR** (see below). When that PR merges, a different routine pushes
   `vX.Y.Z` and dispatches the next campaign's discovery run.

### Campaign-close PR

When a campaign hits ≥ 90 % TP, the session opens a single PR that:

- Sets `status: done` for the campaign in `docs/fp-automation/campaigns.yaml`.
- Fills the `final.*` block (analyzed_at, target_ref, total_violations,
  tp, fp, tp_rate).
- Bumps the patch version (FP fixes are bug fixes) in all four required
  places, per CLAUDE.md:
  1. `tools/cli/package.json`
  2. `packages/core/package.json`
  3. `apps/dashboard/server/package.json`
  4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call
- Carries the **`fp-campaign-complete`** label.
- Branch name `claude/fp-campaign-close/<owner>-<repo>`.

On merge, two routines fire in parallel on the same event:
- **fp-campaign-close** reads the new version from
  `tools/cli/package.json`, creates and pushes `vX.Y.Z`. The existing
  `.github/workflows/publish.yml` picks the tag up and publishes
  `truecourse` to npm + creates the GitHub Release.
- **fp-discover** reads `campaigns.yaml` (which the merged PR already
  flipped to `status: done` for the just-closed campaign), picks the
  next `pending` campaign, and starts discovery.

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
│ ordered repo list +      │ next   │ trigger: same as        │
│ baseline / final results │        │  fp-campaign-close,     │
└──────────────────────────┘        │  + Run now for bootstrap│
                                    │ (analyze --no-llm,      │
                                    │  writes baseline back,  │
                                    │  files fp-fix issues)   │
┌─────────────────────────┐         └────────────┬────────────┘
│ N × GitHub issues       │◄─────────────────────┘
│ label: fp-fix           │
│ one per rule with FPs   │
└──────────┬──────────────┘
           │ oldest open issue
           ▼
┌──────────────────────────────────────────────────────────┐
│ Routine: fp-next-fix                                     │
│ trigger: pull_request.closed                             │
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
│ 1. Read new version from tools/cli/package.json          │
│ 2. git tag vX.Y.Z, git push --tags                       │
│    (existing publish.yml ships to npm + GitHub Release)  │
│                                                          │
│ fp-discover listens to the SAME merge event and runs in  │
│ parallel — it reads campaigns.yaml on main (which the    │
│ merged PR already flipped to status: done) and starts    │
│ discovery for the next pending campaign.                 │
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
| **Environment** | `fp-automation` (shared with the other two routines) |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-discover.md` |

`fp-discover` shares its trigger event with `fp-campaign-close` — both
routines fire in parallel on every campaign-close PR merge. `fp-discover`
reads `campaigns.yaml` on `main` (the merged PR already flipped the
just-closed campaign to `status: done`) and picks the next `pending` one.

Steps the session takes:
1. Read `docs/fp-automation/campaigns.yaml` from `main` on
   `truecourse-ai/truecourse`. Pick first campaign with `status: pending`
   (unless `text` overrides).
2. Set its `status: discovering` (PR to bump the YAML is allowed; the
   campaign-close PR will flip to `done` later).
3. Clone the target repo at HEAD; record commit SHA as `target_ref`.
4. `pnpm build && pnpm exec truecourse analyze /tmp/target --no-llm`.
5. Per rule with ≥ 1 violation: sample up to 10 violations, classify
   TP/FP. If FP rate ≥ 10 %, file an `fp-fix` + `fp-target:<owner>-<repo>`
   issue using the YAML schema above. Borderline cases get a comment
   on the issue, not auto-fix.
6. Commit a `baseline.*` update PR to `docs/fp-automation/campaigns.yaml`
   (separate from any FP fix PRs).
7. End. The next `fp-next-fix` invocation (manual the first time, then
   automatic on each PR merge) consumes the issues.

### 2. `fp-next-fix` — consume one fp-fix issue on each merge

| Field | Value |
|---|---|
| **Trigger** | GitHub event: `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-fix/` AND `Labels` is one of `fp-fix` |
| **Repositories** | `truecourse-ai/truecourse` (target OSS repo cloned inside the session into `/tmp/target`) |
| **Branch push policy** | Default — branches are `claude/fp-fix/<rule-key>`, which fits the `claude/`-prefix rule |
| **Environment** | `fp-automation` |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-next-fix.md` |

Steps the session takes:
1. List open issues with label `fp-fix` (excluding `fp-in-progress`).
   Pick the oldest. If none → go to "queue empty" path below.
2. Add label `fp-in-progress` to the issue (concurrency lock).
3. Parse the YAML block from the issue body. Clone target repo at
   `target_ref` to `/tmp/target`.
4. `pnpm build && pnpm exec truecourse analyze /tmp/target --no-llm`.
   Filter to this rule.
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

1. Re-run `truecourse analyze /tmp/target --no-llm`. Compute TP rate.
2. If ≥ 90 %: open a **campaign-close PR** on
   `claude/fp-campaign-close/<owner>-<repo>` containing:
   - `docs/fp-automation/campaigns.yaml` updated (`status: done`,
     `final.*` filled),
   - patch version bumped in all four locations from CLAUDE.md,
   - label `fp-campaign-complete`,
   - body listing the campaign's rule fixes by PR number and the
     before/after TP-rate.
3. If < 90 %: file new `fp-fix` issues for newly-discovered FPs (same
   shape as discovery). Leave campaign `status: in_progress`.
4. End. The campaign-close PR merge fires `fp-campaign-close`.

**Refactor-required path**: comment on the issue with a `## Refactor
needed` note, add `fp-blocked` label, end. The user triages later.

### 3. `fp-campaign-close` — tag and chain to the next campaign

| Field | Value |
|---|---|
| **Trigger** | GitHub event: `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | `Is merged` equals `true` AND `Head Branch` starts with `claude/fp-campaign-close/` AND `Labels` is one of `fp-campaign-complete` |
| **Repositories** | `truecourse-ai/truecourse` |
| **Branch push policy** | Default — only needs to push a tag, not a branch |
| **Environment** | `fp-automation` |
| **Prompt** | Bootstrap pointer (see [Prompt convention](#triggers-three-routines)) → `docs/fp-automation/prompts/fp-campaign-close.md` |

Steps the session takes:
1. Check out `main` at the merge commit. Read the version from
   `tools/cli/package.json`.
2. `git tag v<version> && git push origin v<version>`. The existing
   `.github/workflows/publish.yml` triggers on the tag and publishes
   `truecourse` to npm + creates the GitHub Release.
3. End.

`fp-discover` fires on the same event independently — there's no chained
call from this routine.

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
   the prompts from `docs/fp-automation/prompts/`. In the routine form,
   the cloud icon next to the prompt opens the environment selector —
   the first routine you create can use it to **Add environment** named
   `fp-automation` with:
   - Network access: **Trusted** (default allowlist covers npm, GitHub,
     and the OSS repos we clone over HTTPS).
   - Setup script: `pnpm install && pnpm build`.
   - Environment variables: none required.

   The other two routines pick the existing `fp-automation` from the
   same selector. Trigger configs are listed under each routine above.
4. **Kick off the first run** by clicking **Run now** on `fp-discover`.
   It reads `campaigns.yaml`, finds the first pending campaign
   (today: `documenso/documenso`), and files the initial `fp-fix`
   issues. From here, the loop drives itself.

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

A repo is "done" when its campaign-close PR is merged, `vX.Y.Z` is tagged,
and the `fp-campaign-close` routine has fired `fp-discover` for the next
campaign. The campaigns file is the audit trail.

## Resolved decisions

1. **Runtime**: Claude Code **Routines** (Anthropic-managed cloud
   sessions), triggered entirely by GitHub events
   (`pull_request.closed` + filters). No self-hosted runners, no API
   tokens, no env vars on the environment. First-time bootstrap is a
   manual **Run now** click on `fp-discover`.
2. **Paraphrasing licence**: paraphrased snippets must be far enough from
   the original to stand alone. PR description links the source rather
   than embedding it. Open question — still worth a legal sanity-check
   before running across GPL/AGPL repos.
3. **Borderline FPs**: not auto-fixed. Session posts a `borderline:`
   comment on the issue with both interpretations; user adds
   `fp-confirmed` / `tp-confirmed` to decide.
4. **Visitor refactors**: not auto-attempted. Session opens the PR with
   the fixtures and a `## Refactor needed` note, labels it
   `needs-design`, ends.
5. **Cost control**: analyze runs `--no-llm` (deterministic rules only).
   Routine sessions draw down the claude.ai subscription's daily routine
   cap + regular subscription usage (not API spend on an
   `ANTHROPIC_API_KEY`).
6. **Branch hygiene**: branches use the `claude/` prefix
   (`claude/fp-fix/<rule-key>`, `claude/fp-campaign-close/<owner>-<repo>`)
   to fit the routine default push policy. Auto-delete head branches on
   merge.
7. **Concurrency**: session adds `fp-in-progress` to the picked issue
   before doing anything else; competing sessions skip labelled issues.
8. **Target order**: `docs/fp-automation/campaigns.yaml` is the source of
   truth. Sessions pick the first non-`done`, non-`skipped` campaign.

## What's next

If green-lit:

1. Prompts are committed under `docs/fp-automation/prompts/`:
   - `fp-discover.md`
   - `fp-next-fix.md`
   - `fp-campaign-close.md`
2. Walk through the "Setup checklist" above to install the GitHub App,
   enable branch auto-delete, and create the three routines (sharing
   the `fp-automation` cloud environment).
3. Click **Run now** on `fp-discover`. From there:
   - Inner loop: fp-fix PR merges drive `fp-next-fix` until the campaign
     queue is empty.
   - Outer loop: campaign-close PR merges fire both `fp-campaign-close`
     (tags the release; publish.yml ships to npm) and `fp-discover`
     (starts the next campaign's discovery) in parallel on the same
     event.
