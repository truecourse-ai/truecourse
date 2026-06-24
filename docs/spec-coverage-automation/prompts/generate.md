# spec-coverage-generate — local procedure (CLI-driven)

Generate `.tc` contracts from a local folder of `.md` specs so coverage can be measured. The heavy
LLM stages run via the **truecourse CLI's default transport**, which spawns **parallel `claude -p`
workers** — far faster than this session hand-answering a mailbox. So this skill's job is to **set
things up and hand you the exact commands to run in your terminal**, then point you at
`/spec-coverage-measure`.

Local run: specs and generated contracts stay on your machine. No GitHub trigger, branch, PR,
storage branch, or `groups.yaml`.

## Inputs

- **`<SPEC_PATH>`** — absolute path to the folder of `.md` specs. A clean folder OR a whole repo is
  fine; `spec scan`'s relevance filter drops non-specs automatically — do not pre-curate or ask the
  user which subfolder is "really" the specs.
- **`<GROUP>`** — short label, output only.
- **`<TC_REPO>`** — the local `truecourse` checkout (where `dist/cli.mjs` is built).

Collect `<SPEC_PATH>` and `<GROUP>` in one question. Don't probe files first.

## Steps

### 1. Build the CLI if needed
In `<TC_REPO>`: if `dist/cli.mjs` is missing or older than the lockfile, run
`pnpm install && pnpm build:dist`. (You can do this for the user.)

### 2. Gitignore the output dir
`spec scan` writes to `<SPEC_PATH>/.truecourse/`. If `<SPEC_PATH>` is in a git repo and `.truecourse/`
isn't ignored there, append `.truecourse/` to that repo's `.gitignore`. Say you did it.

### 3. Hand the user the CLI commands to run (don't run the LLM stages yourself)

The LLM stages are long-running and parallelize across `claude -p` workers — running them through
this session (agent transport) is slow and serial, so **do NOT** run them here. Instead print the
exact block, with `<SPEC_PATH>` / `<TC_REPO>` substituted to real absolute paths, for the user to
paste into a terminal:

```bash
cd <SPEC_PATH>
node <TC_REPO>/dist/cli.mjs spec scan
node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults
node <TC_REPO>/dist/cli.mjs contracts generate
node <TC_REPO>/dist/cli.mjs contracts validate
```

- These use the **default `cli` transport** — the CLI spawns `claude -p` workers for the LLM stages
  (uses the user's local Claude auth; no API key, no `--llm-transport` flag needed). `validate` is
  deterministic.
- Tell the user this is the long part (minutes to longer on a big corpus) and to run it in their
  terminal, not in this chat — it's parallel and shouldn't tie up the session.
- **Do not** copy docs anywhere, build a temp workspace, or write a `.truecourseignore`. `spec scan`
  runs against the cwd; the relevance filter curates.

(Only if the user explicitly has no `claude` on PATH: fall back to `--llm-transport agent --io
/tmp/llm-io` on the three LLM stages and answer the mailbox in-session — slow; avoid unless needed.)

### 4. Tell the user what to do when it finishes

Once their CLI run completes:
- Outputs are at `<SPEC_PATH>/.truecourse/contracts/` (+ `specs/`).
- They can check counts with `cd <SPEC_PATH> && node <TC_REPO>/dist/cli.mjs contracts list`, and the
  `spec scan` output shows how many docs the relevance filter kept vs. skipped.
- Then run **`/spec-coverage-measure`** with the same path/group to score coverage.

## Hard rules
- **Don't run the LLM stages in-session.** Hand the user the CLI block; the CLI's parallel `claude
  -p` workers do the heavy lifting. (Building the CLI + the gitignore line are fine to do here.)
- Local only: never push to git, open a PR, or modify `<TC_REPO>` files. The only writes under
  `<SPEC_PATH>` are the `.truecourse/` the CLI creates + the one `.gitignore` line.
- Generate only produces contracts — reconstruction/scoring is `/spec-coverage-measure`. Commit nothing.
