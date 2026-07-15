# Guard grounding fix plan (PR 1b)

Follow-up to SPEC_GUARD_PLAN item 35. Diagnosed on `spiderhands/expense-cli` (real run
data + a probe-layer harness against the cloned app): retry now SEES the usage error
(`error: unexpected argument 'food' (run 'xpn add --help')`) but still can't fix the
invocation because grounding never captured `add --help`. Two gaps, one noise issue.

**Root causes confirmed:**
- Expansion filter too strict: `<token> --help` probed only when token appears in the
  BATCH'S CLAIM TEXTS. Claims describe behavior ("Expense amount of 0 cents causes exit
  code 3") without naming the command the model must invoke → no `add --help` for the
  calculation/requirements batch. The command is the MODEL's choice, not the claim's
  vocabulary.
- `programNamesOf` only knows the entry argv (`node`, `cli.js`, `cli`, `truecourse`).
  The tool's real name `xpn` (package.json `name`/`bin`) is unknown → spec fragments
  `` `xpn add ...` `` probe as literal unknown-command `xpn` instead of stripping to a
  salvageable `add ...`.
- 5/10 captured transcripts are unknown-command garbage fed to the prompt.

NOT in scope (base-branch design, raise separately): doc-first birth failures + fidelity
review call volume (the ~10× time, +139 fidelity calls), holds-back policy zeroing
committed scenarios when every section carries a finding, EE birth evidence (PR 2).

## Fix A — probe every listed subcommand's `--help`

`deriveExpansionProbes` (ground.ts): candidates no longer gated on claim texts.

- Extract subcommand candidates from bare/`--help` transcripts:
  1. first token of each INDENTED line (commander/custom help style: `  add   Record…`)
  2. brace-list entries `{add,list,…}` (argparse style)
  3. (existing) any EXPANSION_TOKEN token that appears word-boundary in claim texts
- All must match `EXPANSION_TOKEN`, minus program names + already-probed heads.
- Priority when over budget: (1∩3) line-leaders also named in claims → (1) line-leaders
  → (2) brace entries → (3) claim-text tokens. Cap unchanged (10 total).
- xpn outcome: bare + `--help` + 6 command helps = 8 probes, every batch grounded.

## Fix B — programNamesOf learns the package's real names

- `groundProbes` reads repo-root `package.json` once (name w/o scope + all `bin` keys),
  passes the extra names into derivation; `deriveStaticProbes`/`deriveExpansionProbes`
  gain an optional `extraProgramNames` param (pure, unit-testable).
- Effect: `` `xpn add 12.50 --category food` `` → strips `xpn` → salvages `add --help`;
  `` `xpn --version` `` → exact `--version` probe; garbage `xpn`-head probes disappear.
- Non-node repos: no package.json → no extra names (unchanged behavior).

## Fix C — drop unknown-command transcripts from the prompt (optional)

- Only for AUTO-derived expansion probes (never user-quoted fragments): drop a captured
  transcript from the prompt when exit != 0 AND output lacks `usage` (case-insensitive).
  Slots stay spent; prompt stays clean. Cheap heuristic, contained blast radius.

## Tests (TDD, tests/guard-generator/ground-probes.test.ts + fixtures)

- line-leader + brace-list extraction; claim-filter demoted to priority-only
  (regression: batch whose claims never say "add" still probes `add --help`)
- package-name stripping (fixture package.json with `bin: {xpn: …}`): `xpn add` fragment
  → salvage; `xpn` alone → bare
- priority/cap with the new candidate classes; Fix C transcript filtering
- generate.test.ts grounding-progress expectations updated if probe counts shift

## Validation

- Re-run scratchpad probe-loop harness against the cloned expense-cli with the real
  claim texts (no "add" in claims) → expect `add --help` + `split --help` transcripts,
  zero unknown-command noise, <200ms.
- User re-runs EE generate on spiderhands/expense-cli → findings' invocations should
  use `--category`; invocation-defect findings drop (doc-vs-code findings remain, by
  design of the base branch).

## Unresolved questions

1. Fix C in or out? (recommend in — small, contained)
2. Claim-text match kept as priority boost only — agreed? (recommend yes)
3. Scoped package names: `@scope/xpn` → also add `xpn`? (recommend yes)
4. Land as a new commit on `sm/spec-guards-ee` (amending PR 1's scope), same
   TDD-subagent → code-review → fix workflow? (recommend yes)
5. Raise doc-first/fidelity cost + holds-back-zeroing with the base-branch authors —
   who/where? (out of my hands, needs your call)
