---
name: spec-coverage-generate
description: Generate `.tc` contracts from a local folder of `.md` specs (spec scan → resolve → contracts generate), in-place, with this session answering the LLM mailbox. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage generate
  - generate contracts for my specs locally
  - run spec-coverage generate
---

# Spec-Coverage — Generate (local)

Follow **`docs/spec-coverage-automation/prompts/generate.md`** — it is the authoritative **local**
procedure (already written for local use: no branches, PRs, storage, or GitHub-event machinery to
skip).

Ask the user once, in a single message, for:
- **spec folder path** (`<SPEC_PATH>`) — a directory of `.md` files; a clean folder OR a whole repo
  is fine.
- **group label** (`<GROUP>`) — short, output-only.

`<TC_REPO>` is this truecourse checkout (where `dist/cli.mjs` is). Then run the procedure.

Two things the procedure depends on, so honor them:
- LLM stages use **`--llm-transport agent`** — **this session answers the mailbox**; never spawn
  `claude -p` / use `--llm-transport cli`.
- Don't probe files or ask which subfolder is "really" the specs — `spec scan`'s relevance filter
  curates. Just collect the two inputs and go.
