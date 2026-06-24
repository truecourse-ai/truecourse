---
name: spec-coverage-generate
description: Set up + hand you the CLI commands to generate `.tc` contracts from a local folder of `.md` specs. The heavy LLM stages run via the truecourse CLI (parallel `claude -p` workers) in your terminal — not in this session. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage generate
  - generate contracts for my specs locally
  - run spec-coverage generate
---

# Spec-Coverage — Generate (local, CLI-driven)

Follow **`docs/spec-coverage-automation/prompts/generate.md`** — the authoritative **local**
procedure. Its model: the LLM stages run through the truecourse CLI's default transport (parallel
`claude -p` workers), which is fast; running them through this session (agent mailbox) is slow and
serial, so **this skill does NOT run them** — it preps and prints the exact CLI block for the user
to run in their terminal.

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`) — a `.md` folder; a whole repo is fine.
- **group label** (`<GROUP>`) — output only.

`<TC_REPO>` is this truecourse checkout. Then:
- Build `dist/cli.mjs` if stale; add the `.truecourse/` `.gitignore` line (you may do these).
- **Print the `cd <SPEC_PATH>` + `spec scan` → `resolve` → `contracts generate` → `validate` block**
  with real absolute paths, default transport (no `--llm-transport` flag → CLI spawns `claude -p`).
  Tell the user to run it in their terminal — it's the long, parallel part; don't run it in-session.
- Don't probe files or ask which subfolder is "really" the specs — the relevance filter curates.

When their run finishes, point them at `/spec-coverage-measure` (same path/group).
