---
name: spec-coverage-measure
description: Score how much of a local spec was captured structurally — blind-reverse from the generated `.tc` contracts, compare to the originals, and emit sanitized `new-kind` requests for the user to file on the public repo. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage measure
  - measure spec coverage locally
  - score my spec contracts
---

# Spec-Coverage — Measure (local)

Follow **`docs/spec-coverage-automation/prompts/measure.md`** — it is the authoritative **local**
procedure (no branches, PRs, or `groups.yaml` machinery).

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`) — the same one used in `/spec-coverage-generate`; contracts
  are at `<SPEC_PATH>/.truecourse/contracts/`.
- **group label** (`<GROUP>`).

`<TC_REPO>` is this truecourse checkout. Then run the procedure. Key invariants it relies on:
- **Blind reverse**: reconstruct from the `.tc` contracts ONLY; don't read the original docs until
  the reconstruction is written.
- **Sanitize** every `new-kind` request (paraphrase, no doc paths, generic `motivating_group`) and
  **never auto-file** it — print it for the user to file on `truecourse-ai/truecourse`.
- This step does its own reasoning (reconstruct + score) — no truecourse LLM stage, no `claude -p`.
