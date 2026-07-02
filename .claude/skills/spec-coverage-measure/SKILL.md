---
name: spec-coverage-measure
description: Score how much of a local spec was captured structurally — blind-reverse from the `.tc` contracts at `<spec-path>/.truecourse/contracts/`, compare to the originals, and emit sanitized `new-kind` requests for the user to file on the public repo. Run AFTER you've generated contracts via the truecourse CLI in your terminal. Nothing is committed or pushed.
user_invocable: true
triggers:
  - spec coverage measure
  - measure spec coverage locally
  - score my spec contracts
---

# Spec-Coverage — Measure (local)

Follow **`docs/spec-coverage-automation/prompts/measure.md`** — the authoritative **local**
procedure.

**Prerequisite (manual, in the user's terminal — not this skill's job):** the user has already
generated `.tc` contracts by running these CLI commands in their spec folder, with the truecourse
CLI built (`pnpm install && pnpm build:dist` in the truecourse checkout):

```bash
cd <SPEC_PATH>
node <TC_REPO>/dist/cli.mjs spec scan
node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults
node <TC_REPO>/dist/cli.mjs contracts generate
node <TC_REPO>/dist/cli.mjs contracts validate
```

(Default `cli` transport spawns parallel `claude -p` workers — the fast path.)

If `<SPEC_PATH>/.truecourse/contracts/` doesn't exist when you start, tell the user to run those
four commands first and stop.

Ask the user once for:
- **spec folder path** (`<SPEC_PATH>`) — contracts are at `<SPEC_PATH>/.truecourse/contracts/`.
- **group label** (`<GROUP>`).

`<TC_REPO>` is this truecourse checkout. Then run the procedure. Key invariants it relies on:
- **Blind reverse**: reconstruct from the `.tc` contracts ONLY; don't read the original docs until
  the reconstruction is written.
- **Sanitize** every `new-kind` request (paraphrase, no doc paths, generic `motivating_group`) and
  **never auto-file** it — print it for the user to file on `truecourse-ai/truecourse`.
- Pure session reasoning — no LLM CLI stage, no `claude -p`, no agent mailbox.
