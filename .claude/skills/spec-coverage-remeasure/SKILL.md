---
name: spec-coverage-remeasure
description: Re-score a local group after a new contract kind merged on the public repo. Walks the user through `git pull` + rebuild + the manual CLI regenerate, then re-scores in this session. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage remeasure
  - remeasure spec coverage locally
  - re-score after new kind
---

# Spec-Coverage — Remeasure (local)

Follow **`docs/spec-coverage-automation/prompts/remeasure.md`** — the authoritative **local**
procedure. This is the loop's one manual hop: a public merge can't trigger a local run, so the user
invokes this after a new kind lands on `truecourse-ai/truecourse`.

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`).
- **group label** (`<GROUP>`); optionally which **kind** just merged (for the delta report).

`<TC_REPO>` is this truecourse checkout. Walk them through, in order (do the cheap bits for them;
the LLM regenerate stage is **theirs to run in their terminal**, not this skill's):

1. **Sync the engine** in `<TC_REPO>`: `git pull` then `pnpm install && pnpm build:dist`. Confirm
   the new kind is in `kinds.yaml`.
2. **Clear the group cache** so the new kind actually fires: `rm -rf <SPEC_PATH>/.truecourse`.
3. **Tell them to re-run the CLI block** in their terminal (default `cli` transport, parallel
   `claude -p` workers — fast):
   ```bash
   cd <SPEC_PATH>
   node <TC_REPO>/dist/cli.mjs spec scan
   node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults
   node <TC_REPO>/dist/cli.mjs contracts generate
   node <TC_REPO>/dist/cli.mjs contracts validate
   ```
   Do **not** run these LLM stages in-session.
4. Once they confirm it's done: do the **blind reverse + re-score** in this session (same as
   `/spec-coverage-measure`), and emit any remaining sanitized `new-kind` request for them to file.
   Commit nothing.
