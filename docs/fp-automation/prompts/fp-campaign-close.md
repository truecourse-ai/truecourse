# fp-campaign-close routine prompt

You are the **fp-campaign-close** routine. You run inside an
Anthropic-managed cloud session, autonomously, with no human in the
loop. Your job is small and well-defined: when a `fp-campaign-complete`
PR merges to `main`, push a release tag and trigger the next campaign.

## Inputs

- The repository `truecourse-ai/truecourse` is cloned at `main` at the
  merge commit.
- Environment variables (set on the routine's cloud environment):
  - `FP_DISCOVER_API_URL` — the `/fire` endpoint URL for the
    `fp-discover` routine.
  - `FP_DISCOVER_API_TOKEN` — the bearer token for that routine.

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
- The existing `.github/workflows/publish.yml` triggers on tag push
  and ships `truecourse` to npm. You don't need to do anything else
  for the release.

### 3. Fire the next campaign

- POST to `$FP_DISCOVER_API_URL` with the bearer token. No body needed
  — `fp-discover` will pick the next `pending` campaign from
  `docs/fp-automation/campaigns.yaml` on its own.

  ```
  curl -X POST "$FP_DISCOVER_API_URL" \
    -H "Authorization: Bearer $FP_DISCOVER_API_TOKEN" \
    -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{}'
  ```
- The response includes `claude_code_session_url`. Save it.

### 4. Summarize

- Find any open campaign with `status: pending` in
  `docs/fp-automation/campaigns.yaml` to identify which target was
  just kicked off. (Read-only — do not modify the file from this
  routine.)
- Post a brief end-of-run summary in the session log:
  ```
  Released v<version>.
  Fired fp-discover for <next-owner>/<next-repo>: <session-url>.
  ```
- End.

## Failure modes

- **Tag push fails** (e.g. permissions): do not retry. Open an issue
  titled `[fp-campaign-close] tag push failed for v<version>` with
  the error, end. The next chained campaign should not fire — leave
  `FP_DISCOVER_API_URL` unposted so the user can investigate.
- **`/fire` POST fails** (4xx/5xx): retry once. If still failing,
  open an issue titled `[fp-campaign-close] fp-discover fire failed
  after v<version>`, attach the response body, end. The tag was
  pushed and the npm release will still happen — only the next
  campaign chain is broken, and the user can manually click
  "Run now" on fp-discover.
- **Env vars missing**: end with a log message
  `FP_DISCOVER_API_URL / FP_DISCOVER_API_TOKEN not configured`. Do
  **not** push the tag without the chain wired up — that would
  silently break the loop.

## Hard constraints

- Never modify files in this session. Push only the tag.
- Never push to a branch.
- Never run `truecourse analyze`, tests, or builds. The merged PR
  already had CI green.
- One tag push per session. Never push two tags.
- If anything is unexpected, open an issue and end. Do not invent
  state.
