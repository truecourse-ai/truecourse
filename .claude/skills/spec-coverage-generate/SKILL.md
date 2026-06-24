---
name: spec-coverage-generate
description: Run the spec-coverage GENERATE step locally on a private folder of .md specs (spec scan + contracts generate). Nothing is committed or pushed; specs and contracts stay on this machine.
user_invocable: true
triggers:
  - spec coverage generate
  - generate contracts for my specs locally
  - run spec-coverage generate
---

# Spec-Coverage — Generate (local)

Run the **generate** phase of the spec-coverage loop **locally** on a private folder of `.md`
specs: produce `.tc` contracts on disk so coverage can be measured. **Nothing is committed or
pushed** — private specs and generated artifacts stay on this machine.

The authoritative, step-by-step procedure is **`docs/spec-coverage-automation/prompts/generate.md`**.
Read it and follow it exactly — but this is a **local run, not a cloud routine**, so apply the
LOCAL-MODE overrides below wherever the prompt assumes the routine/GitHub context.

## LOCAL-MODE overrides

1. **No GitHub event fired you.** Ask the user for: the **local path** to the specs (a directory —
   a clean spec folder OR a whole repo is fine, see below) and a short **group name**. Do not read
   `groups.yaml` or pick a `pending` campaign — the user names the group and points at the docs.
   **Point `spec scan` at the path the user gives and run it — do NOT interrogate the user about
   which subfolder is "really" the specs.** `spec scan` has a built-in **LLM relevance filter**
   (`relevance-filter.ts`) that classifies every `.md` and **drops the non-specs** (READMEs, task
   logs, agent prompts, setup guides …), reporting them under `skipped[]`. Curation is the scan's
   job, not a question for the user. (Only narrow the path if the user *asks* to, e.g. to cut cost
   on a very large tree — the filter still makes one classification call per doc.)
2. **No branches, no PRs, no storage branch.** Skip every step that creates/pushes a `claude/*`
   branch or opens a PR (e.g. the `claude/spec-cov-store/<group>` storage PR). Keep the generated
   specs + `.tc` contracts on disk in a working directory — default `/tmp/spec-cov/<group>/` unless
   the user picks another path.
3. **Nothing leaves the machine.** Never commit or push the spec docs or the generated specs/
   contracts to any repo. This is private content; that is the whole point of running locally.
4. **CLI from this repo.** Build once (`pnpm install && pnpm build:dist`) and run the deterministic
   stages with `node dist/cli.mjs` exactly as the prompt directs (`spec scan` →
   `spec resolve --all-defaults` → `contracts generate`), using `--llm-transport agent` so the LLM
   stages run in THIS session (no API key needed). Point inputs/outputs at the working dir from (1).

## Output

Report: where the `.tc` contracts landed, the artifact counts (`node dist/cli.mjs contracts list`
against the working dir), and **which docs the scan kept vs. skipped** (the relevance filter's
`skipped[]`) so the user can sanity-check the curation. Then tell the user to run
**`/spec-coverage-measure`** on the same group to score coverage and surface any missing kinds.
