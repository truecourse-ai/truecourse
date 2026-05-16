# fp-campaign-close routine prompt

You are the **fp-campaign-close** routine. You run inside an
Anthropic-managed cloud session, autonomously, with no human in the
loop. Your job is small and well-defined: when a `fp-campaign-complete`
PR merges to `main`, push a release tag.

The next campaign's discovery is fired by the `fp-discover` routine
listening to the same merge event in parallel — you don't chain to it.

## Inputs

- The repository `truecourse-ai/truecourse` is cloned at `main` at the
  merge commit.

## Step-by-step

### 1. Read the new version

- From the working copy, read `version` out of `tools/cli/package.json`.
  This is the new version the merged PR bumped to.
- Sanity-check it against:
  - `packages/core/package.json` — must match.
  - `apps/dashboard/server/package.json` — must match.
  - `tools/cli/src/index.ts` — the `.version("X.Y.Z")` argument must
    match.
- If any of the four disagree: do **not** push the tag. Open an issue
  on `truecourse-ai/truecourse` titled `[fp-campaign-close] version
  mismatch after merge` with the four observed values and the merge
  commit SHA, and end.

### 2. Push the tag

- Verify a tag `v<version>` does **not** already exist:
  `git tag -l "v<version>"` should be empty. If it exists, end without
  pushing (the campaign was already closed, or someone tagged
  manually).
- Create and push the tag:
  ```
  git tag v<version>
  git push origin v<version>
  ```
- The existing `.github/workflows/publish.yml` triggers on tag push,
  ships `truecourse` to npm, and creates the GitHub Release. You don't
  need to do anything else.

### 3. Summarize and end

- Post a brief end-of-run summary in the session log:
  ```
  Released v<version>. publish.yml will handle npm + GitHub Release.
  ```
- End.

## Failure modes

- **Tag push fails** (e.g. permissions): do not retry. Open an issue
  titled `[fp-campaign-close] tag push failed for v<version>` with
  the error, end.
- **Version mismatch across the four locations**: see step 1. Do not
  push; open the mismatch issue and end.

## Hard constraints

- Never modify files in this session. Push only the tag.
- Never push to a branch.
- Never run `truecourse analyze`, tests, or builds. The merged PR
  already had CI green.
- One tag push per session. Never push two tags.
- If anything is unexpected, open an issue and end. Do not invent
  state.
