# drift-fp-generate routine prompt

You are the **drift-fp-generate** routine — the **front of the chain**. You run inside an
Anthropic-managed cloud session, autonomously. Your job: for one target repo, run the **LLM
stages once** (`spec scan` + `contracts generate`) via the **agent LLM transport**, **commit the
generated specs + `.tc` contracts onto a per-campaign storage branch**, and open a **storage PR
that is never merged**. Opening that PR fires `drift-fp-discover`; everything downstream runs only
deterministic `verify` against the contracts on that branch.

This is the only routine that does LLM work. It uses the **`--llm-transport agent`** transport (the
tool hands each prompt to *you* via files — no `claude` subprocess, no API key). You generate the
contracts **once**; freezing them on the storage branch is what makes the rest of the loop
deterministic. The contracts **never reach `main`** — the branch is deleted when the campaign
closes.

Run exactly one campaign per invocation. Do **not** loop across campaigns.

## Inputs

- `truecourse-ai/truecourse` is cloned at the default branch.
- Fires from **Run now** (first-time bootstrap) or a `pull_request.closed` campaign-close merge
  (it shares that trigger with `drift-fp-campaign-close`, which tags + cleans up the just-finished
  campaign while you start the next one). The campaign is determined by reading `campaigns.yaml`.

## Step-by-step

### 1. Pick the campaign

- Read `campaigns.yaml`. Pick the first campaign with `status: pending` **whose storage branch
  doesn't exist yet** — check with `git ls-remote --heads origin
  claude/drift-fp-store/<owner>-<repo>` (empty = not generated). Branch existence, not a yaml flag,
  is the "already generated" signal (you can't flip a `main` flag — you never merge to `main`).
- If none: post "no campaigns need contract generation" and stop.

### 2. Build truecourse from local source

- `pnpm install && pnpm build:dist` → `dist/cli.mjs` (the artifact publish.yml ships; never
  `npx truecourse`).

### 3. Clone the target and scope the spec corpus

- `git clone https://github.com/<owner>/<repo>.git /tmp/target`. **If the campaign note says the
  default branch isn't `main`** (e.g. strapi → `develop`), `git -C /tmp/target checkout <that-branch>`
  first. Then record `git -C /tmp/target rev-parse HEAD` as `target_ref` (full SHA) — this exact
  SHA goes in `meta.yaml` and is what discover/next-fix verify against, so it must be a real commit
  on the branch you generated from.
- Write `/tmp/target/.truecourseignore` from the campaign's `doc_scope`: ignore all `*.md`, then
  re-include only the listed spec dirs, so `spec scan` stays focused and cheap. Example (strapi):
  ```
  *.md
  !docs/docs/docs/01-core/authentication/**
  !docs/docs/docs/01-core/content-manager/**
  !docs/docs/docs/01-core/content-releases/**
  !docs/docs/docs/01-core/permissions/**
  !docs/docs/rfcs/**
  ```

### 4. Generate contracts via the agent transport

Run the three LLM stages with `--llm-transport agent`, driving the prompt I/O yourself:

- Start a stage in the background with an I/O dir, e.g.:
  ```
  cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs spec scan --llm-transport agent --io /tmp/llm-io &
  ```
- **Answer loop** (while the tool process is alive): poll `/tmp/llm-io/req/` for request files
  with no matching `/tmp/llm-io/res/<id>.json` answer. For each, read `{system, user, schema}`,
  produce JSON that **strictly satisfies `schema`**, and write it to `/tmp/llm-io/res/<id>.json`.
  Answer batches in parallel; keep going until the tool exits (it writes the stage's output and
  finishes).
- Repeat for the remaining stages, in order:
  ```
  node $TRUECOURSE_DIR/dist/cli.mjs spec resolve --all-defaults --llm-transport agent --io /tmp/llm-io
  node $TRUECOURSE_DIR/dist/cli.mjs contracts generate --llm-transport agent --io /tmp/llm-io
  node $TRUECOURSE_DIR/dist/cli.mjs contracts validate   # deterministic, no LLM
  ```
  (`spec resolve --all-defaults` re-runs the scan internally, so most prompts are **cache hits** —
  expect few or no new request files; just wait for the process to exit. `contracts validate` is
  deterministic — no prompts.)
- Produce only schema-valid answers; do not invent fields. If a stage errors, capture the tail
  for the PR/issue and stop (don't pin partial contracts).

### 5. Commit specs + contracts onto the storage branch

- Create a fresh branch off `main`: `git checkout -b claude/drift-fp-store/<owner>-<repo> origin/main`.
- Copy the generated **specs and contracts** into the campaign dir:
  ```
  mkdir -p docs/drift-fp-automation/contracts/<owner>-<repo>
  cp -R /tmp/target/.truecourse/specs      docs/drift-fp-automation/contracts/<owner>-<repo>/specs
  cp -R /tmp/target/.truecourse/contracts  docs/drift-fp-automation/contracts/<owner>-<repo>/contracts
  cp     /tmp/target/.truecourseignore     docs/drift-fp-automation/contracts/<owner>-<repo>/truecourseignore
  ```
  (The committed `truecourseignore` intentionally drops the leading dot — it's provenance, never
  re-applied; only the live `/tmp/target/.truecourseignore` is an active ignore file.)
- Write `docs/drift-fp-automation/contracts/<owner>-<repo>/meta.yaml`:
  ```yaml
  target_repo: <owner>/<repo>
  target_ref: <full-sha>          # AUTHORITATIVE — discover/next-fix verify at this SHA
  code_dir: <campaign code_dir>
  generated_at: "<ISO date>"
  tool_version: <version from tools/cli/package.json>
  llm: agent                      # transport used
  doc_scope: [ <the campaign's doc_scope dirs> ]
  ```
- Commit and push this branch. (Do **not** touch `campaigns.yaml` — you never merge to `main`;
  `drift-fp-discover`'s PR is what flips the campaign to `discovering`.)

### 6. Open the storage PR (never merged)

- **Verify your branch before pushing.** Run `git rev-parse --abbrev-ref HEAD` and confirm it is
  exactly `claude/drift-fp-store/<owner>-<repo>`. If it isn't (e.g. you're still on the routine's
  default `claude/<random>` branch), STOP. Recreate the correct branch from `origin/main`,
  cherry-pick or re-stage the commit from step 5, delete the wrong branch, then push. Pushing from
  the wrong branch produces a PR whose head doesn't match the `drift-fp-discover` trigger filter
  (`Head Branch starts-with claude/drift-fp-store/`), and the chain stalls before discover fires.
- Open a PR with head `claude/drift-fp-store/<owner>-<repo>`, base `main`.
- Title `chore(drift-fp): contracts store for <owner>/<repo> @ <short-sha>`.
- **Label `drift-fp-store`** — opening this PR (a `pull_request.opened` event) is what fires
  `drift-fp-discover`. **This PR is never merged**; it's pure storage + the discover trigger, and
  `drift-fp-campaign-close` closes it + deletes the branch when the campaign finishes.
- Body: a clear "⚠️ DO NOT MERGE — storage branch for the <owner>/<repo> drift campaign; deleted
  automatically at campaign close" banner, plus target_ref, doc_scope, artifact counts from
  `contracts list` (e.g. "98 .tc: 21 operation, 3 enum, 21 named-constant, …"), and any
  `contracts validate` warnings. End with `cc @mushgev`.
- Stop. Opening the PR fires `drift-fp-discover`.

## Hard constraints

- One campaign per session. Generate contracts for exactly one repo.
- LLM work happens **only** through `--llm-transport agent` (you answer the prompts). Never rely on a
  `claude` subprocess being present; never use `npx truecourse` / `npm install truecourse`.
- Never push outside `claude/`-prefixed branches. **Never merge the storage PR.** Never commit
  the contracts to `main`.
- Commit **complete, validated** contracts only — if any stage failed, don't push the storage
  branch or open the PR; report and stop.
- Never paste OSS code into the PR body — link by URL only.
- If anything is ambiguous, post the blocker (`cc @mushgev`) and stop. Do not invent state.
