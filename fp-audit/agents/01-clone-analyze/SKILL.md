---
name: fp-audit-01-clone-analyze
description: Clone a target repo and run truecourse analyze, producing a pinned snapshot for the FP audit pipeline. Inputs are a repo URL and an optional branch.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-pipeline/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue or abort per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- `repo_url` (required) — git URL or `https://github.com/owner/name`
- `branch` (optional, default `main`)
- `analyzer_root` (optional) — absolute path to the analyzer repo. If omitted, capture it before any `cd` with `ANALYZER_ROOT="$(git rev-parse --show-toplevel)"`. Required so we run the locally built CLI, not whatever `truecourse` is on PATH.

# Outputs

- `fp-audit/state/targets/<name>-<short_sha>/snapshots/<iso>_audit.json` — frozen `LATEST.json`
- `fp-audit/state/targets/<name>-<short_sha>/state.json` — target identity
- Empty dirs `slices/` and `reports/` for downstream agents

Print the audit dir path on success — downstream agents take it as input.

# Steps

1. Compute `name = basename(repo_url, ".git")`.
2. Set `target = /tmp/audit-targets/<name>`.
3. Ensure target is at the requested branch:
   - If `<target>` does not exist: `git clone --depth 1 -b <branch> <repo_url> <target>`.
   - Else: `git -C <target> fetch --depth 1 origin <branch> && git -C <target> checkout <branch> && git -C <target> reset --hard origin/<branch>`.
4. Capture SHAs:
   - `short_sha = $(git -C <target> rev-parse --short HEAD)`
   - `full_sha  = $(git -C <target> rev-parse HEAD)`
5. Capture `ANALYZER_ROOT` BEFORE cd-ing into the target if not already set: `ANALYZER_ROOT="$(git rev-parse --show-toplevel)"`. Verify `${ANALYZER_ROOT}/dist/cli.mjs` exists; if not, run `pnpm build:dist` from `${ANALYZER_ROOT}` and re-check.
6. Run analyzer in target: `cd <target> && node "${ANALYZER_ROOT}/dist/cli.mjs" analyze --no-llm --no-stash`. Do NOT use bare `truecourse` — that resolves to the globally installed npm package and won't see local visitor edits.
7. Verify `<target>/.truecourse/LATEST.json` exists. If missing, fail with the analyzer output.
8. Compute `audit = ${ANALYZER_ROOT}/fp-audit/state/targets/<name>-<short_sha>` (absolute path under the analyzer repo, NOT the cloned target).
9. `mkdir -p <audit>/snapshots <audit>/slices <audit>/reports`.
10. Copy snapshot:
    - `iso = $(date -u +%Y-%m-%dT%H-%M-%SZ)`
    - `cp <target>/.truecourse/LATEST.json <audit>/snapshots/<iso>_audit.json`
11. Write `<audit>/state.json`:
    ```json
    {
      "repo": "<name>",
      "repo_url": "<repo_url>",
      "branch": "<branch>",
      "target_commit_sha": "<full_sha>",
      "target_short_sha": "<short_sha>",
      "clone_path": "<target>",
      "analyzer_root": "<ANALYZER_ROOT>",
      "created_at": "<iso UTC, full ISO-8601>"
    }
    ```
12. Write `<audit>` (single line, no trailing whitespace) to `${ANALYZER_ROOT}/fp-audit/state/.last-audit-dir`.
13. Also print `<audit>` to stdout (single line, no extra text). That same path is the input for `02-classify`.

# Re-runs

If `state.json` already exists at the same `<audit>` and `target_commit_sha` matches, do NOT clobber it. Just append a fresh snapshot under `snapshots/<iso>_<label>.json` (use label `re-analyze` if invoked for status updates, or `audit` for the first run).

# Failure modes

- `dist/cli.mjs` missing AND `pnpm build:dist` fails — surface the build error, abort.
- Analyze exits non-zero — surface the analyzer's stderr verbatim, do not retry, do not write `state.json`.
- Branch doesn't exist on remote — surface git's error, abort.
