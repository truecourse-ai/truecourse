---
name: spec-coverage-remeasure
description: Re-score a private group locally after a new contract kind has merged on the public engine repo. Pulls public main, rebuilds the CLI, re-measures, and reports whether the gap closed. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage remeasure
  - remeasure spec coverage locally
  - re-score after new kind
---

# Spec-Coverage — Remeasure (local)

Run the **remeasure** phase **locally** after a new contract **kind** has landed on the public
engine repo (`truecourse-ai/truecourse` via the `propose` → `implement` routines). Pull the new
kind into the local engine, re-measure the private group, and report whether its code-derivable gap
closed. **Nothing is committed or pushed.**

The authoritative procedure is **`docs/spec-coverage-automation/prompts/remeasure.md`**. Read it and
follow it exactly, with the LOCAL-MODE overrides below.

## Why this is local + manual

`implement` merges on the **public** repo; this group lives only on **your machine**. A public
PR-merge cannot trigger a local run, so remeasure is **manual** (you invoke this skill). This is the
loop's one human hop by design.

## LOCAL-MODE overrides

1. **Sync the engine first.** Before measuring, pull the public engine into this checkout and
   rebuild so the new kind is live: `git fetch origin && git merge --ff-only origin/main`
   (or `git pull`), then `pnpm install && pnpm build:dist`. Confirm the new kind is present
   (`node dist/cli.mjs contracts ...` / it appears in `kinds.yaml`).
2. **No GitHub event fired you.** Ask the user for the **group name** (and working-dir path if not
   the default `/tmp/spec-cov/<group>/`) and, optionally, which **kind** just merged (for the report).
3. **Re-generate contracts if the kind changes extraction.** A new kind means
   `contracts generate` may now lift more — re-run the deterministic generate stages on the group
   (as in `/spec-coverage-generate`) before scoring, so the contracts reflect the new kind.
4. **No branches, no PRs, no `groups.yaml`/`kinds.yaml` edits, nothing committed.** Keep the
   re-scored result on disk. If a gap remains, emit a fresh **sanitized** `new-kind` request (same
   rules as `/spec-coverage-measure` step 3) for the user to file on public by hand.

## Output

Report the before/after code-derivable coverage % and obligation count for the group, whether the
just-merged kind closed its gap, and any remaining sanitized `new-kind` requests. When coverage
clears the bar (default 90% code-derivable, 0 obligations, every remaining miss is narrative), say
so — the group is done; there's no close PR to open locally.
