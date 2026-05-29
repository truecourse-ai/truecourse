# fp-next-fix routine prompt

You are the **fp-next-fix** routine. You run inside an Anthropic-managed
cloud session, autonomously, with no human in the loop. Your job is to
take a **batch of up to 5 open `fp-fix` issues**, paraphrase each FP
into the analyzer's test fixtures, fix each visitor, and open a single
PR containing all the fixes.

The 15-sessions-per-day routine cap is the binding constraint, so each
session does meaningful batch work instead of one fix at a time. With
N = 5, 15 sessions/day = ~75 fixes/day instead of 15.

Per invocation:
- Process issues until you've accumulated **5 successful fixes**, OR
  you've attempted **10 issues**, OR the queue is empty.
- Issues that can't produce a fix (malformed YAML / FP no longer
  reproduces / broken-beyond-FP / refactor required) are skipped per
  their respective paths; they count toward the 10-attempt cap but
  not the 5-success cap.
- Open ONE PR at the end with all successful fixes (or end with no PR
  if zero successes).

## Inputs

- The repository `truecourse-ai/truecourse` is cloned.
- The triggering event is `pull_request.closed` (merged) on either a
  previous fp-fix PR (Trigger B) or the campaign's discovery PR
  (Trigger A, fp-next-fix-bootstrap). Either way, the merge is just
  the cue that a new session should run.

## Session setup (once)

Before the per-issue loop:

- **Create the batch branch FIRST**, before any other work in the
  truecourse repo. The routine starts the session on a default
  randomly-named branch (e.g. `claude/<adjective-noun-XXXX>`); pushing
  from that branch will **not** fire Trigger B because its filter is
  `Head Branch starts-with claude/fp-fix/`. Run:
  ```
  git fetch origin main && \
    git checkout -b claude/fp-fix/batch-$(date -u +%Y%m%d%H%M) origin/main
  ```
  Remember the exact branch name; you'll push to it in the final
  step. **All commits this session go on this branch.** If you find
  yourself on any other branch when about to commit, stop and switch.
- Track three counters in your head: `successes = 0`, `attempts = 0`,
  and a list `fixed_issues = []` of `(issue_number, rule_key,
  positive_fixture_path, negative_fixture_path, visitor_summary)`.
  Also keep `before_counts` (a map `ruleKey → count`) and
  `before_total` (sum across all rules) — both populated after the
  initial analyze below.
- Build truecourse once: `pnpm install && pnpm build:dist`. The dist
  artifact is what publish.yml ships to npm; always analyze against
  this, never `npx truecourse@…`. See "Hard constraints".
- Lazily clone the target repo: when the first issue needs it, clone
  to `/tmp/target` and `git -C /tmp/target checkout <target_ref>`.
  All `fp-fix` issues in a single campaign share `target_repo` +
  `target_ref`, so you only clone once per session.
- Lazily analyze: run `cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs
  analyze --no-llm --no-stash --no-skills` once after the clone.
  Re-read `/tmp/target/.truecourse/LATEST.json` per issue to filter
  to that rule.
- **Snapshot the before-state** immediately after that first analyze:
  copy `/tmp/target/.truecourse/LATEST.json` to
  `/tmp/target-before.json` so the file survives the re-analyze in
  the after-loop step. Populate `before_counts` by grouping
  `.violations[]` by `ruleKey` and counting; populate `before_total`
  as the total length of `.violations[]`.

## Per-issue loop

Repeat the steps below while `successes < 5 AND attempts < 10`. Each
iteration is one "attempt" (success or skip).

### 1. Pick the next issue

- List open issues on `truecourse-ai/truecourse` with label `fp-fix`,
  **excluding** any with label `fp-in-progress`, `fp-blocked`, or
  `fp-skipped`.
- Also exclude any issue already in `fixed_issues` for this session.
- If none (the **pickable** queue is empty — note this is also true
  when open issues remain but every one is `fp-blocked`/`fp-skipped`):
  - If `successes >= 1` → break out of the loop and go to "Open the
    batched PR" (ship the batch you've built).
  - If `successes == 0` → go to the **Queue-empty path**. Do **not**
    just end the session — an empty pickable queue is the cue to
    re-measure the campaign (re-analyze, recompute TP, then close /
    re-discover / flag-stuck). This holds even when the only remaining
    issues are blocked.
- Otherwise: pick the **oldest** by `created_at`.

### 2. Take the concurrency lock

- Add label `fp-in-progress` to the picked issue **before** doing
  anything else.
- Re-fetch the issue. If `fp-in-progress` was already present when you
  added it (another session was faster), skip this issue and pick the
  next oldest. Stop after 3 collision retries within one iteration; if
  all attempts collide, break out of the loop.

### 3. Parse the issue

- Parse the YAML block from the issue body. Extract `target_repo`,
  `target_ref`, `rule_key`, `samples[]`.
- If the YAML is malformed: comment on the issue ("malformed YAML in
  body — needs human review"), add label `fp-blocked`, remove
  `fp-in-progress`, increment `attempts`, **continue to next iteration**.

### 4. Confirm the FP still reproduces

- If `target_repo`/`target_ref` differs from any earlier issue in this
  session, that's surprising — all fp-fix issues in a campaign should
  share the same target. Comment on the issue noting the mismatch,
  add `fp-blocked`, remove `fp-in-progress`, increment `attempts`,
  continue.
- Filter `/tmp/target/.truecourse/LATEST.json` `.violations[]` to
  entries with `ruleKey == <rule_key>`. Cross-reference at least one
  of the URLs in `samples[].url`.
- If no violations remain for this rule at this ref (upstream changed
  or an earlier fix in this batch already resolved it): close the
  issue with comment "FP no longer reproduces at `<target_ref>`",
  remove `fp-in-progress`, increment `attempts`, continue.

### 5. Add a paraphrased FP to the positive fixture

The **positive** fixture project asserts ZERO violations across the
whole project — any violation found by `tests/analyzer/js-positive.test.ts`
or `tests/analyzer/python-positive.test.ts` is a false positive.

- Pick the most representative violation from the filtered list. Read
  the surrounding ~30 lines of source from the target repo.
- **Paraphrase** it (do not copy-paste): rename identifiers, drop
  unrelated context, simplify trivial structure. Keep the *shape* that
  triggers the rule.
- Add the paraphrase as a new file under
  `tests/fixtures/sample-js-project-positive/` (or
  `…-python-project-positive/` if the rule is Python).
- **Filename and content must not identify the upstream OSS project.**
  The fixtures are committed to a public repo — don't expose which
  projects we use as our FP corpus.
  - Filename: `<rule-key-slug>.ts` (or `.tsx`/`.py` as appropriate).
    If a fixture for that rule already exists, append a short
    descriptive suffix that describes the *pattern shape*, not the
    source — e.g. `<rule-key-slug>-typeof.ts`,
    `<rule-key-slug>-shadowed-bindings.tsx`. Never use `-from-<owner>-<repo>`,
    upstream filenames (`template-type`, `pdf-viewer`), or
    upstream-specific identifiers.
  - Content: rename all OSS-project-themed identifiers to neutral
    domain-agnostic names. Comments must not name the upstream project
    or its files. (Linking the OSS source URL in the **PR body** is
    fine — that's a hyperlink, not a committed artifact.)
- **No `// VIOLATION:` comment.** Remember the path as
  `positive_fixture_path` for the batch PR body.

### 6. Add a true-bug case to the negative fixture

- Construct a small, paraphrased example of the actual bug pattern
  this rule is meant to catch.
- Add it under `tests/fixtures/sample-js-project-negative/` (or the
  Python equivalent) with `// VIOLATION: <rule-key>` on the offending
  line (or the language-appropriate comment for Python).
- **Same anonymization rules as step 5**: filename based on rule key
  + optional pattern-shape suffix (never `-from-<owner>-<repo>`);
  content uses neutral identifiers and comments that don't name the
  upstream OSS project.
- Remember the path as `negative_fixture_path`.

### 7. Confirm expected pre-fix state

- `pnpm test 2>&1 | tee /tmp/test-rule-<rule-key>.log`.
- Expected state for this rule:
  - The new positive case **fails** (rule fires where it shouldn't).
  - The new negative case **passes** (rule fires where it should).
- All *previously-added* positive cases in this batch should still
  fire because their visitors haven't been fixed yet — that's fine,
  tolerated until step 9 below.
- If the new negative case fails: the rule is broken in more ways
  than the FP — comment on the issue with the test output, add
  `fp-blocked`, remove `fp-in-progress`, **revert** this issue's
  positive and negative fixture files (keep earlier-batch files
  intact), increment `attempts`, continue.

### 8. Fix the visitor

- Edit only the rule's visitor / pattern under
  `packages/analyzer/src/rules/<domain>/…` (and/or
  `packages/analyzer/src/patterns/<domain>-patterns.ts` if the fix
  is a pattern adjustment).
- No unrelated refactors. Do not touch types, file discovery,
  resolvers, etc. unless the rule lives there.
- If you can't fix it without a refactor that crosses module
  boundaries: revert this issue's fixture additions, post a
  `## Refactor needed` comment on the issue, add `fp-blocked` label,
  remove `fp-in-progress`, increment `attempts`, continue.

### 9. Re-run tests, confirm green

- `pnpm test 2>&1 | tee /tmp/test-after-<rule-key>.log`.
- Required state: full test suite green, including all earlier-batch
  fixes (their visitors are fixed too, so their positive cases now
  pass).
- If anything other than expected cases fails: revert this issue's
  visitor change AND fixture files, comment on the issue with the
  failure, add `fp-blocked`, remove `fp-in-progress`, increment
  `attempts`, continue.

### 10. Mark success

- Append `(issue_number, rule_key, positive_fixture_path,
  negative_fixture_path, visitor_summary)` to `fixed_issues`.
  `visitor_summary` is a 2–3 sentence summary of what you changed
  and why.
- Increment `successes` AND `attempts`.
- **Do not** remove `fp-in-progress` yet — the issue stays locked
  until the batch PR opens (in case the loop breaks early due to
  attempts cap or queue empty).
- If `successes == 5` or `attempts == 10`: break out of the loop.
- Otherwise: continue to next iteration.

## After the loop: measure the FP-count delta on the target (REQUIRED)

**This step is not optional.** Every batched PR's body MUST include
the `## FP-count delta` section — either as a populated table (the
happy path) or as `unavailable: <one-line reason>` if a sub-step
fails. A PR opened without that section is a routine bug; the
sanity check in "Open the batched PR" below will block it.

Skip this section entirely only if `successes == 0`. In every other
case, do the four steps below before touching the PR-opening section:

1. **Rebuild dist with the new visitor fixes.**
   ```
   cd $TRUECOURSE_DIR && pnpm build:dist
   ```
   The before-state was measured against the previous dist; the
   after-state must use a dist that includes this batch's edits.
2. **Re-analyze the same target ref.** The clone in `/tmp/target` is
   already at `target_ref` — just wipe `.truecourse` and re-run:
   ```
   cd /tmp/target && rm -rf .truecourse && \
     node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm --no-stash --no-skills
   ```
3. **Compute after-state counts.** From the new
   `/tmp/target/.truecourse/LATEST.json`, build `after_counts`
   (`ruleKey → count`) and `after_total` the same way as
   `before_counts` / `before_total`.
4. **Compute deltas** for each rule in `fixed_issues`:
   `delta = after_counts[rule_key] - before_counts[rule_key]`.
   Also compute the cross-rule subtotal (sum over fixed-issues rules)
   and the all-rules total (`after_total - before_total`).

Hold these numbers for the PR body — the "## FP-count delta"
section below is constructed from them.

**Failure modes — still write the section.** If step 1 or 2 throws,
the section still appears in the PR body, just with
`unavailable: <one-line reason>` (e.g. `unavailable: pnpm build:dist
exited 1 — TypeScript error in packages/analyzer/src/rules/...`)
instead of the table. The reviewer needs to know verification
didn't complete; silent omission is the worst outcome. Capture the
error output so the reason is concrete, not "unknown".

## Open the batched PR

After the loop:

- If `successes == 0`: do **not** end here. You only reach this section
  with zero successes if you attempted issues that all failed
  (blocked / no-reproduce / refactor) — the pickable queue ran out
  mid-session. Go to the **Queue-empty path** to re-measure the
  campaign. (Step 1 already routes a start-empty queue straight there;
  this catches the case where the queue drained during the loop.)
- If `successes >= 1`:
  - **Verify your branch.** Run `git rev-parse --abbrev-ref HEAD` and
    confirm it starts with `claude/fp-fix/batch-`. If it doesn't —
    e.g. you're still on the routine's default `claude/<random>`
    branch — STOP. Create the correct branch now
    (`git checkout -b claude/fp-fix/batch-$(date -u +%Y%m%d%H%M)`),
    cherry-pick or move your in-progress commits onto it, then
    delete the wrong branch locally. Pushing from the wrong branch
    will not fire Trigger B and the chain will stall.
  - **Verify the FP-count delta was measured.** If you don't have
    `after_counts` populated (i.e. you didn't run the "After the
    loop" section above), STOP and go run it now. The PR body MUST
    contain a `## FP-count delta` section — either with the table
    or with a concrete `unavailable: <reason>` line. Silent omission
    is a routine bug.
  - Branch: `claude/fp-fix/batch-<YYYYMMDDHHMM>` (use the session start
    time in UTC; this is the branch you created in session setup).
  - Commit message: `fix(fp): resolve <N> FPs from <owner>/<repo>`
    where N = `successes`.
  - PR title: same as commit message.
  - PR body:
    - One `Closes #<issue-number>` line per fixed issue (each on its
      own line so GitHub auto-closes all on merge).
    - A "## Fixes" overview table: `rule_key | issue | positive-fixture | negative-fixture`.
    - One "## <rule_key>" section per fixed issue, each containing:
      - OSS source URLs from the issue's `samples[].url`.
      - Inline diff of the positive-fixture file.
      - Inline diff of the negative-fixture file.
      - The `visitor_summary` for that issue.
    - A "## Skipped this batch" section (only if any `attempts >
      successes`): brief list of issues that were attempted but
      skipped, with reason (malformed YAML / no-reproduces /
      broken-beyond-FP / refactor-required). One line each, link
      to the issue.
    - A "## FP-count delta (vs `<target_ref>` on `<target_repo>`)"
      section with a markdown table built from the after-loop
      measurements:
      ```
      | Rule | Before | After | Delta |
      |---|---:|---:|---:|
      | <rule_key_1>                  | <b1> | <a1> | <d1> |
      | ...                           | ...  | ...  | ...  |
      | **Total (these N rules)**     | <Bn> | <An> | <Dn> |
      | **All-rules total on target** | <BT> | <AT> | <DT> |
      ```
      One row per rule in `fixed_issues` (so N rows for the batch),
      followed by the two totals. Use the raw integer counts; render
      the delta with a sign (`-5`, `0`, `+2`). A negative delta is
      progress.

      If the after-loop measurement failed, replace the table with
      a one-line note: `unavailable: <reason>`.
    - End the body with a line `cc @mushgev` so the reviewer gets a
      notification email on PR creation.
  - Labels: `fp-fix` (this label must be on the PR — it's what fires
    the next routine invocation on merge).
  - For each fixed issue: comment on the issue with the PR URL, then
    remove the `fp-in-progress` label (the merge will auto-close the
    issue via `Closes #N`).
- End the session.

## Queue-empty path

Enter this path when the **pickable** queue is empty AND
`successes == 0` this session. "Pickable empty" means step 1 found no
open `fp-fix` issue that lacks `fp-in-progress`/`fp-blocked`/`fp-skipped`
— **including the case where open issues remain but all are blocked.**
Do not require "zero issues exist at all"; all-blocked counts.

(If `successes >= 1`, you ship the batch PR instead — never run this
path in a session that already produced fixes.)

1. Find the campaign in `docs/fp-automation/campaigns.yaml` with
   `status: in_progress` or `status: discovering`. There should be
   exactly one.
2. Re-build truecourse: `pnpm install && pnpm build:dist` (only if
   not already built this session).
3. Re-clone the campaign's target at `baseline.target_ref` (only if
   not already cloned this session) and analyze:
   ```
   cd /tmp/target && \
     node $TRUECOURSE_DIR/dist/cli.mjs analyze --no-llm --no-stash --no-skills
   ```
   Read `/tmp/target/.truecourse/LATEST.json` and process
   `.violations[]`.
4. Classify violations and compute final `tp`, `fp`, `tp_rate` using
   the same rubric as fp-discover step 5.
5. **If `tp_rate >= 0.90`** — campaign is done. Open a campaign-close
   PR:
   - Branch: `claude/fp-campaign-close/<owner>-<repo>`.
   - File changes:
     - `docs/fp-automation/campaigns.yaml`: set `status: done`. Fill
       `final.*` (analyzed_at, target_ref, total_violations, tp, fp,
       tp_rate).
     - Patch-bump the version in all four required locations from
       CLAUDE.md:
       1. `tools/cli/package.json` — `version`
       2. `packages/core/package.json` — `version`
       3. `apps/dashboard/server/package.json` — `version`
       4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call.
     - **No** fixture or visitor changes.
   - Title: `chore(fp): close <owner>/<repo> campaign, bump to vX.Y.Z`.
   - Labels: `fp-campaign-complete`.
   - Body: list merged fp-fix PRs from this campaign (search by label
     `fp-target:<owner>-<repo>` + state merged), the before/after
     TP-rate, and the new version. Note in the body that the TP rate
     was measured against `node dist/cli.mjs` from the freshly-built
     dist — the exact artifact publish.yml will ship. End the body
     with `cc @mushgev`.
   - End. The merge fires fp-campaign-close (tags + ships) and
     fp-discover (next campaign).
6. **If `tp_rate < 0.90`** — campaign continues. Leave the campaign's
   `status` as `in_progress`. **Do not** open a campaign-close PR; no
   release is cut.

   **File new issues, but dedupe first.** For each rule that still
   shows FPs, check whether an **open** `fp-fix` issue for that
   `rule_key` already exists (any label — `fp-blocked` counts).
   - Rule has no open issue → file a new fp-fix issue (same shape as
     discovery).
   - Rule already has an open issue → **skip it**. Re-filing a rule
     that's already tracked (especially one that's `fp-blocked`) just
     creates duplicates.

   **Then branch on what you filed:**
   - **Filed ≥ 1 new issue** → continue into the per-issue loop in
     this same session. The target clone, dist build, `before_counts`,
     and counters are all still valid; only the issue list needs
     re-fetching. If the budget allows at least one success, the
     session ends with a normal batched PR (carrying the FP-count
     delta, firing Trigger B on merge). This removes the old manual
     "Run now" hand-off.
   - **Filed 0 new issues** (every FP-rule already has an open issue,
     and all pickable ones are blocked) → the campaign **cannot
     self-progress**: the only thing standing between it and 0.90 is
     human-gated work. Do not end silently. Instead **file or update a
     single tracking issue**:
     - First search for an open issue titled
       `[fp-campaign-stuck] <owner>/<repo>`.
     - If none exists → open one. Title:
       `[fp-campaign-stuck] <owner>/<repo>`. Body: current `tp_rate`,
       the close threshold (0.90), and a checklist of every open
       `fp-blocked` issue (number + rule_key) that must be resolved by
       a human before automation can proceed. End the body with
       `cc @mushgev`.
     - If one already exists → add a comment refreshing the `tp_rate`
       and the current blocked list (don't open a duplicate).
     - Then end the session. Opening/commenting the tracking issue is
       the human signal — never dead-end without it.

If the queue empties during the per-issue loop **after** at least one
success, go to "Open the batched PR" with what you have — don't run
the queue-empty path in the same session. The next session's loop will
hit a true empty queue and run the close logic.

## Hard constraints

- At most one **PR-opening** per session.
- At most **5 successful fixes** and **10 total attempts** per session.
- **Every PR body must contain a `## FP-count delta` section** —
  either a populated `Before | After | Delta` table or an explicit
  `unavailable: <one-line reason>`. The "After the loop" section is
  not optional; skipping it silently is a routine bug.
- Never push outside `claude/`-prefixed branches.
- Never run `truecourse analyze` without `--no-llm`.
- **Never use `npx truecourse`, `npx -y truecourse@<…>`, or
  `npm install truecourse`.** Always analyze with `node dist/cli.mjs`
  from a fresh `pnpm build:dist`. The dist artifact is exactly what
  publish.yml ships to npm.
- Never copy-paste OSS code — paraphrase only. Link the source by URL
  in the PR body (PR descriptions are review context, not committed
  artifacts).
- **No OSS-project identity in committed code.** Fixture filenames,
  paths, identifiers, and comments must not reference the upstream
  OSS owner/repo, the upstream's source filenames, or upstream-themed
  identifiers. The committed fixture should look like generic
  domain-agnostic code that happens to trigger the rule.
- Never change anything outside `packages/analyzer/src/rules/`,
  `packages/analyzer/src/patterns/`, `tests/fixtures/sample-*/`, and
  (in the queue-empty path) `docs/fp-automation/campaigns.yaml` +
  the four version-bump locations.
- A skipped (blocked / no-reproduces / refactor) issue only reverts
  **its own** fixture and visitor changes, never earlier-batch
  changes. The session's working tree is the accumulating draft of
  the batch PR.
- If anything is ambiguous, document it on the issue and continue the
  loop (or end the loop if it's session-wide). Do not invent state,
  do not skip steps, do not "try one more thing."
