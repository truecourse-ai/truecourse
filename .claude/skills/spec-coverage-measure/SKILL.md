---
name: spec-coverage-measure
description: Run the spec-coverage MEASURE step locally on a private group (blind-reverse the spec from the generated contracts, score code-derivable coverage, surface missing kinds). Files no issues automatically — emits a sanitized new-kind issue body for you to file by hand.
user_invocable: true
triggers:
  - spec coverage measure
  - measure spec coverage locally
  - score my spec contracts
---

# Spec-Coverage — Measure (local)

Run the **measure** phase **locally**: blind-reverse the spec from the generated `.tc` contracts
only, compare to the originals, score the **code-derivable** coverage, and identify gaps that need a
new contract **kind**. **Nothing is committed or pushed.**

The authoritative procedure is **`docs/spec-coverage-automation/prompts/measure.md`**. Read it and
follow it exactly, with the LOCAL-MODE overrides below.

## LOCAL-MODE overrides

1. **No GitHub event fired you.** Ask the user for the **group name** (and working-dir path if not
   the `/spec-coverage-generate` default `/tmp/spec-cov/<group>/`). The generated contracts must
   already exist there from a prior `/spec-coverage-generate` run.
2. **No branches, no PRs.** Skip every step that pushes a `claude/*` branch or opens/updates a
   measure PR. Keep the reconstruction (`reconstructed.md`), the coverage scoring, and any notes on
   disk in the working dir.
3. **The `new-kind` issue step is MANUAL and SANITIZED — this is the only thing that may leave the
   machine.** The prompt's "file one `new-kind` issue per code-derivable gap on
   `truecourse-ai/truecourse`" step becomes: for each gap, **produce the issue body but do NOT file
   it automatically.** Show the user the sanitized body and let them file it (or file via `gh` only
   if they explicitly approve). Sanitization is mandatory:
   - **Paraphrase** the requirement shape; never paste verbatim spec text.
   - **No private doc filenames, paths, section titles, or line ranges** in the body — describe the
     gap structurally (the proposed kind, its general requirement class, the deterministic code
     signal, a generic fixture plan), exactly the way `drift-fp` paraphrases OSS code.
   - Use a **generic `motivating_group`** label if the real group name reveals the content.
   The `proposed_tc_shape`, `code_signal`, and `fixture_plan` fields are about the *general kind*,
   not your data — keep them, just ensure no private specifics leak in.
4. **Do not edit `kinds.yaml` here.** That's the public engine's job (the `propose`/`implement`
   routines on `truecourse-ai/truecourse`). Locally you only measure and emit the sanitized request.

## Output

Report: code-derivable coverage %, obligation count (target 0), and the list of sanitized
`new-kind` requests (ready to file on the public repo). Once a kind is implemented + merged on
public, run **`/spec-coverage-remeasure`** to re-score with the new kind.
