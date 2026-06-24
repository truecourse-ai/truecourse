# spec-coverage-generate — local procedure

Generate `.tc` contracts from a local folder of `.md` specs so coverage can be measured. This is a
**local** run: everything happens on your machine, against a folder you point at. The specs and the
generated contracts never leave the machine — the LLM work is done by **this Claude session itself**
(agent transport), not by any external service or spawned process.

Invoked by the `/spec-coverage-generate` skill. There is **no GitHub trigger, no branch, no PR, no
storage branch, no `groups.yaml`** — none of the cloud-routine machinery. Just a local CLI run whose
LLM prompts this session answers.

## Inputs

- **`<SPEC_PATH>`** — absolute path to the folder of `.md` specs. A clean spec folder **or** a whole
  repo is fine; `spec scan`'s built-in LLM relevance filter classifies every `.md` and drops the
  non-specs (READMEs, task logs, setup guides, agent prompts), so you don't pre-curate.
- **`<GROUP>`** — a short label, used only in your output messages. Nothing is created under it.
- **`<TC_REPO>`** — the local `truecourse` checkout (where `dist/cli.mjs` is built).

Collect `<SPEC_PATH>` and `<GROUP>` from the user in one question. **Do not** interrogate them about
which subfolder is "really" the specs — the relevance filter is the curator. **Do not** read source
files or probe internals before running; take the inputs and go.

## Steps

### 1. Build the CLI if needed
In `<TC_REPO>`: if `dist/cli.mjs` is missing or older than the lockfile, run
`pnpm install && pnpm build:dist`. Invoke as `node <TC_REPO>/dist/cli.mjs`. Never `npx truecourse`.

### 2. Gitignore the output dir
`spec scan` writes its store to `<SPEC_PATH>/.truecourse/`. If `<SPEC_PATH>` is inside a git repo and
`.truecourse/` isn't already ignored there, append a single `.truecourse/` line to that repo's
`.gitignore`. Say you did it.

### 3. Run the pipeline in-place, answering the LLM mailbox yourself (agent transport)

The LLM stages use **`--llm-transport agent`**: the CLI writes each prompt to a filesystem mailbox
and **this session answers it** — no `claude -p` subprocess, no second model, no API key. `cd
<SPEC_PATH>` and run each LLM stage **in the background**, answering its mailbox until the process
exits; `contracts validate` is deterministic (foreground).

```bash
mkdir -p /tmp/llm-io/requests /tmp/llm-io/responses
cd <SPEC_PATH>
node <TC_REPO>/dist/cli.mjs spec scan                   --llm-transport agent --io /tmp/llm-io &
#   …answer the mailbox until this exits, then:
node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults  --llm-transport agent --io /tmp/llm-io &
node <TC_REPO>/dist/cli.mjs contracts generate           --llm-transport agent --io /tmp/llm-io &
node <TC_REPO>/dist/cli.mjs contracts validate           # deterministic, foreground
```

**Mailbox protocol** (match exactly):
- The tool writes each prompt to `/tmp/llm-io/requests/<id>.json` —
  `{ id, stage, model, fallbackModel, responseFormat, schema, system, user }`.
- You answer by writing `/tmp/llm-io/responses/<id>.json` (**same filename**) =
  `{ "text": "<answer>" }`, where `text` is a JSON **string**:
  - `responseFormat: "json"` (default) → `text` is the schema-satisfying JSON **serialized as a
    string**, no code fences (e.g. `{"text":"{\"claims\":[…]}"}`). Satisfy the request's `schema`
    exactly; invent no fields; **never** dump prose into a free-form obligation field to fake
    coverage — the obligation count is driven to zero downstream. Answer faithfully to the spec text.
  - `responseFormat: "text"` → free-form.
  - To fail a request unrecoverably: write `{ "error": "<reason>" }`.
- The tool polls every 200ms and times out an unanswered request after 10 min. Poll
  `/tmp/llm-io/requests/` for any `<id>.json` with no `responses/<id>.json` sibling, answer in
  parallel, and keep going until the background process exits. (`spec resolve --all-defaults` re-runs
  the scan internally, so most prompts are cache hits — expect few new requests; just stay ready.)

**Do not** copy the docs anywhere, **do not** build a temp workspace, **do not** write a
`.truecourseignore`. `spec scan` runs against the cwd; the relevance filter handles curation.

If a stage exits non-zero, stop and show the user the error tail — don't proceed with partial
contracts.

### 4. Report
- **Outputs:** `<SPEC_PATH>/.truecourse/contracts/` (and `<SPEC_PATH>/.truecourse/specs/`).
- **Artifact counts:** `cd <SPEC_PATH> && node <TC_REPO>/dist/cli.mjs contracts list`.
- **Curation:** how many docs the relevance filter kept vs. skipped (from the `spec scan` output),
  with a few example skips so the user can sanity-check.
- Tell the user to run **`/spec-coverage-measure`** with the same path/group to score coverage.

## Hard rules
- **Local only, no external worker.** The LLM work is done by **this session** via the agent mailbox
  — never spawn `claude -p` (no `--llm-transport cli`), never `npx truecourse`, never an API key.
- Never push to git, never open a PR, never modify `<TC_REPO>` files. The only thing you write under
  `<SPEC_PATH>` is the `.truecourse/` the CLI creates plus the one `.gitignore` line in step 2.
- **Generate only produces contracts.** You do NOT reconstruct or score the spec here — that's
  `/spec-coverage-measure`. Commit nothing.
