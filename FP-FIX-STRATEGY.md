# False-Positive Fix Strategy

This document drives the work on branch `fp-fixes`. It is the source of truth for **how** each rule fix is done. The rules being fixed come from the report at `outreach-findings.md` (run on documenso 0.5.7 + OpenHands 0.5.7).

## The non-negotiable cycle

For every rule fix, in order:

1. **Add a positive fixture case.** A realistic snippet of the FP shape, embedded in `tests/fixtures/sample-{js,python}-project-positive/` under one of the existing services (`api-gateway`, `user-service`, `notification-service`, `web`, `infrastructure`). No `// VIOLATION:` comment — the positive fixture is asserted to produce **zero** violations.
2. **Add a corresponding negative case.** A realistic snippet that *should* fire, in `tests/fixtures/sample-{js,python}-project-negative/`, marked with `// VIOLATION: <rule-key>` (Python: `# VIOLATION: <rule-key>`) on the line **above** the violating code.
3. **Run tests and confirm they fail.** `pnpm test 2>&1 | tee /tmp/test-output.txt` and read the file. The positive test must report the FP we just added; the negative test must continue to fire on the new marker. If the positive test already passes, the fixture isn't representative — go back to step 1 with a closer match to the real-world FP.
4. **Fix the rule.** Edit only the analyzer code that produces the FP. No surrounding cleanup, no helper extraction, no scope creep.
5. **Re-run the full test suite. It must be fully green.** Not just the positive and negative fixture tests — every test in the suite. If any test is red, it is part of this cycle and must be fixed before the cycle is done. There is no such thing as a "pre-existing" or "unrelated" red test once you've started a cycle. If a graph snapshot drifts because you added files, update the snapshot. If anything else broke, root-cause and fix it. Red tests mean the work is not done.
6. **Commit.** One rule per commit. Commit message names the rule key and FP class (`fix(rule:hardcoded-secret): ignore identifier-like values (snake_case/kebab-case)`).

**Rules:**
- Never edit the rule before the fixture. Fixtures-first is the only ordering that proves the fix actually addressed the case we observed.
- Never weaken a rule by removing detections from the negative fixture. If a negative case has to be removed, that's a scope decision the user needs to confirm.
- Fixtures must use **realistic** code shapes, not synthetic toy snippets. Source the shape from the actual FP in documenso/OpenHands (the report has file:line refs).
- One rule per commit so each fix is bisectable.
- **Full green or not done.** Never use phrases like "pre-existing failure", "unrelated to my changes", or "out of scope" to defer a red test. Investigate, root-cause, fix. The only signal that work is complete is full green.

## Test commands

```bash
# All tests, save full output (per CLAUDE.md "no repeated grep" rule)
pnpm test 2>&1 | tee /tmp/test-output.txt

# Just the positive-fixture suite (fast iteration during a fix)
pnpm test tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/test-output.txt
pnpm test tests/analyzer/python-positive.test.ts 2>&1 | tee /tmp/test-output.txt

# Just the negative-fixture suite
pnpm test tests/analyzer/js-negative.test.ts 2>&1 | tee /tmp/test-output.txt
pnpm test tests/analyzer/python-negative.test.ts 2>&1 | tee /tmp/test-output.txt

# Rule-specific unit tests (e.g. secret-scanning)
pnpm test tests/analyzer/secret-scanning.test.ts 2>&1 | tee /tmp/test-output.txt
```

## Fixture conventions (verified by reading the test runners)

- **Positive fixture root**: `tests/fixtures/sample-{js,python}-project-positive/`. Test runner walks recursively and asserts `violations.length === 0`. Any code added here must not trigger any rule.
- **Negative fixture root**: `tests/fixtures/sample-{js,python}-project-negative/`. Test runner parses `// VIOLATION: <rule-key>` comments (`# VIOLATION:` for Python). Each marker MUST match a violation on the next line, and unexpected violations fail the test.
- **Service layout**: both fixtures use the same multi-service shape (`api-gateway`, `user-service`, `notification-service`, `web`, `infrastructure`). Match new code to the service whose role best fits (e.g. auth/identity → `user-service`, public API gateway → `api-gateway`, frontend → `web`).
- **Realism**: per `CLAUDE.md` and memory, fixtures must look like production code. Take the actual snippet from the documenso/OpenHands FP that motivated the fix and lift it into the fixture nearly verbatim, with naming adapted to the service.

## Fix queue (priority order from `outreach-findings.md`)

These are listed in the order to tackle them. Higher items have higher FP volume → bigger noise reduction per fix.

1. **`security/deterministic/hardcoded-secret`** — matches identifier-name shapes (`MANAGE_SECRETS = 'manage_secrets'`), env-var **names** as values (`'GITHUB_TOKEN'`), masked placeholders (`'**********'`), strings inside comments, sample-data files, and React Query keys. Combined ~47 critical FPs across both repos.
2. **`bugs/deterministic/conditional-hook`** — flags Zustand `useStore.getState()` calls in event handlers/services as React hook calls. 31 FPs in OpenHands.
3. **`bugs/deterministic/argument-type-mismatch`** — flags valid TS calls (`defineConfig({...})`, `await import("fs")`, `path.resolve(...)`, framework `.map()` returns). ~4,246 high-severity findings combined; biggest noise source.
4. **`bugs/deterministic/undefined-local-variable`** — does not handle Python's walrus operator (`NamedExpr`). Real analyzer bug, not just calibration. 2 FPs verified at `enterprise/storage/{saas_settings_store,user_store}.py`.
5. **`security/deterministic/hardcoded-database-password`** — matches f-string URL pattern even when the password slot is an interpolated variable (`{DB_PASS}`). 2 FPs.
6. **`security/deterministic/os-command-injection`** — fires on calls to a local function named `exec` regardless of whether `child_process.exec` is imported. 2 FPs.
7. **`database/deterministic/unsafe-delete-without-where`** — flags Alembic migrations whose explicit purpose is bulk delete/update. Add path exclusion for `**/migrations/versions/**`, `**/alembic/versions/**`. 2 FPs.
8. **`database/deterministic/missing-transaction`** — fires on non-DB awaits (`loadedPdf.destroy()`), on single writes (rule name says "multiple"), and on writes already inside a `prisma.$transaction(...)` / `tx.*` block. ~163 FPs.
9. **`reliability/deterministic/uncaught-exception-no-handler`** — applied per-file to every entry; should be project-level (one finding per project if no `process.on('uncaughtException')` is registered anywhere). ~60 FPs.
10. **`bugs/deterministic/array-callback-return`** — flags `array.map(async (x) => { ... })` where the async callback already implicitly returns a Promise. 21 FPs.

## Verification after the queue

After all (or a chosen prefix of) the fixes land:

```bash
# Re-run on the same two targets
cd /tmp/tc-targets/documenso && rm -rf .truecourse && \
  node /Users/musheghgevorgyan/repos/truecourse/.claude/worktrees/fp-fixes/tools/cli/dist/index.js \
       analyze --no-llm --no-skills --no-stash

cd /tmp/tc-targets/OpenHands && rm -rf .truecourse && \
  node /Users/musheghgevorgyan/repos/truecourse/.claude/worktrees/fp-fixes/tools/cli/dist/index.js \
       analyze --no-llm --no-skills --no-stash
```

Compare critical-tier counts before/after. Update `outreach-findings.md` with the post-fix numbers. Goal: **0 critical FPs on documenso, ≤5 critical (all real) on OpenHands**.

## What not to do

- Do not add a "skip" / "exclude" config option as a fix when the rule logic itself is wrong. The fix has to be in the rule.
- Do not turn off rules. Rule-level disables hide problems; we want them tightened, not silenced.
- Do not refactor adjacent code. Bug-fix-shaped commits only.
- Do not add comments explaining the fix. The commit message + the fixture pair are the documentation.
