# spec-coverage-remeasure — local procedure

Re-score a local group after a new contract **kind** has merged on the public engine repo
(`truecourse-ai/truecourse`). Pull the new kind into the local engine, regenerate the group's
contracts fresh against it, blind-reverse, and report the coverage delta. **Local** run — everything
stays on the machine; the LLM work is done by **this session** (agent transport).

Invoked by `/spec-coverage-remeasure`. No GitHub trigger, no branch, no PR, no `groups.yaml`, no
close PR — this is the loop's one manual hop (a public merge can't trigger a local run).

## Inputs

- **`<SPEC_PATH>`** — the same folder used in `/spec-coverage-generate` + `/spec-coverage-measure`.
- **`<GROUP>`** — short label for output.
- **`<TC_REPO>`** — local truecourse checkout.
- Optionally, which **`<KIND>`** just merged (for the delta report).

Collect `<SPEC_PATH>` and `<GROUP>` in one question.

## Steps

### 1. Sync the engine and rebuild
In **`<TC_REPO>`** (NOT the spec folder): `git fetch origin && git merge --ff-only origin/main`
(or `git pull`), then `pnpm install && pnpm build:dist`. Confirm the new kind is present in
`packages/contract-extractor/src/kinds.yaml`. If the build doesn't contain it, stop and tell the
user — don't measure against a stale engine.

### 2. Clear the group's cache so the new kind can fire
A stale scan/spec cache would reproduce the old, kind-less contracts and hide the improvement:
```bash
rm -rf <SPEC_PATH>/.truecourse
rm -rf /tmp/llm-io && mkdir -p /tmp/llm-io/requests /tmp/llm-io/responses
```

### 3. Regenerate contracts fresh, in-place (agent transport)
Same as `/spec-coverage-generate` step 3: `cd <SPEC_PATH>` and run the LLM stages with
`--llm-transport agent --io /tmp/llm-io`, answering the mailbox yourself (no `claude -p` spawn):
```bash
cd <SPEC_PATH>
node <TC_REPO>/dist/cli.mjs spec scan                   --llm-transport agent --io /tmp/llm-io &
node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults  --llm-transport agent --io /tmp/llm-io &
node <TC_REPO>/dist/cli.mjs contracts generate           --llm-transport agent --io /tmp/llm-io &
node <TC_REPO>/dist/cli.mjs contracts validate
```
(See generate.md's "Mailbox protocol" for the request/response file format — it's identical.)
Record `contracts list` counts; the new contracts are in `<SPEC_PATH>/.truecourse/contracts/`.

### 4. Blind-reverse + re-score (exactly like measure)
Run `/spec-coverage-measure`'s steps 2–3 against the regenerated contracts: reconstruct from the
`.tc` files **only** (don't read the originals first; park `reconstructed.md` under
`/tmp/spec-cov-measure/<GROUP>/`), then score every atomic requirement into
structural / obligation-only / narrative / missed, and compute
`code_derivable_pct = round(100 * structural / (total_reqs − narrative))` and the `obligations`
count (target 0).

### 5. Decide + report
Compare to the prior run:
- **Closed** — `code_derivable_pct ≥ target` (default 90) AND `obligations == 0` AND every remaining
  miss is narrative: tell the user the group is **done** (there is no close PR to open locally; it's
  a local group). Report the baseline→final delta.
- **Gap remains** — emit a fresh **sanitized** `new-kind` request (same rules as measure step 4 —
  paraphrase, no doc paths, generic `motivating_group`) for the user to file on
  `truecourse-ai/truecourse` by hand. Report `code_derivable_pct` before→after and what's still missing.

## Hard rules
- **Local only, no external worker.** LLM work via the agent mailbox in **this session** — never
  `claude -p` / `--llm-transport cli`, never `npx truecourse`, never an API key.
- Sync + rebuild happen in `<TC_REPO>`; regeneration happens in-place at `<SPEC_PATH>` (only
  `.truecourse/` is written there). Measure bookkeeping lives under `/tmp/spec-cov-measure/<GROUP>/`.
- **Blind reverse is sacred** — reconstruct from contracts only, before reading the originals.
- Never push to git, never open a PR, never edit `kinds.yaml`/`groups.yaml`, never auto-file the
  `new-kind` issue. Commit nothing.
