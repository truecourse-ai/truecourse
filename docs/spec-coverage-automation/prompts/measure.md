# spec-coverage-measure — local procedure

Score how much of a local spec the engine captured **structurally (code-derivable)** by
blind-reversing it from the `.tc` contracts and comparing to the originals, then surface each
code-derivable gap as a **sanitized `new-kind` request** for the user to file on the public engine
repo. **Local** run — everything stays on the machine except the sanitized kind requests the user
chooses to file.

Invoked by `/spec-coverage-measure`. No GitHub trigger, no branch, no PR, no `groups.yaml`. You do
**not** run `spec scan` / `contracts generate` — the user already produced the contracts by hand,
in their terminal, with the truecourse CLI (default `cli` transport = parallel `claude -p` workers
— fast). The expected pre-step they ran in `<SPEC_PATH>` is:

```bash
node <TC_REPO>/dist/cli.mjs spec scan
node <TC_REPO>/dist/cli.mjs spec resolve --all-defaults
node <TC_REPO>/dist/cli.mjs contracts generate
node <TC_REPO>/dist/cli.mjs contracts validate
```

If `<SPEC_PATH>/.truecourse/contracts/` doesn't exist or is empty, tell them to run those four and
stop — don't try to generate anything in-session.

## Inputs

- **`<SPEC_PATH>`** — the folder the user ran the CLI generate sequence in. Contracts are at
  `<SPEC_PATH>/.truecourse/contracts/`.
- **`<GROUP>`** — short label for output.
- **`<TC_REPO>`** — local truecourse checkout (to read the live kind catalog).

Collect `<SPEC_PATH>` and `<GROUP>` in one question. Don't probe files before starting.

## Steps

### 1. Check prerequisites
Confirm `<SPEC_PATH>/.truecourse/contracts/` exists and is non-empty. If not, tell the user to run
the four CLI commands shown above first (in their terminal), and stop. Read the engine's current
kind catalog from `<TC_REPO>`
(`packages/contract-verifier/src/types/index.ts` `ArtifactKind` union + `kinds.yaml`) so you can tell
a live `structural` kind from a gap.

### 2. Blind-reverse the spec from the contracts ONLY
**Strict rule:** reconstruct the spec from the `.tc` contracts **only**. **Do NOT read the original
docs** (under `<SPEC_PATH>`) or the engine-emitted `specs/` while reconstructing — that defeats the
measurement. Read every `.tc` under `<SPEC_PATH>/.truecourse/contracts/`; each has a kind keyword, a
name, an `origin` (provenance only), and kind-specific structured fields. Write a Markdown
reconstruction to `/tmp/spec-cov-measure/<GROUP>/reconstructed.md` that states **everything the
contracts encode and nothing they don't**:
- Render anything that exists **only** as an `unenforceable-obligation` (prose in `spec-text`) in a
  clearly separate "Unenforceable obligations (prose only)" section — it is NOT structural.
- Invent nothing not in the contracts.

Keep this file under `/tmp` — never write it into `<SPEC_PATH>` or `<TC_REPO>`.

### 3. Score against the originals
Now (and only now) read the originals under `<SPEC_PATH>` — the docs the relevance filter kept
(those that produced claims in `.truecourse/specs/`), not the ones it dropped. Classify **every
atomic requirement** into exactly one bucket:
- **structural** — captured by a code-derivable kind that is **live** in the engine, recovered in
  your blind reconstruction from that artifact's structured fields. The only "covered" bucket.
- **obligation-only** — captured only as an `unenforceable-obligation`. Not covered; each distinct
  one increments `obligations` (target 0).
- **narrative** — pure prose with no plausible deterministic code signal (problem statements, user
  stories, UI copy, file paths, future-work, rationale). Correctly uncaptured; **excluded from the
  denominator**.
- **missed** — has a plausible deterministic code signal but no contract captured it.

Compute exactly:
- `total_reqs = structural + obligation_only + narrative + missed`
- **`code_derivable_pct = round( 100 * structural / (total_reqs − narrative) )`**
- **`obligations`** = count of distinct `unenforceable-obligation` artifacts (target 0).

Default target is 90%. Keep the per-requirement bucket assignment for the report (you may write it to
`/tmp/spec-cov-measure/<GROUP>/coverage.md`).

### 4. Emit a SANITIZED `new-kind` request per code-derivable gap
A **code-derivable gap** = `obligation-only` OR `missed` **AND** has a plausible deterministic code
signal (guard/throw, `??`/`if x is None` default, ORM `select`/projection, column-vs-JSON choice,
feature-flag read, rate-limit constant, …) **AND** is **general** (cross-feature/framework — no
domain vocabulary). Collapse same-shape gaps into one. Pure-narrative requirements are NOT gaps — no
request, no obligation.

For each gap, produce a YAML body the user can paste into a `[new-kind]` issue on
**`truecourse-ai/truecourse`** (labels `new-kind`, `spec-kind-target:<kind>`). **Do NOT file it
automatically** — print it and let the user file it (or file via `gh` only if they explicitly
approve). **Sanitization is mandatory** (the public repo must never receive private spec content):
- **Paraphrase** the requirement shape; never paste verbatim spec text.
- **No private filenames, paths, section titles, or line ranges.**
- `motivating_group` gets a **generic** label (`internal-app`, `agent-orchestrator`, …) — never the
  real group name if it reveals the project.
- `proposed_tc_shape` / `code_signal` / `fixture_plan` describe the **general kind**, not your data —
  keep them, just leak no specifics.

```
kind: <proposed .tc keyword — general, no domain vocabulary>
motivating_group: <generic-label>
requirement_class: <one-line general requirement shape>
proposed_tc_shape: |
  <kind> <Name> { <proposed structured fields — target/when/effect/via/…> }
code_signal: <how a deterministic cross-language (JS+Python) extractor derives it from code>
fixture_plan: <what JS+Python sample-IL code + .tc would prove the extractor>
status: proposed
```

If unsure a gap clears the generality / code-signal bar, don't emit a request — list it as a
`borderline:` note for the user to judge.

### 5. Report
Print:
- `code_derivable_pct` (with the absolute counts), `obligations` (target 0), and any borderline calls.
- The list of sanitized `new-kind` request bodies, ready to file on public.
- Where the reconstruction + coverage audit live (`/tmp/spec-cov-measure/<GROUP>/`).
- Next step: once a kind merges on public, run **`/spec-coverage-remeasure`** to re-score.

## Hard rules
- **Blind reverse is sacred** — never read the originals (or `specs/`) until step 3, after
  `reconstructed.md` is written.
- Never write into `<SPEC_PATH>` (beyond what generate already wrote) or `<TC_REPO>`; measure
  bookkeeping lives in `/tmp/spec-cov-measure/<GROUP>/`.
- Never auto-file the issue; never push to git; never open a PR; never edit `kinds.yaml` locally
  (that's the public engine's job).
- Sanitize every issue body: paraphrase, no doc paths, no project-revealing group names.
- `code_derivable_pct = structural / (total_reqs − narrative)`; `obligations` target 0; pure
  narrative is never a gap, never an obligation, never a kind.
