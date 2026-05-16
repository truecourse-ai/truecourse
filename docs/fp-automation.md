# FP Detection Automation — Design

A loop that runs Truecourse against open-source repos, identifies false
positives (FPs), and converts each one into a fixture + visitor fix, one PR at
a time. Sessions are short-lived and triggered by GitHub events; cross-session
state lives in two places: a committed campaigns file
(`docs/fp-campaigns.yaml` — which repos in what order, plus baseline / final
analyze results) and GitHub issues (one per rule with FPs).

Status: design only. Not yet wired up.

## Goal

Targets and order are defined in `docs/fp-campaigns.yaml`. Sessions pick the
first campaign with `status: pending` (or `discovering` / `in_progress`).
When a campaign finishes, sessions update that file in the same PR that
closes the campaign.

For each target OSS repo:

1. Run `truecourse analyze --no-llm` (deterministic rules only — keeps cost
   bounded; LLM-rule FPs are a separate phase).
2. Triage violations into TPs / FPs.
3. For every rule with at least one FP, file one GitHub issue labelled
   `fp-fix` describing the rule, the target repo, links to OSS snippets, and
   the FP count.
4. The Action consumes the open `fp-fix` issues one at a time:
   a. Paraphrase one FP-triggering snippet from the issue into the
      `sample-js-project-positive` (or `…-python-positive`) fixture — the
      positive project asserts **zero violations**, so adding FP code there
      makes the test fail until the visitor is fixed.
   b. Add a paraphrased true-bug counterpart to the `…-negative` fixture with
      a `// VIOLATION: <rule-key>` comment, so we don't over-correct and
      break genuine detection.
   c. Fix the visitor / rule until both tests pass and full `pnpm test` is
      green.
   d. Commit, push to `fp-fix/<rule-key>`, open a PR that closes the issue.
5. When the PR merges (closing the issue), the next `fp-fix`-labelled issue
   is picked up automatically.
6. When no `fp-fix` issues remain open for the current target, re-run
   `truecourse analyze --no-llm`. Update the campaign's `final.*` block in
   `docs/fp-campaigns.yaml`. If TP rate ≥ 90 %, mark `status: done` and pick
   the next `pending` campaign — re-run discovery, file fresh `fp-fix` issues,
   loop continues.

### Borderline FPs

Classification is not always clean. If a session is uncertain whether a
violation is a TP or FP, it does **not** auto-fix. Instead it posts a
comment on the relevant `fp-fix` issue (or on the campaign tracking comment
if no rule-specific issue exists yet) tagged `borderline:`, with the OSS
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

| Fixture                  | Test asserts                                     | FP workflow role     |
|--------------------------|--------------------------------------------------|----------------------|
| `…-positive` project     | **Zero** violations across the whole project     | host for FP cases    |
| `…-negative` project     | Violations match `// VIOLATION: rule-key` comments | host for regression / true-bug cases |

`tests/analyzer/js-positive.test.ts`:
> Runs the full analyzer against `sample-js-project-positive` and asserts
> **ZERO code violations. Any violation found is a false positive.**

So an FP fix means:
- drop the paraphrased FP into `tests/fixtures/sample-{js,python}-project-positive/` (no annotation needed — its presence asserts "should not fire");
- drop the paraphrased true-bug into `…-project-negative/` with `// VIOLATION: <rule-key>`;
- before the visitor fix, the positive test fails;
- after the fix, both tests pass.

## Architecture

```
┌──────────────────────────┐        ┌─────────────────────────┐
│ docs/fp-campaigns.yaml   │───────▶│ Discovery workflow      │
│ ordered repo list +      │ next   │ (analyze --no-llm,      │
│ baseline / final results │        │  writes baseline back,  │
└──────────────────────────┘        │  files fp-fix issues)   │
                                    └────────────┬────────────┘
┌─────────────────────────┐                      │
│ N × GitHub issues       │◄─────────────────────┘
│ label: fp-fix           │
│ one per rule with FPs   │
└──────────┬──────────────┘
           │ oldest open issue
           ▼
┌──────────────────────────────────────────────────────────┐
│ Claude Code session (fresh container, one issue)         │
│                                                          │
│ 1. Read oldest open fp-fix issue → rule, repo, snippets  │
│ 2. Clone target repo, re-confirm FP still reproduces     │
│ 3. Paraphrase into …-positive fixture (no annotation)    │
│ 4. Paraphrase true-bug into …-negative fixture (+ marker)│
│ 5. Run tests, fix visitor until green                    │
│ 6. Commit, push fp-fix/<rule-key>, open PR (closes #N)   │
│ 7. End session                                           │
└──────────────────────────────────────────────────────────┘
           ▲                                  │
           │ on PR merge                      │
┌──────────┴──────────────────────────────────▼────────────┐
│ Trigger workflow (PR closed+merged, label fp-fix)        │
│  → picks next open fp-fix issue and starts a session     │
│  → if no open fp-fix issues: re-analyze target,          │
│     compute TP rate, advance to next repo (re-discover)  │
└──────────────────────────────────────────────────────────┘
```

No subscriptions, no idle waits — each merge re-kicks a new session via the
GitHub Action.

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
- `fp-fix` — gates the trigger workflow.
- `fp-target:<owner-repo>` — groups issues by campaign; used to detect
  "campaign done" (no open issues with this label and `fp-fix`).
- `fp-skipped` / `fp-blocked` — set by the session when bailing out.

The Claude session is the only writer. Ordering is "oldest open issue first"
unless overridden by an explicit `priority` label.

## Triggers: two workflows

### 1. `fp-discover.yml` — populate issues

Runs on `workflow_dispatch` (with `target_repo` + optional `target_ref` input)
or on a schedule. Spawns a Claude session that:

1. Clones the target repo at the requested ref.
2. Runs `truecourse analyze`.
3. Triages violations per rule, classifies TP/FP.
4. For each rule with ≥ 1 FP: files an `fp-fix` + `fp-target:<owner-repo>`
   issue using the YAML schema above.
5. Records the baseline (TP/FP counts) in a campaign-summary comment on a
   single "campaign" issue with label `fp-campaign:<owner-repo>` (lightweight
   audit trail; not consumed by the fix loop).

### 2. `fp-automation.yml` — consume issues on merge

```yaml
on:
  pull_request:
    types: [closed]
  workflow_dispatch:                  # manual kickoff for the first iteration
    inputs:
      target_label: { required: true, type: string }   # e.g. "fp-target:vercel-next.js"

jobs:
  next-issue:
    # Only fire on merged FP-fix PRs — no other PR can trigger us.
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event.pull_request.merged == true &&
       contains(github.event.pull_request.labels.*.name, 'fp-fix') &&
       startsWith(github.event.pull_request.head.ref, 'fp-fix/'))
    runs-on: ubuntu-latest
    steps:
      - name: Kick off Claude session
        uses: anthropics/claude-code-action@v1
        with:
          prompt-file: .github/prompts/fp-next-issue.md
          inputs: |
            merged_pr=${{ github.event.pull_request.number || '' }}
            target_label=${{ github.event.inputs.target_label || '' }}
```

Trigger scoping uses **two** signals so unrelated PRs can't kick the loop:
1. PR head branch must start with `fp-fix/`.
2. PR must carry the `fp-fix` label (set automatically when the session
   opens the PR).

## Per-session prompt outline

Stored at `.github/prompts/fp-next-issue.md`. Key sections:

1. **Identity**: "You are working on a single FP issue. Do not start a second
   issue in this session."
2. **Inputs**: merged PR number (for context) and/or target label.
3. **Steps**:
   - Use the GitHub MCP server to list open issues with label `fp-fix`
     (optionally filtered by `target_label`). Pick the oldest.
   - Parse the YAML block from the issue body → rule key, target repo, ref,
     sample URLs.
   - Clone target repo at `target_ref` to `/tmp/target`.
   - `pnpm build && pnpm exec truecourse analyze /tmp/target --no-llm`.
   - Re-confirm the FP still reproduces for this rule. If not (someone else
     fixed it, or upstream code changed), close the issue with comment
     "no longer reproduces" and end.
   - Pick the most representative FP sample. Paraphrase (rename identifiers,
     change trivial structure, drop unrelated context) into
     `tests/fixtures/sample-{js,python}-project-positive/`. **No** `// VIOLATION`
     comment — the positive project asserts zero violations.
   - Paraphrase a true-bug variant into `…-project-negative/` with a
     `// VIOLATION: <rule-key>` comment.
   - Run `pnpm test 2>&1 | tee /tmp/test.log`. Confirm the new positive case
     fails and the negative case passes.
   - Edit the rule under `packages/analyzer/src/rules/<domain>/…` until both
     tests pass and full `pnpm test` is green. No unrelated changes.
   - Branch `fp-fix/<rule-key>`, commit, push. Open a PR with:
     - Label `fp-fix` (required for the next trigger to fire).
     - Body that includes `Closes #<issue>` and links the OSS sample URLs.
   - Comment on the issue with the PR link; leave the issue open (it will be
     auto-closed when the PR merges).
4. **Stop conditions**:
   - PR opened → end.
   - FP no longer reproduces → close issue, end.
   - No open `fp-fix` issues for the target → run
     `truecourse analyze --no-llm`, compute TP rate, update
     `docs/fp-campaigns.yaml` `final.*` block:
     - ≥ 90 %: set `status: done` in the campaigns file, find the next
       `pending` campaign, dispatch `fp-discover.yml` for it via the GitHub
       MCP tool, end.
     - < 90 %: re-discover FPs for the same repo, file new `fp-fix` issues,
       end.
   - Session can't fix the rule (needs unrelated refactor): comment, add
     `fp-blocked` label, end.

## Acceptance criteria

A PR is mergeable when:

- New positive-fixture case for the FP exists and the test passes (no
  violation fires).
- New negative-fixture case for the true-bug pattern exists with `// VIOLATION:`
  comment and the test passes.
- Full `pnpm test` is green (no regressions).
- PR body links the original OSS snippet (URL only — no paste, to keep clear
  of upstream licences) and shows the paraphrased fixture diff inline.
- PR closes its parent issue.

A repo is "done" when no `fp-fix` + `fp-target:<owner-repo>` issues are open
and a fresh `truecourse analyze` shows `tp_rate ≥ 0.9`.

## Resolved decisions

1. **Paraphrasing licence**: paraphrased snippets must be far enough from the
   original to stand alone. PR description links the source rather than
   embedding it. Open question — still worth a legal sanity-check before
   running across GPL/AGPL repos.
2. **Borderline FPs**: not auto-fixed. Session posts a `borderline:` comment
   on the issue with both interpretations; user adds `fp-confirmed` /
   `tp-confirmed` to decide. See "Borderline FPs" above.
3. **Visitor refactors**: not auto-attempted. Session opens the PR with the
   fixtures and a `## Refactor needed` note, labels it `needs-design`, ends.
   See "Visitor refactors" above.
4. **Cost control**: analyze runs `--no-llm` (deterministic rules only).
   Cache the analyze output as a workflow artifact keyed on `(repo, ref)`
   for reuse across sessions in the same campaign.
5. **Branch hygiene**: auto-delete `fp-fix/*` head branches on merge
   (repo setting).
6. **Concurrency**: session adds `fp-in-progress` to the picked issue
   before doing anything else; competing sessions skip labelled issues.
7. **Target order**: `docs/fp-campaigns.yaml` is the source of truth.
   Sessions pick the first non-`done`, non-`skipped` campaign.

## What's next

If green-lit:

1. Add `.github/workflows/fp-discover.yml` + `.github/workflows/fp-automation.yml`.
2. Add `.github/prompts/fp-discover.md` + `.github/prompts/fp-next-issue.md`.
3. Enable "Automatically delete head branches" in repo settings.
4. Manual-dispatch `fp-discover` — it reads the first `pending` campaign
   from `docs/fp-campaigns.yaml` (today: `documenso/documenso`), runs
   `truecourse analyze --no-llm`, writes the `baseline.*` block back, and
   files one `fp-fix` issue per rule with FPs.
5. Manual-dispatch `fp-automation` once → it picks the first issue and
   opens PR 1. From there, PR merges drive the loop.
