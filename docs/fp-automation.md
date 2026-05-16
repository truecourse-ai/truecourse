# FP Detection Automation — Design

A loop that runs Truecourse against open-source repos, identifies false
positives (FPs), and converts each one into a fixture + visitor fix, one PR at
a time. Sessions are short-lived and triggered by GitHub events; cross-session
state lives in a tracking issue.

Status: design only. Not yet wired up.

## Goal

For each target OSS repo:

1. Run `truecourse analyze`.
2. Triage violations into TPs / FPs.
3. For each rule that has FPs, in priority order:
   a. Paraphrase one FP-triggering snippet into the `sample-js-project-negative`
      (or `…-python-…`) fixture, annotated to assert **no violation**.
   b. Add a paired snippet to the corresponding `…-positive` fixture so the
      rule still catches the genuine bug pattern.
   c. Fix the visitor / rule so both tests pass.
   d. Commit, push to a feature branch, open a PR. End the session.
4. When the PR merges, a fresh session picks the next rule.
5. Once no FPs remain, re-run `truecourse analyze`. If TP rate ≥ 90 %, mark the
   repo done and move on to the next.

### Terminology clarification

The repo's fixture convention is the inverse of how the request was phrased:

| Repo term  | Meaning                                  | FP workflow role |
|------------|------------------------------------------|------------------|
| `positive` | code that **should** trigger a violation | regression case  |
| `negative` | code that should **not** trigger         | the FP case      |

So fixing an FP means: add a paraphrased FP case to the **negative** fixture
(currently fails because the rule wrongly fires) and a paraphrased true-bug
case to the **positive** fixture (must still pass after the fix).

## Architecture

```
┌──────────────────────┐         ┌────────────────────────┐
│ Tracking issue       │◄────────│ GitHub Action          │
│ (state, checklists)  │         │ on PR merged           │
└─────────┬────────────┘         └───────────┬────────────┘
          │ read state                       │ kicks off
          ▼                                  ▼
┌──────────────────────────────────────────────────────────┐
│ Claude Code session (fresh container, one rule)          │
│                                                          │
│ 1. Read tracking issue → next pending rule, target repo  │
│ 2. Clone target repo to /tmp, run `truecourse analyze`   │
│ 3. Confirm FP for that rule (re-validate, in case fixed) │
│ 4. Edit fixtures + visitor in this repo                  │
│ 5. Run `pnpm test --filter analyzer`, ensure green       │
│ 6. Commit to feature branch, push, open PR               │
│ 7. Update tracking issue (mark rule "in review")         │
│ 8. End session                                           │
└──────────────────────────────────────────────────────────┘
```

No subscriptions, no idle waits — each merge re-kicks a new session via the
GitHub Action.

## State: tracking issue

One pinned issue per target OSS repo, owned by the
`truecourse-ai/truecourse` repo. Body is a machine-readable YAML block in a
fenced code block, followed by a human-readable checklist.

```yaml
target_repo: vercel/next.js
target_ref: main@abc1234              # commit pinned for reproducibility
campaign_started: 2026-05-16
baseline:
  total_violations: 412
  tp: 280
  fp: 132
  tp_rate: 0.68
status: in_progress                   # in_progress | done | blocked
current:
  rule_key: bugs/missing-await
  pr: 123                             # null when no PR is open
queue:                                # ordered, highest-FP-count first
  - rule_key: bugs/missing-await
    fp_count: 41
    status: in_review                 # pending | in_review | merged | skipped
    pr: 123
  - rule_key: code-quality/dead-code
    fp_count: 28
    status: pending
done: []
next_repo: facebook/react             # picked once tp_rate ≥ 0.9
```

The Claude session is the only writer. Concurrency is bounded because the
Action only fires one session per merge and the previous session ends before
opening its PR.

## Trigger: GitHub Action

`.github/workflows/fp-automation.yml` (sketch — not added yet):

```yaml
on:
  pull_request:
    types: [closed]
    branches: [main]
  workflow_dispatch:
    inputs:
      tracking_issue: { required: true, type: number }

jobs:
  next-rule:
    if: github.event.pull_request.merged == true &&
        startsWith(github.event.pull_request.head.ref, 'fp-fix/')
    runs-on: ubuntu-latest
    steps:
      - name: Kick off Claude session
        uses: anthropics/claude-code-action@v1
        with:
          prompt-file: .github/prompts/fp-next-rule.md
          inputs: |
            tracking_issue=${{ vars.FP_TRACKING_ISSUE }}
            merged_pr=${{ github.event.pull_request.number }}
```

Branch prefix `fp-fix/<rule-key>` is what gates the workflow — unrelated PRs
don't trigger it.

Manual kickoff (`workflow_dispatch`) is provided for: starting the first
iteration on a new repo, restarting after a `blocked` status, or skipping a
stuck rule.

## Per-session prompt outline

Stored at `.github/prompts/fp-next-rule.md`. Key sections:

1. **Identity**: "You are working on a single rule from the FP-fix tracking
   issue. Do not start a second rule in this session."
2. **Inputs**: tracking issue number, optional merged PR number.
3. **Steps**:
   - Read tracking issue, pick first `pending` rule (or `current.rule_key` if
     re-entry).
   - Clone target repo at `target_ref` to `/tmp/target`.
   - `pnpm build && pnpm exec truecourse analyze /tmp/target`.
   - Filter violations to the chosen rule; sample up to 10 instances and
     classify TP/FP. If FP rate < 10 % for this rule, mark it `skipped` and
     end.
   - Pick the most representative FP. Paraphrase (rename identifiers, change
     trivial structure) into `tests/fixtures/sample-js-project-negative/`
     (language depends on the offending file).
   - Add the matching true-positive case to `…-positive/` with a
     `// VIOLATION: <rule-key>` comment.
   - Run `pnpm test --filter @truecourse/analyzer 2>&1 | tee /tmp/test.log`.
     Confirm the new negative test fails and the new positive test passes.
   - Edit the rule under `packages/analyzer/src/rules/<domain>/…` until both
     tests pass. No other changes.
   - Update tracking issue: move the rule to `in_review`, fill `current.pr`.
   - Branch `fp-fix/<rule-key>`, commit, push, open PR linking the tracking
     issue.
4. **Stop conditions**: PR opened, OR rule skipped, OR queue empty. In the
   last case, re-run `truecourse analyze` against the target repo, recompute
   TP rate, and:
   - if ≥ 90 %: set `status: done`, open a new tracking issue for
     `next_repo`, end.
   - if < 90 %: append newly-discovered FP rules to the queue, end.

## Acceptance criteria

A PR is mergeable when:

- New negative test cases for the FP exist and pass.
- New positive test cases for the true-bug pattern exist and pass.
- Full `pnpm test` is green (no regressions in other rules).
- PR description quotes the original OSS snippet (link, not paste — to avoid
  license issues) and the paraphrased fixture.
- Tracking issue is updated in the same PR? **No** — the issue is updated by
  the session before opening the PR, so the PR diff stays focused on
  fixture + visitor.

A repo is "done" when the queue is empty and `tp_rate ≥ 0.9` on a fresh
analyze.

## Open questions / risks

1. **Paraphrasing licence**: paraphrased snippets in fixtures should be far
   enough from the original to be uncontroversial. PR description links the
   source rather than embedding it. Worth a quick legal sanity-check before
   running across many GPL/AGPL repos.
2. **FP triage is judgement-heavy**: the session needs a clear rubric for
   "is this an FP?" — propose adding a one-page rubric per rule domain, or
   letting Claude classify and surfacing borderline cases to the tracking
   issue for human review.
3. **Stuck rules**: if a rule's visitor can't be fixed without a refactor
   (e.g. needs type info we don't have), the session should mark it
   `blocked` with a comment and skip, not loop forever.
4. **Cost control**: each session re-runs `truecourse analyze` on a large
   OSS repo. Caching the analyze output keyed on `(repo, ref)` in the
   tracking issue (or as an artifact) would cut this.
5. **Branch hygiene**: stale `fp-fix/*` branches accumulate. A cleanup step
   on PR merge (delete head branch) is standard but worth confirming.
6. **First target**: which OSS repo do we start with? Suggest something
   small/medium in TS (e.g. a popular Express app or a Next.js example) for
   the first run, then graduate to larger codebases.

## What's next

If green-lit:

1. Add `.github/workflows/fp-automation.yml` + `.github/prompts/fp-next-rule.md`.
2. Open the first tracking issue (target repo TBD) with a baseline analyze.
3. Manual-dispatch the workflow to kick off rule 1.
4. Iterate.
