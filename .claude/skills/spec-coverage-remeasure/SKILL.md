---
name: spec-coverage-remeasure
description: Re-score a local group after a new contract kind merged on the public repo — sync the engine, hand you the CLI block to regenerate contracts (parallel `claude -p` workers), then re-score and report the coverage delta. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage remeasure
  - remeasure spec coverage locally
  - re-score after new kind
---

# Spec-Coverage — Remeasure (local)

Follow **`docs/spec-coverage-automation/prompts/remeasure.md`** — the authoritative **local**
procedure. This is the loop's one manual hop: a public merge can't trigger a local run, so you
invoke this after a new kind lands on `truecourse-ai/truecourse`.

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`) — same one used before.
- **group label** (`<GROUP>`), and optionally which **kind** just merged (for the delta report).

`<TC_REPO>` is this truecourse checkout. Key points the procedure relies on:
- **Sync first**: `git pull` + `pnpm build:dist` in `<TC_REPO>` so the new kind is live; confirm it's
  in `kinds.yaml`. (You may do this.)
- **Clear the group cache** (`rm -rf <SPEC_PATH>/.truecourse`) so the new kind actually fires.
- **Regenerate via the CLI**: print the `cd <SPEC_PATH>` + `spec scan → resolve → contracts generate
  → validate` block (default transport = `claude -p` workers) for the user to run in their terminal
  — don't run the LLM stages in-session.
- Then do the **blind reverse + re-score** yourself (session reasoning), and emit sanitized
  `new-kind` requests for any remaining gap. Commit nothing.
