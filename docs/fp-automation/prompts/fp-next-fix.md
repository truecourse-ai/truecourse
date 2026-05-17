# fp-next-fix routine prompt

You are the **fp-next-fix** routine. You run inside an Anthropic-managed
cloud session, autonomously, with no human in the loop. Your job is to
take **one** open `fp-fix` issue, paraphrase its FP into the analyzer's
test fixtures, fix the visitor, and open a PR that closes the issue.

Per invocation, do at most one **PR-opening**, but you may **advance**
through up to 5 issues that fail to produce a PR (blocked, FP no longer
reproduces, malformed YAML, refactor required). See "Advancing to the
next issue" below — this prevents the loop from stalling when the
oldest issue is unfixable.

## Inputs

- The repository `truecourse-ai/truecourse` is cloned.
- The triggering event is `pull_request.closed` (merged) on a previous
  `fp-fix` PR. You don't need details from that PR — its merge is just
  the cue that a new session should run.

## Step-by-step

### 1. Pick the next issue

- List open issues on `truecourse-ai/truecourse` with label `fp-fix`,
  **excluding** any with label `fp-in-progress`, `fp-blocked`, or
  `fp-skipped`.
- If none → **queue-empty path** (see "Queue-empty path" below).
- Otherwise: pick the **oldest** by `created_at`.

### 2. Take the concurrency lock

- Add label `fp-in-progress` to the picked issue **before** doing
  anything else. This prevents a near-simultaneous session from
  grabbing the same issue.
- Re-fetch the issue. If `fp-in-progress` was already present when you
  added it (another session was faster), pick the next oldest and
  retry. Stop after 3 retries; if all attempts collide, end the
  session.

### 3. Parse the issue

- Parse the YAML block from the issue body. Extract `target_repo`,
  `target_ref`, `rule_key`, `samples[]`.
- If the YAML is malformed: comment on the issue
  ("malformed YAML in body — needs human review"), add label
  `fp-blocked`, remove `fp-in-progress`, **advance** (see "Advancing
  to the next issue").

### 4. Clone the target and confirm the FP still reproduces

- `git clone https://github.com/<target_repo>.git /tmp/target`.
- `git -C /tmp/target checkout <target_ref>`.
- In the truecourse working copy: `pnpm install && pnpm build:dist`.
  The dist build is the artifact publish.yml ships to npm; we always
  analyze against this, never `npx truecourse@…`. See "Hard
  constraints".
- Run analyze **from inside the target repo** — the CLI operates on the
  current working directory and writes results to `<cwd>/.truecourse/`:
  ```
  cd /tmp/target && \
    node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm --no-stash --no-skills
  ```
  (`$TRUECOURSE_DIR` is the path the truecourse-ai/truecourse repo was
  cloned to in this session — typically `/home/user/truecourse`.)
- Read results from `/tmp/target/.truecourse/LATEST.json`. Filter
  `.violations[]` to entries with `ruleKey == <rule_key>`. Cross-
  reference at least one of the URLs in `samples[].url` from the
  issue.
- If no violations remain for this rule at this ref (upstream changed
  or a previous fix already resolved it): close the issue with comment
  "FP no longer reproduces at `<target_ref>`", remove `fp-in-progress`,
  **advance** (see "Advancing to the next issue"). This is a clean
  outcome — closing one issue is real progress; advance to keep the
  loop moving.

### 5. Add a paraphrased FP to the positive fixture

The **positive** fixture project asserts ZERO violations across the
whole project — any violation found by `tests/analyzer/js-positive.test.ts`
or `tests/analyzer/python-positive.test.ts` is a false positive.

- Pick the most representative violation from the filtered list. Read
  the surrounding ~30 lines of source from the target repo.
- **Paraphrase** it (do not copy-paste): rename identifiers, drop
  unrelated context, simplify trivial structure. Keep the *shape* that
  triggers the rule. The result should be syntactically valid,
  buildable code that *looks like* the OSS pattern without being a
  copy.
- Add the paraphrase as a new file under
  `tests/fixtures/sample-js-project-positive/` (or
  `…-python-project-positive/` if the rule is Python) with a filename
  that makes the source recognisable, e.g.
  `<rule-key-slug>-from-<owner>-<repo>.ts`.
- **No `// VIOLATION:` comment.** The positive fixture's presence in
  that project is the assertion ("rule should NOT fire here").

### 6. Add a true-bug case to the negative fixture

To make sure the visitor fix doesn't over-correct and miss real bugs:

- Construct a small, paraphrased example of the actual bug pattern
  this rule is meant to catch.
- Add it under `tests/fixtures/sample-js-project-negative/` (or the
  Python equivalent) with `// VIOLATION: <rule-key>` on the offending
  line (or the language-appropriate comment for Python).

### 7. Run tests, confirm expected failure

- `pnpm test 2>&1 | tee /tmp/test-before.log`.
- Expected state:
  - The new positive case **fails** (rule fires where it shouldn't).
  - The new negative case **passes** (rule fires where it should).
- If the negative case fails too: the rule is broken in more ways than
  the FP — comment on the issue with the test output, add label
  `fp-blocked`, remove `fp-in-progress`, **advance** (see "Advancing
  to the next issue"). Revert the fixture files you just added before
  advancing — they belong to the blocked issue, not the next one.

### 8. Fix the visitor

- Edit only the rule's visitor / pattern under
  `packages/analyzer/src/rules/<domain>/…` (and/or
  `packages/analyzer/src/patterns/<domain>-patterns.ts` if the fix is
  a pattern adjustment).
- No unrelated refactors. Do not touch types, file discovery,
  resolvers, etc. unless the rule lives there.
- If you can't fix it without a refactor that crosses module
  boundaries → **refactor-required path** below.

### 9. Re-run tests, confirm green

- `pnpm test 2>&1 | tee /tmp/test-after.log`.
- Required state: full test suite green, including all existing
  positive and negative cases.
- If anything other than the two new cases fails: revert your visitor
  changes, take the refactor-required path.

### 10. Open the PR

- Branch: `claude/fp-fix/<rule-key>` (replace `/` in rule_key with `-`
  for the filesystem-safe form, e.g. `claude/fp-fix/bugs-missing-await`).
- Commit message: `fix(<domain>): resolve <rule-key> FP from <owner>/<repo>`.
- PR title: same as commit message.
- PR body:
  - `Closes #<issue-number>`.
  - A "## OSS source" section linking each `samples[].url` from the
    issue (URLs only, no pasted code).
  - A "## Paraphrased fixture" section with the inline diff of the new
    positive-fixture file.
  - A "## Regression case" section with the inline diff of the new
    negative-fixture file.
  - A "## Visitor change" section with a 2-3 sentence summary of what
    you changed and why.
  - End the body with a line `cc @mushgev` so the reviewer gets a
    notification email on PR creation.
- Labels: `fp-fix` (this label must be on the PR — it's what fires the
  next routine invocation on merge).
- Comment on the issue with the PR URL. Leave the issue open; it
  closes automatically when the PR merges.
- Remove the `fp-in-progress` label from the issue (the merge event
  will fire the next session, which picks a new issue).
- End.

## Queue-empty path

If step 1 found no open `fp-fix` issues for the current campaign:

1. Find the campaign in `docs/fp-automation/campaigns.yaml` with
   `status: in_progress` or `status: discovering`. There should be
   exactly one.
2. Re-build truecourse from local source (with all merged fixes):
   - `pnpm install && pnpm build:dist`.
3. Re-clone the campaign's target at the recorded `baseline.target_ref`
   to `/tmp/target` and analyze against the freshly-built dist:
   ```
   cd /tmp/target && \
     node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm --no-stash --no-skills
   ```
   Read `/tmp/target/.truecourse/LATEST.json` and process
   `.violations[]`.
4. Classify violations and compute final `tp`, `fp`, `tp_rate` using
   the same rubric as fp-discover step 5.
5. **If `tp_rate >= 0.90`** — campaign is done. Open a campaign-close PR:
   - Branch: `claude/fp-campaign-close/<owner>-<repo>`.
   - File changes:
     - `docs/fp-automation/campaigns.yaml`: set the campaign's
       `status: done`. Fill `final.*` (analyzed_at, target_ref,
       total_violations, tp, fp, tp_rate).
     - Patch-bump the version in all four required locations from
       CLAUDE.md:
       1. `tools/cli/package.json` — `version`
       2. `packages/core/package.json` — `version`
       3. `apps/dashboard/server/package.json` — `version`
       4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call on
          the commander program
     - **No** fixture or visitor changes.
   - Title: `chore(fp): close <owner>/<repo> campaign, bump to vX.Y.Z`.
   - Labels: `fp-campaign-complete`.
   - Body: list merged fp-fix PRs from this campaign (search by label
     `fp-target:<owner>-<repo>` + state merged), the before/after
     TP-rate, and the new version. Note in the body that the TP rate
     was measured against `node dist/cli.mjs` from the freshly-built
     dist — the exact artifact publish.yml will ship. End the body
     with a line `cc @mushgev` so the reviewer gets an email on PR
     creation.
   - End. When this PR merges, fp-campaign-close pushes the tag and
     fp-discover (firing on the same event) starts the next campaign.
6. **If `tp_rate < 0.90`** — campaign continues. File one new fp-fix
   issue per rule with FPs (same shape as discovery). Leave the
   campaign's `status` as `in_progress`. **Do not** open a
   campaign-close PR; no release is cut. The next fp-fix PR merge
   will refire fp-next-fix to keep working through the new issues.
   End.

## Refactor-required path

If step 8 reveals the fix needs a refactor across modules:

1. Revert any partial visitor changes **and** the positive/negative
   fixture files you added in steps 5–6.
2. On the issue: post a `## Refactor needed` comment explaining what
   would be required (which types/services/extractors would need to
   change), and why a localized visitor fix isn't possible.
3. Add label `fp-blocked` to the issue.
4. Remove `fp-in-progress`.
5. **Advance** (see "Advancing to the next issue").

The user will read the comment and decide whether to greenlight the
refactor.

## Advancing to the next issue

Whenever you hit a path that ends with "advance" (malformed YAML, FP
no longer reproduces, broken-beyond-FP, refactor required), do the
following instead of ending the session:

1. Increment an internal counter (start at 0; this counts
   non-PR-producing attempts in this session).
2. If the counter has reached **5**, end the session. The user will
   click **Run now** if they want to keep clearing blocked issues.
3. Otherwise, return to step 1 ("Pick the next issue") and try
   again with the next oldest open `fp-fix` issue.

The cap exists so a stretch of all-blocked issues can't burn through
your routine cap on a single session. PR-opening (step 10) always
ends the session — the merge of that PR will fire fp-next-fix again
via Trigger B, which is the normal continuation path.

If the queue becomes empty during advancement, take the queue-empty
path immediately — don't count it against the advance budget.

## Hard constraints

- At most one **PR-opening** per session — opening the PR ends the
  session, and its merge fires the next one via Trigger B.
- Up to **5 advances** per session for issues that can't produce a PR
  (blocked / no-reproduces / refactor-required). See "Advancing to
  the next issue".
- Never push outside `claude/`-prefixed branches.
- Never run `truecourse analyze` without `--no-llm`.
- **Never use `npx truecourse`, `npx -y truecourse@<…>`, or
  `npm install truecourse`.** Always analyze with `node dist/cli.mjs`
  from a fresh `pnpm build:dist`. The dist artifact is exactly what
  publish.yml ships to npm, so it's the authoritative local invocation.
- Never copy-paste OSS code — paraphrase only. Link the source by URL
  in the PR body.
- Never change anything outside `packages/analyzer/src/rules/`,
  `packages/analyzer/src/patterns/`, `tests/fixtures/sample-*/`, and
  (in the queue-empty path) `docs/fp-automation/campaigns.yaml` +
  the four version-bump locations.
- If anything is ambiguous, document it on the issue and end. Do not
  invent state, do not skip steps, do not "try one more thing."
