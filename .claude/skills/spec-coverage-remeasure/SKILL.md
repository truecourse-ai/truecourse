---
name: spec-coverage-remeasure
description: Re-score a local group after a new contract kind merged on the public repo — sync the engine, regenerate the group's contracts in-place, re-score, report the coverage delta. This session answers the LLM mailbox. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage remeasure
  - remeasure spec coverage locally
  - re-score after new kind
---

# Spec-Coverage — Remeasure (local)

Follow **`docs/spec-coverage-automation/prompts/remeasure.md`** — it is the authoritative **local**
procedure. This is the loop's one manual hop: a public merge can't trigger a local run, so you
invoke this after a new kind lands on `truecourse-ai/truecourse`.

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`) — same one used before.
- **group label** (`<GROUP>`), and optionally which **kind** just merged (for the delta report).

`<TC_REPO>` is this truecourse checkout. Then run the procedure. Key points it relies on:
- **Sync first**: `git pull` + `pnpm build:dist` in `<TC_REPO>` so the new kind is live; confirm it's
  in `kinds.yaml` before measuring.
- **Clear the group cache** (`rm -rf <SPEC_PATH>/.truecourse`) so the new kind actually fires.
- LLM stages use **`--llm-transport agent`** — **this session answers the mailbox**; never spawn
  `claude -p`.
- **Blind reverse** + sanitized `new-kind` requests, same as measure. Commit nothing.
