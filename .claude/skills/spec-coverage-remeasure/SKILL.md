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

1. **Sync the engine first.** Before measuring, pull the public engine into the **truecourse
   checkout** (NOT the user's spec folder) and rebuild so the new kind is live:
   `cd /path/to/truecourse && git fetch origin && git merge --ff-only origin/main`
   (or `git pull`), then `pnpm install && pnpm build:dist`. Confirm the new kind is in
   `packages/contract-extractor/src/kinds.yaml`.
2. **No GitHub event fired you.** Ask the user for the **local spec path** (same one used in
   `/spec-coverage-generate` and `/spec-coverage-measure`), a short **group name** (label only),
   and optionally which **kind** just merged (for the report).
3. **Scan in-place — same as `/spec-coverage-generate`.** `cd` into the user's spec path and
   re-run the deterministic generate stages from there
   (`node /path/to/truecourse/dist/cli.mjs spec scan` …). A new kind means `contracts generate` may
   now lift more, so contracts are refreshed in **`<spec-path>/.truecourse/contracts/`** before
   scoring. **Do NOT copy** the docs anywhere; **do NOT write** anything to the user's path
   besides what `spec scan` / `contracts generate` write to `.truecourse/` themselves.
4. **No branches, no PRs, no `groups.yaml`/`kinds.yaml` edits, nothing committed.** Keep the
   re-scored result in `/tmp/spec-cov-measure/<group>/` (same place `/spec-coverage-measure`
   parks its bookkeeping). If a gap remains, emit a fresh **sanitized** `new-kind` request (same
   rules as `/spec-coverage-measure` step 3) for the user to file on public by hand.

## Output

Report the before/after code-derivable coverage % and obligation count for the group, whether the
just-merged kind closed its gap, and any remaining sanitized `new-kind` requests. When coverage
clears the bar (default 90% code-derivable, 0 obligations, every remaining miss is narrative), say
so — the group is done; there's no close PR to open locally.
