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

Run the three LLM stages with `--llm-transport agent`. Each stage runs **in the background** and
hands you its prompts through a filesystem mailbox at `--io /tmp/llm-io`; you answer them by hand
until the stage process exits.

**The mailbox protocol** (this is exactly what the `agent` transport reads/writes — match it
precisely):

- The tool writes each prompt to **`/tmp/llm-io/requests/<id>.json`** — a JSON object with fields
  `{ id, stage, model, fallbackModel, responseFormat, schema, system, user }`.
- You answer by writing **`/tmp/llm-io/responses/<id>.json`** — **same filename** — with body
  **`{ "text": "<your answer>" }`**. `text` **must be a JSON string**.
  - When `responseFormat` is `"json"` (the default), the tool does `JSON.parse(text)` after
    stripping any code fence — so `text` must be the **schema-satisfying JSON serialized as a
    string** (e.g. `{"text": "{\"claims\": [ … ]}"}`), **not** a nested JSON object. Satisfy the
    request's `schema` exactly; invent no fields.
  - When `responseFormat` is `"text"`, `text` is free-form.
  - To surface an unrecoverable answer failure, write `{ "error": "<reason>" }` instead — the tool
    will abort that stage.
- The tool polls every 200ms and times out a single unanswered request after 10 min, so keep the
  loop running continuously until the **process exits**.

**The answer loop** (run for each stage):

```
mkdir -p /tmp/llm-io/requests /tmp/llm-io/responses
cd /tmp/target && node $TRUECOURSE_DIR/dist/cli.mjs spec scan --llm-transport agent --io /tmp/llm-io &
```

While that background process is alive: poll `/tmp/llm-io/requests/` for any `<id>.json` that has
no matching `/tmp/llm-io/responses/<id>.json`. For each, read `{system, user, schema,
responseFormat}`, produce the answer, and write `/tmp/llm-io/responses/<id>.json` as
`{"text": "…"}`. Answer batches in parallel. Keep going until the process exits (it writes the
stage's output and finishes).

Repeat the same background-run + answer-loop for the remaining stages, **in order**:

```
node $TRUECOURSE_DIR/dist/cli.mjs spec resolve --all-defaults --llm-transport agent --io /tmp/llm-io &
node $TRUECOURSE_DIR/dist/cli.mjs contracts generate --llm-transport agent --io /tmp/llm-io &
node $TRUECOURSE_DIR/dist/cli.mjs contracts validate   # deterministic, no LLM, foreground
```

(`spec resolve --all-defaults` re-runs the scan internally, so most prompts are **cache hits** —
expect few or no new request files; just keep the loop ready and wait for the process to exit.
`contracts validate` is deterministic — no prompts, runs in the foreground.)

If a stage errors (non-zero exit), capture the tail for the PR/issue and stop — don't pin partial
contracts.

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
- **Open the PR with the `drift-fp-store` label applied atomically — in a single command.** The
  `drift-fp-discover` routine triggers on `pull_request.opened` filtered by
  `Labels is-one-of drift-fp-store`. GitHub fires `pull_request.opened` once, at the moment the
  PR is created, with the labels present **at that moment**. If you `gh pr create` first and
  `gh pr edit --add-label` second, the `opened` event carries no labels, the trigger never
  matches, and discover never fires — the chain stalls. So use one command:

  ```bash
  gh pr create \
    --base main \
    --head claude/drift-fp-store/<owner>-<repo> \
    --label drift-fp-store \
    --title 'chore(drift-fp): contracts store for <owner>/<repo> @ <short-sha>' \
    --body-file /tmp/storage-pr-body.md
  ```

  Write the body to a file first (next bullet) so you don't have to escape multi-line markdown
  inline. Do **not** add the label as a separate step.
- **PR body** (write to `/tmp/storage-pr-body.md` before the `gh pr create` call): a clear
  "⚠️ DO NOT MERGE — storage branch for the <owner>/<repo> drift campaign; deleted automatically
  at campaign close" banner, plus target_ref, doc_scope, artifact counts from `contracts list`
  (e.g. "98 .tc: 21 operation, 3 enum, 21 named-constant, …"), and any `contracts validate`
  warnings. End with `cc @mushgev`.
- **This PR is never merged**; it's pure storage + the discover trigger.
  `drift-fp-campaign-close` closes it + deletes the branch when the campaign finishes.
- **Verify the label landed.** After `gh pr create` returns, immediately
  `gh pr view <number> --json labels --jq '.labels[].name'`. If `drift-fp-store` isn't in the
  output, the label-on-creation failed silently (rare — but if it does, the trigger won't fire).
  In that case post a one-line failure note (`cc @mushgev`) and stop so a human can recover —
  do **not** attempt a second `--add-label` call to recover, because the `pull_request.opened`
  event has already fired without the label and the trigger has already missed it.
- Stop. Opening the labeled PR fires `drift-fp-discover`.

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
