# Reference corpus → store schemas: the gap list

What this is: the discovery output of transforming `reference/**` (the hand-authored
benchmark) into the engine's real store schemas. The transformed copy lives in
`reference/store/**` and is placed into the live store paths, so the dashboard renders
the reference as real data.

Every item below is something the authored reference states and the current schemas
cannot carry. Each is a plan addition for the workstream named on it. Nothing here is a
transform bug: every produced file parses against the repo's own Zod schemas and the
real `loadScenarios` loader.

The pre-transform drafts are gone (the store files are the reference's single
representation). Everything they authored and the schemas could not carry is quoted
verbatim in the appendix at the end of this file — the concrete instances behind each
gap id.

## What the transform produced

| store file | fed by | carried |
|---|---|---|
| `.truecourse/specs/corpus.json` | `reference/spec-docs/**` | 6 docs, 1 area, 0 claims (no field) |
| `.truecourse/scenarios/claims.json` | `reference/code-analysis/claims.yaml` | 120 claims, 37 untestable statements — every authored leaf |
| `.truecourse/scenarios/flows.json` | `reference/code-analysis/flows.yaml` | 17 flows, 106 milestones, 14 `noFlowClaims` |
| `.truecourse/scenarios/manifest.json` | flows + scenarios | 17 flow entries, 1 cli scenario each |
| `.truecourse/scenarios/truecourse-code-analysis/*.yaml` | `reference/code-analysis/scenarios/*.yaml` | 17 scenarios, 102 of 170 steps, 49 of 106 milestone tags |
| `.truecourse/scenarios/decisions.json` | (nothing authored) | empty, valid |
| `.truecourse/scenarios/recipe.json` | (nothing authored) | invented minimum: `build` + `entry` |
| `.truecourse/guard/journeys.json` | `reference/journeys/*.yaml` (deleted) | 6 journeys, 16 commands, the FULL contract — 58 grammar entries, 3 positionals, every io promise, 28 diagnostics |

---

## A. Layers with no store home at all

### G1. Claims (120) have nowhere to live — CLOSED (store + view)
**What:** every authored claim (`id`, `doc`, `anchor`, `title`, the verbatim claim
sentence, `verify-via`, `needs[]`, `notes`) was dropped. The claim is the unit of meaning
and of coverage accounting in plan §2, and the store had no representation of it.
**Where it lived:** `CuratedCorpusSchema` v3 (`packages/spec-consolidator/src/corpus-types.ts`)
holds docs plus area tags and explicitly "never disassembles a doc into claims";
`GuardFlowMilestoneSchema` keeps only a `claimTitle` string, and only for claims a flow
actually carries.
**What the store carries now:** `.truecourse/scenarios/claims.json`
(`GuardClaimsFileSchema`, `packages/shared/src/guard/claims.ts`) — committable, next to the
flow corpus, and part of `walkScenarioRelFiles` so it travels through the store seam. Per
claim: `id`, `doc`, `anchor`, `title`, the verbatim `claim` sentence, `verifyVia`,
`needs[]`, `notes`, plus a `contentHash` — `sha256` over the claim's own doc, anchor, title
and sentence (never the section fingerprint, which would roll every sibling claim on any
edit), so a doc edit invalidates exactly the claims whose content changed.
**Cross-checks:** `crossCheckClaimRefs` (`packages/guard-runner/src/claim-refs.ts`) resolves
every scenario step's milestone-id tag, every flow milestone identity and every
`noFlowClaims` entry against the store and reports a dangling one through `loadScenarios`'s
own `errors` feed — loud at load time, never a silently smaller denominator.
**View:** the Guard Claims tab renders the store, grouped by doc and section, with the trace
plan §8.2 asks for in both directions (claim → its doc section, claim → the flows that
carry it → the scenario steps that prove it) and per-claim coverage state.
**Still open:** nothing PRODUCES the store — the extract stage does not write claims yet, so
the reference carries the only claim corpus in the store today.
**Owner:** Spec Scan / Guard Generate (write it from extraction).

### G2. Untestable doc statements (37) have nowhere to live — CLOSED (store + view)
**What:** the reference records every behavioral sentence that deliberately did NOT become
a claim, with its reason (`doc`, `anchor`, `text`, `reason`). This is the honesty half of
extraction: what the scan looked at and consciously refused.
**What the store carries now:** `GuardClaimsFile.untestable[]` — the same four fields, in
the same file as the claims, because the two halves are one extraction record.
`flows.json.noFlowClaims` still means something different and stays: a claim that EXISTS and
reached no flow.
**View:** rendered under each doc in the Claims tab, visually separated, with its reason.
**Still open:** nothing produces it (same as G1).
**Owner:** Spec Scan.

### G3. Claim dependency vocabulary (`needs[]`) has nowhere to live — STORED, not consumed
**What:** each claim declares what the world must provide before it can be proven:
`none`, `supplied-project`, `git-repo`, `dirty-tree`, `committed-baseline`,
`llm-transport`, `dotnet-sdk`, `claude-code-binary`.
**What the store carries now:** `GuardClaim.needs[]`, deliberately an OPEN string list
rather than an enum — the dependency catalog grows per repository, and a claim naming a
noun this build has never seen must still store and still block loudly rather than fail to
parse. The reference vocabulary is documented on the schema.
**Still open:** nothing CONSUMES it. Nothing between the claim and the sandbox turns a
`needs` entry into a binding or a block; that is the dependency catalog's job.
**Owner:** Guard Setup (this is the input to journey completeness and to blocking).

### G4. The journey contract is ~95% unrepresentable — CLOSED (store + view)
**What:** the authored journeys are the full public contract of the CLI. Across the 6
journeys and 16 commands: 58 grammar entries (each with `takes-value`, `value-required`,
`default`, `scope`, `description`, and 5 with `choices`; 9 take values), 3 positionals,
11 stdin prompts with their trigger conditions, 31 read paths, 48 stdout promises,
31 written paths, 35 exit codes with meanings, 11 environment variables, 7 behavior notes,
and per-journey `shared` blocks (git resolution rules, the `hooks.yaml` key set).
**What the store carried:** `JourneySchema` kept `id`, `type`, `title`, `entry`, and steps
of kind `invoke` with `command` + `flags` + an optional `label`. Flags were bare tokens: 58
grammar entries collapsed to 90 flag strings with no requiredness, value type, choices, or
description, and everything under `io` was dropped.
**What the store carries now:** `Journey.contract` (`packages/shared/src/journeys.ts`) —
per command: `options[]` (flag, short, takesValue, valueRequired, valueHint, choices,
default, scope, hidden, description), `positionals[]`, `subcommands[]`, `io.consumes`
(stdin prompts, reads, environment) and `io.produces` (stdout, stderr, writes, exitCodes,
sideEffects), `notes[]`, plus a journey-level `shared` block and `decisions[]`. Additive
and optional: a catalog with only the command tree still parses, and none of it enters
`journeyFingerprint`, so the growth rolls no identity. The dashboard's Journeys tab renders
all of it (`GuardJourneyContract`).
**Still open:** the MAPPER does not derive any of it yet — the reference carries the only
contract in the store today.
**Owner:** Guard Setup (journey mapper).

### G5. Journey diagnostics (28) have nowhere to live — CLOSED (store + view)
**What:** each journey records doc-versus-code findings with a verdict: 13
`docs-missing-behavior`, 5 `grammar-agreement`, 3 `docs-missing-detail`, plus
`choices-not-in-grammar`, `docs-missing-command`, `docs-missing-flag-detail`,
`docs-overstated-behavior`, `docs-vs-code-detail`, `docs-wording-vs-code`,
`reference-narrows-code`, each with `subject`, `detail` and `right: code | docs | both`.
This is exactly the "journey defect" feedback loop plan §2 asks for.
**Where they live now:** `Journey.diagnostics[]` (`{kind, subject, detail, right?}`), with
`kind` deliberately an open label so the mapper's own tree-versus-probe kinds land in the
same feed. Rendered as the Journeys tab's findings list, agreements included.
**Still open:** nothing PRODUCES them — `journey-drift.ts` still compares fingerprints only.
**Owner:** Guard Setup (produce them), Guard Generate (consume them).

---

## B. Detail dropped, per store file

### `.truecourse/scenarios/flows.json` (`GuardFlowsFileSchema`, `GuardFlowSchema`)

**G6. Flow `kind` is dropped (17 flows: 7 happy, 7 edge, 3 variant).**
The reference uses `kind` to demonstrate the §8.2 coverage rules (not only the happy path;
error, boundary and empty-state paths are their own flows). `GuardFlowSchema` has no
classification field, so "does this corpus cover edge paths at all" is unanswerable from
the store.
Owner: Guard Generate, plus dashboard view work (flow list badge/filter).

**G7. Flow `variant-of` is dropped (3 flows).**
Each variant names the base flow whose configuration path it varies (LLM transport
claude-code vs api, hook policy `llm: false` vs `true`). `composedOf` exists but means the
opposite relation (an epic chaining sub-flows), so the variant link cannot be stored
without lying about it.
Owner: Guard Generate.

**G8. Flow `starting-state` is dropped entirely (17 flows, 3 classes each).**
The authored classes are plan §7.2's: `step-creatable` (state the public surface itself
creates, preferred, never seeded), `seedable` (deterministically materialized before the
steps), `supplied` (real-world input the engine must NEVER fabricate: `analysis-target`,
`claude-code-cli`, `llm-api-credentials`, `dotnet-sdk`). The `supplied` class is
load-bearing: an unregistered instance must make that flow BLOCK loudly while the others
still run. No flow field expresses any of this.
Owner: Guard Setup (dependency registry + blocking), Guard Generate (emit the classes),
dashboard view work (a blocked-flow state with a CTA).

**G9. Per-flow authoring `notes` are dropped (17).**
Each flow carries the rationale for its shape, what a milestone honestly proves, and the
journey gaps found while authoring it (for example: `hooks run` prints no LLM usage line,
so "spends tokens per commit" is not observable). No rationale field exists.
Owner: Guard Generate.

**G10. The claim itself cannot ride a milestone.**
`GuardFlowMilestoneSchema` carries `doc` + `anchor` + `claimTitle` + `note`. The claim
SENTENCE, its `verify-via` and its `needs[]` have no field. The transform parks the
verbatim sentence in `note` (a free-text synthesis field) as the least-lossy home
available: the field is being used for data it was not designed for.
Owner: Spec Scan (claims store), Guard Generate (milestone schema).

**G11. `goal` is a required field the reference does not author.**
`GuardFlowSchema.goal` is mandatory; the reference authors one title sentence per flow, so
the transform duplicates the title into `goal`. Either the schema should allow the title
to stand alone, or synthesis must be defined to produce two distinct sentences.
Owner: Guard Generate.

**G12. The coverage ledger is unrepresentable.**
The reference states `claims-total: 120`, `carried-by-flows: 106`, `gapped: 14`,
`by-kind: {happy: 7, edge: 7, variant: 3}`, and the hand-verified invariant "every claim id
appears exactly once across flows or gaps". `noFlowClaims` carries the 14 gapped claims
with their reasons (this part survives), but with no claim inventory (G1) the totals and
the exactly-once invariant cannot be checked by the engine.
Owner: Spec Scan + Guard Generate.

**G13. The 11 `authored-decisions` have no store home.**
They are the runner capabilities the benchmark implies (mid-scenario file mutation,
per-step `cwd`/`tty`/`env`, git steps, seed/value interpolation, hermetic HOME,
lookahead-regex negatives). They are plan input rather than data, but they must not be
lost: items G14 through G24 below are their consequences.
Owner: Guard Generate (plan text).

### `.truecourse/scenarios/truecourse-code-analysis/*.yaml` (`GuardCliScenarioSchema`)

68 of 170 authored steps (40%) could not be written at all, and 57 of the 106 carried
claims lost their milestone tag.

**G14. `git:` steps are unrepresentable (46 steps, 18 milestones lost).**
A cli step is `run`: argv APPENDED TO THE RECIPE ENTRYPOINT, so it can only invoke the
program under test. The reference needs `git` because the docs' own claims are stated in
git terms (`git check-ignore`, `git add .truecourse/LATEST.json`, `git commit --no-verify`,
`git worktree add`) and because the pre-commit hook's only trigger IS `git commit`. Four
scenarios lose most of their proof: `install-the-pre-commit-hook-and-enforce-it` (20 steps
to 6), `retune-the-hook-policy-in-hooks-yaml` (19 to 3), `commit-a-baseline-and-refresh-it`
(9 to 2), `work-from-a-fresh-worktree-and-clone` (10 to 3).
Owner: Guard Generate (step vocabulary) + the runner's executor.

**G15. `write:` / `delete:` steps are unrepresentable (20 + 2 steps).**
`setup.files` seeds only BEFORE the first step. About a third of the claims are about what
changes BETWEEN two runs (new and resolved violations, a rule disabled then re-run, a
policy file edited then deleted), which setup-time seeding cannot express.
Owner: Guard Generate + runner.

**G16. Per-step `cwd` is unrepresentable (12 occurrences, 6 on surviving run steps).**
The reference drives a second repository (`other-repo`), a linked worktree (`feat-x`) and a
fresh clone. Every step runs in the sandbox root today, so
`rule-configuration-is-per-repository` and the whole worktree/clone flow cannot be walked.
Owner: Guard Generate + runner.

**G17. Per-step `tty: true` is unrepresentable (6 steps).**
The stash prompt and the hook-install confirmation only EXIST on a TTY; with piped stdin
those commands exit 1 instead of asking. Without a pseudo-TTY the interactive half of the
CLI is unassertable (and `stdin` alone does not substitute).
Owner: Guard Generate + runner.

**G18. A step can carry only ONE milestone (39 claim ids lost).**
`milestone` is a single number. The reference tags one observation with several claim ids
whenever two docs restate the same behavior (the three dirty-tree flags, the two
"new and resolved" diff sentences, the category claims proved by one `list` run). Claim
identity is doc-anchored, so both ids must be tagged; inventing a second weaker observation
per claim would be assertion theater.
Owner: Guard Generate (schema: `milestone` as an array).

**G19. `milestone` is a POSITION, not an identity.**
It is the flow milestone's 1-based `order`, so renumbering or reordering a flow silently
re-points every step in every scenario to a different claim. The reference tags by claim id.
Owner: Guard Generate.

**G20. Per-step `note` is dropped (76 notes).**
Each note explains why the assertion is the falsifiable form of the claim (for example: why
`git check-ignore`'s exit code is the honest test of "these files are committable"). This is
the reviewable substance of an authored scenario and there is no field for it.
Owner: Guard Generate, plus dashboard view work (the step list renders command + expectation
only).

**G21. `expect.output` (stdout and stderr combined) is unrepresentable (3 assertions).**
Used where no journey pins which stream carries the text (the per-file skip warning, the
missing-Roslyn-host error). Asserting one stream would encode a guess, so the transform
dropped the matcher and kept the exit code.
Owner: Guard Generate (matcher set).

**G22. `setup.seeds.git.identity` is dropped (15 scenarios).**
Commits inside a sandbox need a `user.name`/`user.email` that is NOT the developer's.
`GuardGitSchema` has `commits`, `staged` and `branch` only. (The runner pins author and
committer internally, but the scenario cannot state it, so a reader cannot see that the
developer's identity is never used.)
Owner: Guard Generate (schema) or Guard Setup (documented runner guarantee).

**G23. `setup.seeds.git.root` is dropped (1 scenario).**
The repo lives in a subdirectory when a flow needs siblings (a worktree, a clone, a second
repo). Without it the commit file lists in
`work-from-a-fresh-worktree-and-clone.cli.1.yaml` are written relative to a root the store
cannot name, so they are carried verbatim and would not resolve.
Owner: Guard Generate + runner.

**G24. `setup.supplied` is dropped (3 scenarios, 5 dependencies).**
Each entry names a real-world dependency, what it is, how it is bound
(`copied into the sandbox`, `put on PATH`, `injected as env`) and
`blocks-when-unregistered: true`. There is no scenario-level way to declare a supplied
dependency, so a run either silently uses whatever is on the machine or fails for the wrong
reason. Note `setup.externals` exists but models HTTP third parties for the api driver, not
cli-side instances.
Owner: Guard Setup (registry + binding), Guard Generate (schema), dashboard view work
(a "provide this" surface like External APIs).

**G25. `${sandbox}` (18 uses) and `${supplied:<name>.<field>}` (2 uses) do not interpolate.**
The runner substitutes `${unique}` and `${HTTP_STUB:<name>}` only. Every scenario points
`TRUECOURSE_HOME` at `${sandbox}/home` so runs never mutate the developer's real registry;
that value is currently a literal string.
Owner: Guard Generate + runner.

### `.truecourse/scenarios/manifest.json` (`GuardManifestSchema`)

**G26. A scenario cannot be recorded as "never executed".**
`GuardManifestScenario.status` is `passing | failing` and defaults to `passing`, so a
hand-authored corpus that has never run reads as green. The transform omits the field,
which means the same thing. There is no third state.
Owner: Guard Generate, plus dashboard view work (the Tests tab shows a green inventory).

### `.truecourse/specs/corpus.json` (`CuratedCorpusSchema` v3)

**G27. A claim in a doc's LEAD PARAGRAPH cannot be bound (5 anchors, 6 of 17 scenarios
read `stale`).**
`deriveSections` (`packages/guard-runner/src/section-index.ts`) derives sections from ATX
headings only. The reference's spec docs are Mintlify pages whose title lives in
frontmatter, so the opening paragraph (which states, for example, "`truecourse analyze`
runs static and LLM analysis over your repository and stores the results as plain JSON
under `.truecourse/`") belongs to no section. The reference anchors those claims to the doc
title ("Overview", "Rules", "Git hooks", "Baselines & diff", "Excluding files"); the
transform binds them to the slug of that title with the fingerprint of the preamble text,
which resolves as `orphaned` against the live index and marks 6 scenarios `stale`. That
staleness in the dashboard IS this gap.
**Fix shape:** derive a preamble section (a doc-lead pseudo-section with a stable anchor and
its own fingerprint), which also gives `OverlapSectionSchema.heading: null` (the existing
preamble marker on the spec side) a counterpart on the guard side.
Owner: Spec Scan and Guard Generate (shared section derivation), and it changes every
binding surface.

**G28. Per-doc ROLE is unrepresentable.**
`reference/spec-docs/reference/cli.mdx` is the journey cross-check source (no claim is
anchored to it); the other five are claim sources. `CorpusDocSchema.kind` is a coarse enum
(`prd | adr | rfc | spec | runbook | design-note | readme | openapi | unknown`) and says
nothing about role.
Owner: Spec Scan.

**G29. The area axis is forced.**
The reference authors one area, `code-analysis`. Corpus areas are a mandatory two-level
`product/concern` pair, so it is stored as `truecourse/code-analysis`, inventing a product
axis. A single-product repo has to pick a product name it never chose.
Owner: Spec Scan.

### `.truecourse/scenarios/recipe.json` (`RecipeSchema`)

**G30. The reference has no recipe layer, and the recipe cannot state a PATH name.**
`build` and `entry` here were invented for the transform (the reference authors claims,
flows, journeys and scenarios only, per plan §4). More importantly the reference records a
runtime fact the recipe cannot express: the installed pre-commit hook shells
`npx -y truecourse hooks run`, so the CLI under test must be resolvable as `truecourse` on
the sandbox PATH. Without that, the hook steps fail for a reason unrelated to their claims.
Owner: Guard Setup.

### `.truecourse/guard/journeys.json` (`JourneysFileSchema`)

**G31. The journey catalog is derived and gitignored, but the reference's journeys are
authored and must survive.**
`journeys.json` is re-derived from the working tree and gitignored by convention (only the
fingerprints embedded in scenarios travel). The reference's journeys are hand-authored
source that must outlive any regeneration. The durable copy is now
`reference/store/.truecourse/guard/journeys.json` — the store schema itself, read by every
engine surface, copied into the live store like every other reference file. (The authored
`reference/journeys/*.yaml` drafts are gone: the contract fields carry all 977 authored
leaves, so the one-representation rule applies.)
Owner: Guard Setup.

---

## C. Found while mapping the stores (not from the reference)

**G32. `flows.json` is missing from the scenario-corpus membership rule — CLOSED.**
`walkScenarioRelFiles` (`packages/guard-runner/src/scenario-loader.ts`) enumerated
`*.yaml`/`*.yml` at any depth plus top-level `recipe.json` and `manifest.json`, but NOT
`flows.json`, which `readGuardFlowsFile` reads through the same store seam. In OSS the file
store resolves any path under `scenariosDir`, so nothing broke; any store that snapshots by
`walkScenarioRelFiles` would silently lose the flow corpus and degrade every flow to a
manifest-derived, id-titled row. `SCENARIO_ROOT_FILES` now reads
`['recipe.json', 'manifest.json', 'flows.json', 'claims.json']` — the claim corpus joined on
the same rule and for the same reason.
Owner: Guard Generate.

**G33. Section derivation cannot see a doc's lead — CLOSED.**
`deriveSections` (`packages/guard-runner/src/section-index.ts`) read ATX headings only, so
everything before a doc's first `##` — frontmatter plus the substantive lead text published
docs open with — belonged to no section and could not be bound. All five reference docs
carry their title in frontmatter, so every one of them had an unbindable lead: 6 of the 17
reference scenarios resolved `stale` on binds nothing could match. The lead region is now a
section of its own, named by the frontmatter title (its filename when it declares none),
fingerprinted over the lead text alone. Strictly additive: a doc that opens directly with a
heading still gets no lead section, and the lead claims its anchor AFTER every heading has
taken its own, so no heading-derived anchor moves. Plan §6.2's "section identity must survive
real docs".
Owner: Spec Scan.

**G34. A `tty` step cannot answer a SELECT prompt (2 scenarios, 3 steps) — CLOSED.**
`executeTtyStep` (`packages/guard-runner/src/pty.ts`) writes the whole scripted `stdin` once,
synchronously at spawn — before the child has enabled raw mode. The line discipline is still
canonical with `ICRNL`, so the Enter keystroke a select prompt needs (`\r`, which Node's
keypress parser reports as `return`) is folded into a newline and delivered as `enter`.
`@clack/core`'s `Prompt.onKeypress` submits only on `return`, so a select prompt is never
answered and the step dies on the 30s step timeout. Only prompts that submit on a PRINTABLE
character survive — clack's `confirm` fires on `y`/`n` — which is exactly why every hook
flow's TTY step passes and every select-driven step hangs.
Proven 2026-08-07: the identical `"\r"` written to the identical pty two seconds later (after
the prompt is up) submits and the command exits 0.
Consequence for the corpus: `answer-the-first-run-llm-transport-question.cli.1` (the whole
flow) and `analyze-a-dirty-working-tree.cli.1` step 3 were unreachable, and with them the
first-run wizard claims and the dirty-tree prompt claim. The scenarios kept `"\r"` — the
correct scripted key — and turned green unedited the moment the delivery was fixed.
**As built:** the script is split into one answer per submit key and each is TYPED on its own
turn — after the child has printed something and then gone silent — with a retype when the
terminal echoes the answer back (proof it was still canonical, so Enter was never pressed);
both scenarios pass, and the answer now arrives as KEYS, arrow sequences included.
Owner: Guard Generate (runner).

**G35. `expect.files` cannot assert a DIRECTORY (2 scenarios) — CLOSED.**
`matchFile` (`packages/guard-runner/src/expect.ts`) computes
`fs.existsSync(target) && fs.statSync(target).isFile()`, so a directory is always reported
missing and `exists: true` on one can never pass — silently, with a message ("… missing")
that reads like a product failure. `GuardFileMatcherSchema` documents itself as "presence or
content of a PATH", so the schema promises more than the evaluator delivers. The reference hit
it on `.truecourse/` and `.truecourse/analyses/`; both were re-anchored onto the `.gitignore`
the store seeds, which is the idiom the rest of the corpus already uses. That workaround does
not generalize: a directory whose only contents are nondeterministically named (the per-run
snapshot `<iso>_<8-hex>.json`) has nothing a scenario can name.
**As built:** `exists`/`absent` are now about the PATH, so a directory satisfies them, while
`equals`/`contains` stay file-only and fail a directory saying it has no content to check; the
two re-anchored steps are back on the natural `.truecourse` / `.truecourse/analyses` assertions.
Owner: Guard Generate (runner).

**G36. `expect.files` carries ONE substring per path per step, and no regex (1 scenario,
3 steps) — OPEN.**
`GuardFileMatcherSchema` (`packages/shared/src/guard/scenario.ts`) is
`exists | absent | equals | contains`, and `expect.files` is a record keyed by path, so a
step can make exactly one content assertion about a given file. There is no `matches`
(regex) member and no list form. A claim whose evidence is SEVERAL substrings of one
artifact therefore cannot be proved in one step. The reference hit it re-authoring
`analyze-a-repository-for-the-first-time` onto the supplied project: the two language
claims ("JavaScript and TypeScript are supported", "Python is supported") are read off the
module paths `.truecourse/LATEST.json` records, which needs three separate `contains`
assertions (`.ts"`, `.js"`, `.py"`) on the same file — so they had to be spread across the
flow's three steps, one per step, with the third landing on a step whose own subject is the
LLM transport. It is honest (the aborted run leaves the snapshot untouched, and the note
says so) but it is placement forced by the matcher, not by the claim. A `matches` member —
the same regex form the stream matchers already have — would let one step state the whole
observation.
Owner: Guard Generate (runner).

---

## D. Index by owning workstream

| workstream | items |
|---|---|
| Spec Scan | G10, G12, G27, G28, G29 — G1 + G2 (claims store) and G33 (lead section) done, both awaiting a PRODUCER |
| Guard Setup | G3 (stored, not consumed), G4, G5, G8, G22, G24, G30, G31 |
| Guard Generate | G5, G6, G7, G8, G9, G10, G11, G12, G13, G14, G15, G16, G17, G18, G19, G20, G21, G22, G23, G24, G25, G26, G27 — G34 (tty answer delivery) and G35 (directory assertions) done in the runner; G36 (file matcher has one substring per path, no regex) open |
| dashboard view work | G6 (kind badge), G8 + G24 (blocked/supplied surface), G20 (step notes), G26 (never-run state) — G1 + G2 (claims view), G4 + G5 (journeys view) done |

---

# Appendix: dropped authored content, preserved verbatim

The hand-authored drafts (`reference/code-analysis/claims.yaml`,
`reference/code-analysis/flows.yaml` and `reference/code-analysis/scenarios/*.yaml`) were
transformed into the store schemas under `reference/store/**` and then deleted: the store
files are the single representation of the reference. What follows is the EVIDENCE half of
the gap list above — every authored fragment the schemas could not carry, quoted verbatim
from the deleted drafts, so each gap has its concrete instances attached.

`claims.yaml` transformed with ZERO loss: 1253 of 1253 authored leaves carried into
`scenarios/claims.json` (120 claims × their fields, 37 untestable entries × 4, every `needs`
element). Its two header keys are DERIVED rather than dropped, and the transform verified
both: `area: code-analysis` is the concern of the one area `specs/corpus.json` tags all five
docs with (`truecourse/code-analysis`), and the `docs:` list is exactly the distinct `doc`
set of the claims themselves. Only its header COMMENT has no schema home, so it is preserved
below.

This is not a second copy of the reference. Everything the store DOES carry (seeded files,
env, git commits, argv, `expect` matchers, stdin, per-step env, flow titles, milestone
doc/anchor/claimTitle/note, gap reasons, journey paths) is deliberately absent here — read it
from `reference/store/**`. Fragment indentation is the draft's own.

A0 is the `claims.yaml` header; A1–A5 are the corpus-wide fragments from `flows.yaml`; A6 is
one subsection per flow/scenario pair; A7 tallies what is preserved here, by category and
gap id.

## A0. `claims.yaml` header — the claim contract and the `needs` vocabulary (G1, G3)

The authoring rules the file states, and the dependency nouns its `needs[]` values come
from. The rules are now the claims schema's own docblock; the vocabulary is documented on
`GuardClaimNeedSchema`, which stays an open string list so a repository can name a
dependency this build has never seen.

```yaml
# Reference corpus — hand-authored claims for the "code-analysis" area.
#
# Identity of a claim = doc + anchor + title. Every behavioral statement in the
# five snapshots below is either a claim here or an entry under `untestable`.
#
# `needs` vocabulary as used in this file:
#   none              — a plain sandbox directory is enough (config-only commands)
#   supplied-project  — a real codebase to analyze, bound (never fabricated) per plan §8.2
#   git-repo          — the project must be a git repository with at least one commit
#   dirty-tree        — uncommitted changes must be present
#   committed-baseline— .truecourse/LATEST.json must be committed in the repo
#   llm-transport     — a configured LLM transport (claude-code or api)
#   dotnet-sdk        — the .NET 8 SDK plus the built Roslyn host
#   claude-code-binary— the Claude Code CLI must be installed
```

## A1. `flows.yaml` header — the authoring contract for the whole corpus (G6, G8)

States the coverage rules the `kind` field encodes and the three dependency classes
`starting-state` encodes. Nothing in `GuardFlowsFileSchema` carries either.

```yaml
# Reference corpus — hand-authored FLOWS for the "code-analysis" area.
#
# A flow is an ordered grouping of claims (a user journey): WHAT to verify.
# Its claims are the milestones the matching scenario must prove, in step order.
# Every claim id in claims.yaml appears exactly once across `flows[].claims`
# or `gaps[]` — see `coverage` at the bottom of this file.
#
# Coverage rules applied (AGENTIC_PIPELINE_PLAN §8.2):
#   - not only the happy path: error paths, invalid input, boundary values and
#     empty/conflicting state get their own flows (kind: edge);
#   - every configuration path: where the program offers alternative modes for
#     one capability (LLM transport cli vs api, hook policy llm false vs true),
#     each supported path is its own flow (kind: variant) binding its own
#     dependencies, so one path can block while the other runs;
#   - no two flows walk the same path; richer flows are preferred over more,
#     but never at the cost of leaving a claim uncarried.
#
# Dependency classes are those of plan §7.2:
#   step-creatable — state the public surface itself creates (add, analyze,
#                    rules, hooks install). Preferred; never seeded.
#   seedable       — state materialized deterministically before the steps
#                    (source files, git history, ignore files, env, the
#                    transport config file). Travels with the scenario.
#   supplied       — real-world input the engine must NEVER fabricate. Named
#                    here, resolved from the user's registered instances at run
#                    time; unregistered ⇒ the flow blocks, loudly.
```

## A2. `area` (G29)

The reference authors a single-level area; the corpus schema forces a `product/concern` pair,
so it is stored as `truecourse/code-analysis` — a product axis the reference never chose.

```yaml
area: code-analysis
```

## A3. The coverage ledger (G12)

`noFlowClaims` carries the 14 gapped claims and their reasons; the totals, the per-kind split
and the hand-verified exactly-once invariant have no field.

```yaml
coverage:
  claims-total: 120
  carried-by-flows: 106
  gapped: 14
  flows: 17
  by-kind: { happy: 7, edge: 7, variant: 3 }
  check: >-
    verified by hand against claims.yaml in file order: every claim id appears
    exactly once, either in one flow's `claims` list or in `gaps`. No id appears
    in two flows; no id appears both in a flow and in a gap.
```

## A4. `authored-decisions` — the runner capabilities the benchmark implies (G13)

Plan input rather than data: items G14–G25 are these decisions' consequences.

```yaml
# Decisions taken while authoring, and the runner capabilities they imply.
# These are the parts most worth a reviewer's argument.
authored-decisions:
  - id: seeds-over-a-supplied-codebase-for-deterministic-claims
    decision: >-
      Deterministic detection claims are proved against SEEDED files carrying
      the doc's own named example, not against a supplied real project. A
      supplied project can only be asserted structurally (counts > 0), which
      cannot prove "reports Database violations". `analysis-target` IS modeled
      and bound — in the two LLM variants, where realism is what makes the
      assertion meaningful and where structural assertions are the honest
      ceiling anyway.
  - id: category-claims-are-proved-through-violation-titles
    decision: >-
      `truecourse list` prints severity and title only — no rule key, no
      category. So a category claim is proved by seeding the named example and
      asserting the reported finding's title. Recorded as a journey observation:
      if the engine ever needs category-level assertions, `list` must render the
      rule key or domain.
  - id: steps-may-invoke-git
    decision: >-
      Scenario steps run the CLI under test and `git`. The docs' own claims are
      stated in git terms (`git add .truecourse/LATEST.json`, `git commit
      --no-verify`, `git worktree add`), and the pre-commit hook's only trigger
      IS `git commit`. No other program is invoked and no shell is used.
  - id: mid-scenario-file-mutation
    decision: >-
      The reference requires `write:` and `delete:` steps (sandbox-relative path
      → content) between command steps. Roughly a third of the claims are about
      what changes BETWEEN two runs — new and resolved violations, a rule
      disabled then re-run, a policy file edited or deleted — and setup-time
      seeding alone cannot express that. Today's guard scenario format seeds
      only before the first step; this is a capability the benchmark implies.
  - id: per-step-cwd-tty-and-env
    decision: >-
      Steps carry optional `cwd` (a second repository, a worktree, a clone),
      `tty: true` (the stash prompt and the hook-install confirmation only exist
      on a TTY — piped stdin makes those commands exit 1 instead of asking), and
      `env` (the documented `TRUECOURSE_*` variables). `env` already exists in
      the guard format; `cwd` and `tty` do not.
  - id: hermetic-home-and-telemetry
    decision: >-
      Every scenario points `TRUECOURSE_HOME` inside its sandbox and sets
      `TRUECOURSE_TELEMETRY=0`. Without the first, runs mutate the developer's
      real registry and global config; without the second, the first-run
      telemetry notice and the community notes perturb stdout.
  - id: cross-doc-restatements-share-one-observation
    decision: >-
      Where two docs state the same behavior (the three dirty-tree flags, the
      two "new and resolved" diff sentences), one step carries BOTH claim ids as
      its milestone. Claim identity is doc-anchored, so both must be tagged;
      inventing a second, weaker observation to give each its own step would be
      assertion theater.
  - id: combined-output-matcher-where-the-stream-is-unpinned
    decision: >-
      Two assertions match on `output` (stdout and stderr together) instead of
      one stream: the per-file skip warning and the missing-Roslyn-host error.
      No journey pins which stream carries either, so asserting one would encode
      a guess; the loose stream is recorded as a journey gap rather than
      silently dropped by asserting only the exit code.
  - id: seed-and-value-interpolation
    decision: >-
      Two interpolations appear in seeds and argv — `${sandbox}` (the sandbox
      root, needed for `TRUECOURSE_HOME` and for an absolute
      `core.excludesFile`) and `${supplied:<name>.<field>}` (a registered
      instance's value, e.g. the API key and model). They follow the runner's
      existing `${unique}` / `${HTTP_STUB:<name>}` convention. No secret is ever
      written into a seeded file — the file names the env var, the var carries
      the supplied value.
  - id: git-setup-gains-identity-and-root
    decision: >-
      `setup.seeds.git` carries `identity` (commits inside a sandbox need a
      user.name/user.email that is NOT the developer's) and `root` (the repo
      lives in a subdirectory when a flow needs siblings — a worktree, a clone,
      a second repository).
  - id: negative-assertions-use-lookahead-regexes
    decision: >-
      "X is absent from the output" is expressed as `matches:
      '^(?![\s\S]*X)[\s\S]*$'`, since the stream matchers offer equals /
      contains / matches only. Half the claims in this area are about something
      NOT being reported (a hidden violation, a skipped LLM call, an excluded
      file), so this idiom is load-bearing, not incidental.
```

## A5. Gap claim ids (G1) — RESOLVED, not dropped

`noFlowClaims` keeps each gap's `doc` + `anchor` + `claimTitle` + `reason`; the claim ID —
the identity the coverage invariant is checked on — still has no field THERE, but the id is
no longer lost: each entry resolves against `scenarios/claims.json` by identity
(`doc` + `anchor` + `title`), which is how the coverage view links a gap row to its claim and
how `crossCheckClaimRefs` proves none of them dangles. All 14 resolve. The list stays as the
record of what the reference authored:

```yaml
  - claim: ships-1500-deterministic-and-100-llm-rules
  - claim: rule-count-code-quality
  - claim: rule-count-bugs
  - claim: rule-count-security
  - claim: rule-count-performance
  - claim: rule-count-architecture
  - claim: rule-count-reliability
  - claim: rule-count-style
  - claim: rule-count-database
  - claim: det-file-timeout-defaults-to-30s
  - claim: supports-csharp-with-dotnet-sdk
  - claim: csharp-semantic-rules-need-built-roslyn-host
  - claim: disabled-llm-rule-makes-no-llm-calls
  - claim: truecourseignore-narrows-spec-scan-discovery
```

## A6. Per flow and scenario

Each subsection is one flow plus the scenario that realizes it. Order is the authored order in
`flows.yaml`.

### A6.1 `analyze-a-repository-for-the-first-time`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
  # ------------------------------------------------------------------ analyze
    kind: happy
    claims:
      - first-analyze-creates-dot-truecourse-dir
      - analyze-runs-static-and-llm-analysis
      - analyze-runs-full-analysis-in-process
      - deterministic-rules-make-no-api-calls
      - analyze-no-llm-skips-llm-rules
      - analyze-stores-results-as-json-under-dot-truecourse
      - latest-json-is-most-recent-snapshot
      - list-shows-violations-from-latest-analysis
      - supports-javascript-typescript
      - supports-python
      - catches-code-quality-violations
      - catches-security-violations
      - catches-bug-violations
      - catches-architecture-violations
      - catches-performance-violations
      - catches-reliability-violations
      - catches-database-violations
      - llm-rules-require-an-llm-transport
    starting-state:
      step-creatable:
        - the `.truecourse/` store, `LATEST.json`, `analyses/`, `history.json` — created by the analyze step itself, which is exactly what the first two claims assert
        - the `~/.truecourse/registry.json` entry (analyze registers the repo)
      seedable:
        - a small polyglot project, one file per rule category, each file carrying ONE canonical example the docs name (console.log, eval, a mutable Python default, an import cycle, a regex built inside a loop, a bare JSON.parse, a `SELECT *` query)
        - a git repository with a single commit holding those files, so the tree is clean and no stash decision is reachable on this path
        - env — `TRUECOURSE_HOME` pointed inside the sandbox (never the developer's home) and `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      The category claims are proved by SEEDING the doc's own named example and
      asserting the violation the rule reports, not by binding a real codebase:
      `truecourse list` prints `<icon> <SEVERITY>  <title>` and carries neither
      the rule key nor the category, so "a Database-category violation" is only
      observable as the titled finding ("SELECT * in production code"). A real
      codebase would make the assertion structural (count > 0) and would prove
      nothing about the category. The flow also opens with the two paths a
      first-time user hits before anything works — `truecourse analyze` with no
      LLM decision in a non-interactive shell (exit 1) and `--llm` with no
      transport configured — the second of which is the claim
      `llm-rules-require-an-llm-transport`.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `analyze-a-repository-for-the-first-time`.
# Every seeded file carries exactly ONE canonical example the docs name, so a
# reported violation title is unambiguous evidence for its category.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, list] (no milestone)
  # Establishes that no store exists yet — the "before" half of
  # `first-analyze-creates-dot-truecourse-dir`, observed through the public
  # surface instead of by peeking at the filesystem.

  # store step 2 — run: [truecourse, analyze, --no-llm, --no-skills] (milestone: 1)
      # `violations (` = the run reported what it found; the negative lookahead
      # on the estimate line = no LLM work was planned, priced or performed.
    milestone:
      - first-analyze-creates-dot-truecourse-dir
      - analyze-runs-static-and-llm-analysis
      - analyze-runs-full-analysis-in-process
      - analyze-stores-results-as-json-under-dot-truecourse
      - latest-json-is-most-recent-snapshot
      - deterministic-rules-make-no-api-calls
      - analyze-no-llm-skips-llm-rules
    note: >-
      One command, seven contracts: the store is created, the results are JSON
      under `.truecourse/`, LATEST.json is this run's snapshot, no dashboard or
      other process was started first, and the deterministic-only run planned
      no LLM call and printed no cost.

  # store step 3 — run: [truecourse, list, --limit, "200"] (milestone: 8)
    milestone:
      - list-shows-violations-from-latest-analysis
      - supports-javascript-typescript
      - catches-code-quality-violations
      - catches-architecture-violations
      - catches-performance-violations
      - catches-reliability-violations
      - catches-database-violations
    note: >-
      Each title is the finding of one seeded example the doc names for its
      category (console.log, an import cycle, a regex built in a loop, a bare
      JSON.parse, `SELECT *`). `--limit 200` only defeats pagination; the
      pagination contract itself belongs to the list-filter flow.

  # store step 4 — run: [truecourse, list, --severity, "critical,high"] (milestone: 12)
    milestone:
      - catches-security-violations
      - catches-bug-violations
      - supports-python
    note: >-
      The high-severity slice of the same report. "Mutable default argument" is
      a Python-only rule, so its presence — corroborated by the .py path in the
      snapshot — is what proves Python was analyzed.

  # store step 5 — run: [truecourse, analyze, --no-skills] (no milestone)
  # The two LLM-decision paths a first-time user meets. Plumbing: the
  # non-interactive requiredness is a journey fact, not a doc claim.

  # store step 6 — run: [truecourse, analyze, --llm, --no-skills] (milestone: 18)
    milestone: llm-rules-require-an-llm-transport
    note: >-
      No transport is saved in the sandbox HOME and `TRUECOURSE_LLM_TRANSPORT`
      is unset, so asking for LLM rules cannot produce LLM results. The docs
      state the requirement but not the failure mode, so the assertion stays at
      "the run does not proceed, and says why" rather than pinning one message.
```

### A6.2 `run-llm-rules-through-the-claude-code-transport`

**From `flows.yaml`** — `kind` (G6), `variant-of` (G7), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: variant
    variant-of: analyze-a-repository-for-the-first-time
    claims:
      - analyze-llm-runs-llm-rules
      - analyze-llm-preapproves-cost-estimate
      - llm-rules-send-source-to-configured-llm
    starting-state:
      step-creatable:
        - the store and the analysis snapshot (analyze)
      seedable:
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied:
        - "analysis-target — a real codebase the user registered; the runner COPIES it into the sandbox (a run must never mutate the user's working copy). Realism matters here: LLM rules are only meaningfully exercised over real source, and every assertion on their output stays structural."
        - "claude-code-cli — the `claude` binary, installed and logged in. Unregistered ⇒ this variant blocks alone; the api variant and every deterministic flow still run."
    notes: >-
      One of the two configuration paths of the same capability (plan §8.2,
      "every configuration path"). Assertions are structural — the run reports
      LLM work and completes — never content-exact, because the model's findings
      are not deterministic. `--llm` also pre-approves the cost estimate, so the
      absence of the confirm prompt is itself one of the milestones.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `run-llm-rules-through-the-claude-code-transport`.
# Configuration path 1 of 2 for the LLM capability. Runs only when the user has
# registered the `claude` binary; the api variant blocks or runs independently.
```

**Setup fields with no store home** — `setup.supplied` (G24):

```yaml
  supplied:
    - name: analysis-target
      is: >-
        a real codebase the user registered as an instance of this dependency.
        The runner COPIES it into the sandbox cwd before the steps; the user's
        working copy is never the thing analyzed, so a run cannot mutate it.
      blocks-when-unregistered: true
      why-not-seeded: >-
        LLM rules are only meaningfully exercised over real source. A
        hand-seeded three-file project would make every assertion here vacuous,
        and a fabricated stand-in would make the verdict meaningless (plan §8.2).
    - name: claude-code-cli
      is: the `claude` binary from Claude Code, installed and logged in, put on the sandbox PATH by the runner
      blocks-when-unregistered: true
      binds: { flag: "--llm-transport cli" }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --no-llm, --no-skills] (no milestone)
  # Deterministic control run: the same project, same sandbox, no LLM work.

  # store step 2 — run: [truecourse, analyze, --llm, --llm-transport, cli, --no-skills] (milestone: 1)
    milestone:
      - analyze-llm-runs-llm-rules
      - analyze-llm-preapproves-cost-estimate
      - llm-rules-send-source-to-configured-llm
    note: >-
      Three sub-assertions on one command, all structural, none content-exact.
      "LLM will analyze N files with M rules" with N ≥ 1 is the public evidence
      that source code went to the configured transport AND that the LLM rules
      ran alongside the deterministic scan; the absent confirm prompt is the
      pre-approval. The model's findings are never asserted — they are not
      deterministic, and the claims do not require them to be.

  # store step 3 — run: [truecourse, list, --limit, "200"] (no milestone)
    note: The run completed and its results are readable — the report shape, not its contents.
```

### A6.3 `run-llm-rules-through-the-provider-api-transport`

**From `flows.yaml`** — `kind` (G6), `variant-of` (G7), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: variant
    variant-of: analyze-a-repository-for-the-first-time
    claims:
      - analyze-llm-flag-overrides-for-one-run
      - analyze-no-llm-flag-skips-for-one-run
    starting-state:
      step-creatable:
        - the store and the analysis snapshot (analyze)
        - the repo's persisted LLM-rules setting (`truecourse rules llm --enable`), which the `--no-llm` claim asserts is left untouched by a per-run flag
      seedable:
        - "`home/.truecourse/config.json` — the api transport selection (provider + model + `apiKeyEnv`), written into the sandbox HOME; the key itself is never in the file, only the name of the env var that carries it"
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied:
        - "analysis-target — the same registered real codebase, copied into the sandbox."
        - "llm-api-credentials — the provider API key (and the model id to bill it against), injected as env values. Unregistered ⇒ this variant blocks alone."
    notes: >-
      The second configuration path. It carries the rules.mdx restatements of
      the per-run flags rather than the overview ones, so the two variants never
      assert the same sentence twice: this one proves that `--llm` overrides for
      ONE run and that `--no-llm` leaves the repository's persisted setting
      alone (observed through `truecourse rules llm` afterwards).

  # -------------------------------------------------------------------- rules
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `run-llm-rules-through-the-provider-api-transport`.
# Configuration path 2 of 2. Same capability, different dependency: a provider
# API key instead of the Claude Code binary.
```

**Setup comments** (authoring rationale for the seeds):

```yaml
      # The key never enters the config file — the file names the variable, the
      # variable carries the supplied value.
      TRUECOURSE_REFERENCE_API_KEY: ${supplied:llm-api-credentials.api-key}
```

**Setup fields with no store home** — `setup.supplied` (G24):

```yaml
  supplied:
    - name: analysis-target
      is: the same registered real codebase, copied into the sandbox cwd by the runner
      blocks-when-unregistered: true
    - name: llm-api-credentials
      is: a provider API key plus the model id to bill it against, held in the user's local overlay and never committed
      blocks-when-unregistered: true
      provides: [api-key, model]
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, rules, llm, --enable] (no milestone)
  # The repository-level setting the per-run flags must NOT disturb.

  # store step 3 — run: [truecourse, analyze, --llm, --llm-transport, api, --no-skills] (milestone: 1)
    milestone: analyze-llm-flag-overrides-for-one-run
    note: >-
      rules.mdx states both halves in one sentence — the flag runs the LLM rules
      FOR THAT RUN and pre-approves the cost estimate — so both are asserted
      here: LLM work was planned and priced, and no confirmation was requested.

  # store step 4 — run: [truecourse, analyze, --no-llm, --llm-transport, api, --no-skills] (no milestone)
    note: The paired observation for the next step — this run skipped the LLM rules entirely.

  # store step 5 — run: [truecourse, rules, llm] (milestone: 2)
    milestone: analyze-no-llm-flag-skips-for-one-run
    note: >-
      The distinguishing observation: after a `--no-llm` run, the repository's
      persisted setting still reads enabled. "For that run only" is exactly the
      difference between the previous step's output and this one.
```

### A6.4 `configure-rule-categories-and-llm-rules-per-repository`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
  # -------------------------------------------------------------------- rules
    kind: happy
    claims:
      - add-registers-repo-without-analyzing
      - rules-categories-shows-enabled-disabled
      - catches-style-violations
      - rules-categories-disable
      - rule-configuration-stored-in-config-json
      - rule-kinds-toggleable-per-repository
      - rules-categories-enable
      - rules-categories-reset
      - rules-llm-shows-status
      - rules-llm-disable
      - config-json-holds-categories-and-llm-toggles
      - rule-configuration-is-per-repository
      - rules-llm-enable
    starting-state:
      step-creatable:
        - "the `.truecourse/` store and the registry entry — created by `truecourse add`, which is the very claim `add-registers-repo-without-analyzing` (registered, but no analysis output)"
        - "`config.json` and every value in it — written only by `truecourse rules` steps"
        - the analysis snapshot that shows the category toggle taking effect
      seedable:
        - a Python file whose function name is camelCase (the doc's "naming conventions" Style example) plus one JavaScript file, so a category toggle has something to switch off
        - a SECOND repository directory in the sandbox, seeded the same way, to prove the policy is per repository
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      Style is enabled by default (no per-repo override ⇒ every category runs),
      so the scenario ESTABLISHES that first, then disables the category, proves
      the next analysis honors it, and re-enables it — which is what
      `rule-kinds-toggleable-per-repository` ("either kind … per repository")
      actually asserts, its LLM half riding the `rules llm` steps in the same
      flow. It opens with `truecourse rules categories` in an unregistered
      directory (exit 1) — the error path every `rules` subcommand shares.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `configure-rule-categories-and-llm-rules-per-repository`.
```

**Setup comments** (authoring rationale for the seeds):

```yaml
      # A second, independent repository in the same sandbox — the only way to
      # observe that a policy is per repository and not global.
      other-repo/package.json: |
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, rules, categories] (no milestone)
  # Every `rules` subcommand needs a registered project; this is the error path
  # it shares. Plumbing — the journeys promise it, no doc claim states it.
    cwd: other-repo

  # store step 2 — run: [truecourse, add, --no-skills] (milestone: 1)
    milestone: add-registers-repo-without-analyzing
    note: Registered — the store exists — while no analysis snapshot was written.

  # store step 3 — run: [truecourse, rules, categories] (milestone: 2)
    milestone: rules-categories-shows-enabled-disabled
    note: >-
      All eight categories with a state each. It also ESTABLISHES the starting
      point the style claim needs: with no per-repo override, style is enabled.

  # store step 5 — run: [truecourse, list, --limit, "200"] (milestone: 3)
    milestone: catches-style-violations
    note: The doc's own Style example — a naming convention — reported against the seeded Python function.

  # store step 6 — run: [truecourse, rules, categories, --disable, style] (milestone: 4)
    milestone:
      - rules-categories-disable
      - rule-configuration-stored-in-config-json

  # store step 9 — run: [truecourse, list, --limit, "200"] (milestone: 6)
    milestone: rule-kinds-toggleable-per-repository
    note: >-
      The toggle is not cosmetic: the next analysis produced no Style findings
      while still producing others. The claim's other half — the LLM kind — is
      exercised by the `rules llm` steps below in this same repository.

  # store step 10 — run: [truecourse, rules, categories, --enable, style] (milestone: 7)
    milestone: rules-categories-enable

  # store step 11 — run: [truecourse, rules, categories, --reset] (milestone: 8)
    milestone: rules-categories-reset

  # store step 12 — run: [truecourse, rules, categories] (no milestone)
    note: >-
      The hint only prints when NO per-repo override exists, so its return is
      the observable difference between "reset" and "set to the default values".

  # store step 13 — run: [truecourse, rules, llm] (milestone: 9)
    milestone: rules-llm-shows-status

  # store step 14 — run: [truecourse, rules, llm, --disable] (milestone: 10)
    milestone:
      - rules-llm-disable
      - config-json-holds-categories-and-llm-toggles
    note: >-
      config.json now carries both halves the baseline doc names: the category
      override written earlier in this scenario and the LLM toggle written here.

  # store step 15 — run: [truecourse, add, --no-skills] (no milestone)
    cwd: other-repo

  # store step 16 — run: [truecourse, rules, llm] (milestone: 12)
    cwd: other-repo
    milestone: rule-configuration-is-per-repository
    note: >-
      The first repository is sitting on an explicit `disabled` override at this
      exact moment; the second reports the untouched global default. Two
      repositories, two policies.

  # store step 17 — run: [truecourse, rules, llm, --enable] (milestone: 13)
    milestone: rules-llm-enable
```

### A6.5 `silence-and-restore-an-individual-rule`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: happy
    claims:
      - rules-list-shows-on-off-status
      - rules-list-domain-filter
      - rules-list-search-filter
      - rules-list-language-support-status
      - rules-disable-single-rule
      - disabled-rule-keys-in-config-disabledrules
      - rules-list-disabled-filter
      - disabled-rule-violations-hidden-from-list
      - rules-enable-single-rule
      - re-enabling-restores-hidden-violations
      - disabled-rules-skipped-at-analyze-time
      - rules-reset-one-rule
      - rules-reset-all-rules
    starting-state:
      step-creatable:
        - the store, the analysis snapshot, and every `disabledRules` entry (all through `analyze` and `rules disable/enable/reset`)
      seedable:
        - a JavaScript file with a `console.log` call and one with an `eval` call — two rules to toggle independently, so "clears ONE override while the others remain" is observable
        - a second `console.log`-bearing file written mid-scenario, to prove a disabled rule is skipped by a LATER analysis and not merely filtered from the report
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      The rule keys used (`code-quality/deterministic/console-log`,
      `security/deterministic/eval-usage`, `security/deterministic/sql-injection`)
      are not read out of the source tree: each is first OBSERVED in
      `truecourse rules list` output — the program's own public surface — and
      the step that observes it doubles as the proof for the list-filter claims.
      Two claims are deliberately kept apart because their mechanisms differ:
      hiding existing violations happens with NO re-analysis, while
      `disabled-rules-skipped-at-analyze-time` requires a fresh analysis over
      newly written code.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `silence-and-restore-an-individual-rule`.
# The rule keys used below are never taken from the source tree: steps 3–5
# OBSERVE them in `truecourse rules list` output first, which is also what
# proves the list filters.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 1 `write:` (G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 12
  - write:
      src/report.js: |
        export function report(rows) {
          console.log('rows', rows.length)
          return rows
        }
    expect:
      files:
        src/report.js: { exists: true }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, list, --limit, "200"] (no milestone)
    note: The "before" state both hiding claims are measured against.

  # store step 3 — run: [truecourse, rules, list] (milestone: 1)
    milestone: rules-list-shows-on-off-status
    note: >-
      Header plus a per-rule status. This step is also where the key used by
      every later step comes from — the program's own output, not its source.

  # store step 4 — run: [truecourse, rules, list, --domain, security] (milestone: 2)
    milestone: rules-list-domain-filter
    note: A security rule is listed and a code-quality rule is not — both halves of "only the rules in the named domain".

  # store step 5 — run: [truecourse, rules, list, --search, sql] (milestone: 3)
    milestone: rules-list-search-filter
    note: >-
      `sql-injection` matches on the key; `console-log` matches the term in
      none of key, name or description and is therefore absent.

  # store step 6 — run: [truecourse, rules, list, --language, python] (milestone: 4)
    milestone: rules-list-language-support-status

  # store step 7 — run: [truecourse, rules, disable, code-quality/deterministic/console-log] (milestone: 5)
    milestone:
      - rules-disable-single-rule
      - disabled-rule-keys-in-config-disabledrules

  # store step 8 — run: [truecourse, rules, list, --disabled] (milestone: 7)
    milestone: rules-list-disabled-filter

  # store step 9 — run: [truecourse, list, --limit, "200"] (milestone: 8)
    milestone: disabled-rule-violations-hidden-from-list
    note: >-
      No analysis ran between the disable and this listing: the existing
      violations are hidden from the report while every other finding stays.

  # store step 10 — run: [truecourse, rules, enable, code-quality/deterministic/console-log] (milestone: 9)
    milestone: rules-enable-single-rule

  # store step 11 — run: [truecourse, list, --limit, "200"] (milestone: 10)
    milestone: re-enabling-restores-hidden-violations
    note: Hidden, not deleted — the same snapshot renders them again.

  # store step 12 — run: [truecourse, rules, disable, code-quality/deterministic/console-log] (no milestone)
  # --- skipped at analyze time is a different mechanism from hidden-at-list ---

  # store step 15 — run: [truecourse, list, --limit, "200"] (milestone: 11)
    milestone: disabled-rules-skipped-at-analyze-time
    note: >-
      The distinguishing observation: the rule is ENABLED again, and the newly
      written file's `console.log` still produces nothing. Detection never ran
      while it was off, so there is no violation to un-hide — which is exactly
      what "skipped at analyze time" means and what filtering alone could not
      produce.

  # store step 18 — run: [truecourse, rules, reset, code-quality/deterministic/console-log] (milestone: 12)
    milestone: rules-reset-one-rule
    note: One override cleared; the other rule's override is still recorded — "that one rule" and no more.

  # store step 20 — run: [truecourse, rules, list, --disabled] (milestone: 13)
    milestone: rules-reset-all-rules
    note: With no key, every per-rule override is gone — the disabled set is empty.
```

### A6.6 `filter-the-violation-list-and-mistype-a-flag`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - list-all-shows-every-violation-unpaginated
      - list-severity-filters-by-severity
    starting-state:
      step-creatable:
        - the store and the analysis snapshot (analyze)
      seedable:
        - a project with MORE than the default page of 20 violations (five files of five `console.log` calls each) plus one high-severity `eval` and one high-severity Python mutable default, so pagination is real and the severity filter has something to exclude
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      The boundary and invalid-input paths the plan asks for live here as
      non-milestone steps, because claims.yaml has no claim for them and the
      journeys promise them precisely: an unknown `--severity` value (exit 1
      plus the valid list), a non-numeric `--limit` (exit 0, degrades to "show
      everything"), an unknown OPTION at the root (exit 1) and an unknown
      COMMAND at the root (exit 0 plus the help page). Grouping them into the
      list-browsing journey keeps every flow claim-bearing instead of creating a
      milestone-less "bad input" flow.

  # --------------------------------------------------------- baseline & diff
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `filter-the-violation-list-and-mistype-a-flag`.
# Seeded so the report is genuinely longer than one page (25 low-severity
# findings) and has exactly two high-severity ones to filter down to.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, list] (no milestone)
    note: >-
      The default listing paginates — the contrast `--all` is claimed against.
      The `.` in `1.20` stands in for the en dash the renderer prints.

  # store step 3 — run: [truecourse, list, --all] (milestone: 1)
    milestone: list-all-shows-every-violation-unpaginated
    note: >-
      Same analysis, no "Showing X–Y of N" window and no next-page pointer: the
      footer switches to the whole-set form, which is how the renderer says
      "this is all of them".

  # store step 4 — run: [truecourse, list, --severity, "high,critical"] (milestone: 2)
    milestone: list-severity-filters-by-severity
    note: >-
      Every printed row carries a requested severity: the 25 low findings that
      dominated the unfiltered report are gone, the high ones remain.

  # store step 5 — run: [truecourse, list, --severity, nope] (no milestone)
  # --- boundary and invalid input (journey-promised, no doc claim) ---

  # store step 6 — run: [truecourse, list, --limit, abc] (no milestone)
    note: >-
      A non-numeric `--limit` does not error — it degrades to "no pagination".
      Recorded here so the behavior is pinned by a test rather than by folklore.

  # store step 8 — run: [truecourse, bogus] (no milestone)
    note: An unknown COMMAND prints help and exits 0; an unknown OPTION exits 1. Both are contract, and they differ.
```

### A6.7 `commit-a-baseline-and-refresh-it`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
  # --------------------------------------------------------- baseline & diff
    kind: happy
    claims:
      - three-files-are-committable
      - local-only-files-gitignored-automatically
      - baseline-files-exist-and-are-stageable-after-analyze
      - rerun-analyze-updates-latest-json
    starting-state:
      step-creatable:
        - "`.truecourse/` with its `.gitignore`, `LATEST.json`, `config.json`, `analyses/`, `history.json` — all written by analyze; the flow asserts which of them git ignores and which it does not"
      seedable:
        - a small JavaScript project committed to a git repository (a git repo is a precondition of every ignore assertion)
        - a git identity for the sandbox repo, so the commit steps are deterministic
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      Ignore status is asserted with `git check-ignore` rather than by reading
      `.truecourse/.gitignore`: the claim is about what GIT does, and
      check-ignore's exit code (0 = some path is ignored, 1 = none) is the
      falsifiable form of both halves. `hooks.yaml` is checked as a PATH here —
      it need not exist for the ignore rules to be observable — and its creation
      is claimed in the hook flow.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `commit-a-baseline-and-refresh-it`.
# Ignore status is asserted through `git check-ignore`, because the claim is
# about what GIT does with the store, not about a file's contents.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 6 `git:`, 1 `write:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 1
  - git: [check-ignore, .truecourse/LATEST.json, .truecourse/config.json, .truecourse/hooks.yaml]
    expect:
      exit: 1
      stdout: { equals: "" }
    milestone: three-files-are-committable
    note: >-
      check-ignore exits 1 when NONE of the given paths is ignored — the
      falsifiable form of "these three are committable". `hooks.yaml` is checked
      as a path; it need not exist yet, and its creation is the hook flow's claim.

  # after store step 1
  - git: [check-ignore, .truecourse/analyses, .truecourse/diff.json, .truecourse/history.json, .truecourse/ui-state.json, .truecourse/logs, .truecourse/.analyze.lock]
    expect:
      exit: 0
      stdout:
        matches: '^(?=[\s\S]*analyses)(?=[\s\S]*diff\.json)(?=[\s\S]*history\.json)(?=[\s\S]*ui-state\.json)(?=[\s\S]*logs)(?=[\s\S]*\.analyze\.lock)[\s\S]*$'
    milestone: local-only-files-gitignored-automatically
    note: >-
      check-ignore echoes each path it matched, so the six local-only entries
      are asserted individually rather than by trusting one exit code. Nobody
      wrote this .gitignore by hand — analyze seeded it.

  # after store step 1
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json]
    expect:
      exit: 0

  # after store step 1
  - git: [status, --porcelain]
    expect:
      exit: 0
      stdout:
        matches: '^(?=[\s\S]*A[ ]+\.truecourse/LATEST\.json)(?=[\s\S]*A[ ]+\.truecourse/config\.json)[\s\S]*$'
    milestone: baseline-files-exist-and-are-stageable-after-analyze
    note: The documented command sequence, verbatim from the doc, with both files staged.

  # after store step 1
  - git: [commit, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 1
  - write:
      src/unsafe.js: |
        export function runRule(source) {
          return eval(source)
        }
    expect:
      files:
        src/unsafe.js: { exists: true }

  # after store step 2
  - git: [status, --porcelain, .truecourse/LATEST.json]
    expect:
      exit: 0
      stdout: { matches: 'M[ ]+\.truecourse/LATEST\.json' }
    note: Git agrees the tracked baseline moved — corroboration for the step above.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, analyze, --no-llm, --no-stash, --no-skills] (milestone: 4)
    milestone: rerun-analyze-updates-latest-json
    note: >-
      The snapshot committed a moment ago did not contain this finding; the
      re-run rewrote LATEST.json, which is what "commit the updated LATEST.json
      to refresh the baseline" depends on. `--no-stash` keeps the new file in
      the tree — the stash decision itself belongs to the dirty-tree flow.
```

### A6.8 `diff-uncommitted-changes-against-the-baseline`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: happy
    claims:
      - analyze-diff-diffs-worktree-against-baseline
      - analyze-diff-reports-new-and-resolved
      - analyze-diff-reports-new-and-resolved-overview
      - diff-excludes-preexisting-violations
      - diff-writes-diff-json
      - list-diff-shows-diff-results
      - diff-json-overwritten-each-run
    starting-state:
      step-creatable:
        - the baseline (analyze) and the committed baseline files (git add + commit)
        - "`diff.json` — written by the diff run, which is one of the claims"
      seedable:
        - three JavaScript files — one carrying a violation that must SURVIVE into the baseline and stay out of the diff, one whose violation the edits REMOVE, and the working-tree edit that ADDS a new one
        - a git repository with the seeded files committed, plus a git identity
        - env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      Opens with `truecourse analyze --diff` BEFORE any baseline exists (exit 1)
      — the error path the plan names explicitly — then builds the baseline and
      diffs against it. The pre-existing violation is the load-bearing part of
      `diff-excludes-preexisting-violations`: it must be present in
      `truecourse list` and absent from the diff, which is why the seed carries
      a violation nobody touches.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `diff-uncommitted-changes-against-the-baseline`.
# `src/legacy.js` is the load-bearing seed: its violation must be in the
# baseline and must NOT be in any diff.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 2 `git:`, 2 `write:`, 1 `delete:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 2
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 3
  # The uncommitted change: one violation added, one removed.
  - write:
      src/pay.js: |
        export function pay(text) {
          return JSON.parse(text)
        }
      src/unsafe.js: |
        export function runRule(source) {
          return JSON.stringify(source)
        }
    expect:
      files:
        src/pay.js: { exists: true }

  # after store step 5
  # A second, different diff over different edits.
  - delete: [src/pay.js]
    expect:
      files:
        src/pay.js: { absent: true }

  # after store step 5
  - write:
      src/scan.js: |
        export function scan(lines, patterns) {
          const hits = []
          for (const pattern of patterns) {
            const re = new RegExp(pattern)
            for (const line of lines) {
              if (re.test(line)) hits.push(line)
            }
          }
          return hits
        }
    expect:
      files:
        src/scan.js: { exists: true }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --diff, --no-llm] (no milestone)
  # The error path: diff has nothing to diff against until a baseline exists.

  # store step 3 — run: [truecourse, list, --limit, "200"] (no milestone)
    note: >-
      The pre-existing violation IS in the baseline report. Without this step,
      its later absence from the diff would prove nothing.

  # store step 4 — run: [truecourse, analyze, --diff, --no-llm] (milestone: 2)
    milestone:
      - analyze-diff-reports-new-and-resolved
      - analyze-diff-reports-new-and-resolved-overview
      - analyze-diff-diffs-worktree-against-baseline
      - diff-writes-diff-json
    note: >-
      Both docs state the new/resolved sentence, so one observation carries both
      claim ids. The report's shape — changed files, a new set, a resolved set,
      a summary — is itself the evidence that the WORKING TREE was compared with
      the committed baseline rather than re-listed in full.

  # store step 5 — run: [truecourse, list, --diff] (milestone: 6)
    milestone:
      - list-diff-shows-diff-results
      - diff-excludes-preexisting-violations
    note: >-
      `list --diff` renders the STORED result, so this doubles as proof that the
      diff run wrote what it printed. The untouched `console.log` violation —
      present in the full listing three steps earlier — is absent: the diff
      reports only what the changes introduce and resolve.

  # store step 7 — run: [truecourse, list, --diff] (milestone: 7)
    milestone: diff-json-overwritten-each-run
    note: >-
      `list --diff` reads diff.json, so its output IS the file's content: only
      the second run's finding is there. Nothing accumulated.
```

### A6.9 `work-from-a-fresh-worktree-and-clone`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - worktrees-and-clones-inherit-the-baseline
      - diff-works-immediately-in-a-new-worktree
      - diff-compares-worktree-against-committed-baseline
      - hook-works-on-first-commit-in-a-new-worktree
    starting-state:
      step-creatable:
        - the baseline in the main checkout (analyze + commit)
        - the pre-commit hook (hooks install) — installed once in the main checkout and shared by every linked worktree through the common git dir
        - the worktree and the clone (git), which is how the inheritance claim is observed
      seedable:
        - a git repository under `repo/` with a small JavaScript project, so the worktree and the clone can be siblings inside the sandbox
        - a git identity
        - "env — `TRUECOURSE_HOME` inside the sandbox, `TRUECOURSE_TELEMETRY=0`, `TRUECOURSE_LLM_TRANSPORT=claude-code` (suppresses the first-run wizard on the one step that runs under a TTY)"
      supplied: []
    notes: >-
      This is the empty-state corner: a checkout with a committed baseline but
      NO local analysis. `diff-compares-worktree-against-committed-baseline` is
      asserted by the absence of any local full-analysis artifact
      (`history.json`) in the worktree while the diff still produces a result —
      the only public evidence that no cold start happened. The worktree's first
      commit is deliberately a PASSING one, so this flow does not re-walk the
      hook-blocking path that `install-the-pre-commit-hook-and-enforce-it` owns.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `work-from-a-fresh-worktree-and-clone`.
# Sandbox layout: `repo/` is the checkout, `feat-x/` the linked worktree and
# `clone-x/` the fresh clone — siblings, so every path stays inside the sandbox.
```

**Setup fields with no store home** — `setup.seeds.git.root` (G23), `setup.seeds.git.identity` (G22):

```yaml
      root: repo
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 6 `git:`, 1 `write:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 2
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json, .truecourse/hooks.yaml]
    cwd: repo
    expect:
      exit: 0

  # after store step 2
  - git: [commit, --no-verify, -m, add truecourse baseline]
    cwd: repo
    expect:
      exit: 0
    note: >-
      `--no-verify` here is plumbing, not the claim: this commit only exists to
      put the baseline and the policy into git so the other checkouts inherit them.

  # after store step 2
  - git: [worktree, add, ../feat-x]
    cwd: repo
    expect:
      exit: 0

  # after store step 2
  - git: [clone, ., ../clone-x]
    cwd: repo
    expect:
      exit: 0
      files:
        feat-x/.truecourse/LATEST.json: { exists: true }
        clone-x/.truecourse/LATEST.json: { exists: true }
        clone-x/.truecourse/hooks.yaml: { exists: true }
    milestone: worktrees-and-clones-inherit-the-baseline
    note: >-
      No TrueCourse command has ever run in either checkout — the baseline
      arrived through git alone, because LATEST.json is tracked.

  # after store step 2
  - write:
      feat-x/src/notes.js: |
        export function notes(rows) {
          console.log('notes', rows.length)
          return rows
        }
    expect:
      files:
        feat-x/src/notes.js: { exists: true }

  # after store step 3
  - git: [add, src/notes.js]
    cwd: feat-x
    expect:
      exit: 0

  # after store step 3
  - git: [commit, -m, add notes]
    cwd: feat-x
    expect:
      exit: 0
      stdout: { matches: '^(?=[\s\S]*TrueCourse pre-commit check)(?=[\s\S]*passed)[\s\S]*$' }
    milestone: hook-works-on-first-commit-in-a-new-worktree
    note: >-
      The hook installed in the main checkout runs on the worktree's FIRST
      commit — linked worktrees share the common git dir — and reaches a
      verdict with no per-checkout cold start. The change is deliberately a
      low-severity one so this flow proves reachability, not blocking; blocking
      belongs to `install-the-pre-commit-hook-and-enforce-it`.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --no-llm, --no-skills] (no milestone)
    cwd: repo

  # store step 2 — run: [truecourse, hooks, install] (no milestone)
    cwd: repo
    tty: true

  # store step 3 — run: [truecourse, analyze, --diff, --no-llm] (milestone: 2)
    cwd: feat-x
    milestone:
      - diff-works-immediately-in-a-new-worktree
      - diff-compares-worktree-against-committed-baseline
    note: >-
      First command in this checkout, and it produces a result. The absent
      `history.json` is the public evidence that no full analysis ever ran here:
      the comparison was made against the baseline committed on main, not
      against a locally computed one.
```

### A6.10 `analyze-a-dirty-working-tree`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - analyze-prompts-before-stashing-dirty-tree
      - dirty-tree-prompts-before-stashing
      - analyze-stash-preapproves-stashing
      - stash-flag-preapproves-stashing
      - analyze-no-stash-analyzes-tree-as-is
      - no-stash-flag-analyzes-tree-as-is
    starting-state:
      step-creatable:
        - the store and each analysis snapshot
      seedable:
        - a committed JavaScript file with no violations, plus an UNCOMMITTED file whose `console.log` is the marker that tells the stashed run apart from the as-is run
        - a git repository and identity
        - "env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`, `TRUECOURSE_LLM_TRANSPORT=claude-code` so the first-run transport wizard never precedes the stash prompt on the TTY step"
      supplied: []
    notes: >-
      Three configuration paths of one decision — prompt, `--stash`,
      `--no-stash` — and both docs state all three, so each observation carries
      the overview claim and the baseline-and-diff claim together. The prompt
      step needs a pseudo-TTY (`tty: true`); the same command without one is the
      flow's first, non-milestone step and exits 1, which is the
      non-interactive contract the journey records and the docs omit.

  # ---------------------------------------------------------------- git hooks
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `analyze-a-dirty-working-tree`.
# `src/dirty.js` is uncommitted, and its `console.log` is the marker that tells
# a stashed run (committed state) apart from an as-is run (working tree).
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 1 `write:` (G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # before store step 1
  - write:
      src/dirty.js: |
        export function dirty(rows) {
          console.log('dirty', rows.length)
          return rows
        }
    expect:
      files:
        src/dirty.js: { exists: true }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --no-llm, --no-skills] (no milestone)
  # No TTY, no stash flag: the decision cannot be made, so the run refuses
  # rather than guessing. Journey contract; the docs do not state it.

  # store step 2 — run: [truecourse, analyze, --no-llm, --no-skills] (milestone: 1)
    tty: true
    milestone:
      - analyze-prompts-before-stashing-dirty-tree
      - dirty-tree-prompts-before-stashing
    note: >-
      Both docs state this behavior; one observation carries both claim ids. The
      scripted answer is the first option ("Stash and analyze committed state"),
      which is what a bare newline selects. The file surviving the run is the
      stash being popped afterwards — nothing of the developer's is lost.

  # store step 3 — run: [truecourse, analyze, --no-llm, --stash, --no-skills] (no milestone)
    note: The pre-approved path — no question asked. Its effect is asserted next.

  # store step 4 — run: [truecourse, list, --limit, "200"] (milestone: 3)
    milestone:
      - analyze-stash-preapproves-stashing
      - stash-flag-preapproves-stashing
    note: >-
      The uncommitted file's violation is absent: the pending changes really
      were stashed and the committed state was analyzed. Paired with the
      previous step, which is where "no prompt appeared" is asserted.

  # store step 6 — run: [truecourse, list, --limit, "200"] (milestone: 5)
    milestone:
      - analyze-no-stash-analyzes-tree-as-is
      - no-stash-flag-analyzes-tree-as-is
    note: >-
      Same command, opposite flag, opposite result: the working tree as it
      stands was analyzed, so the uncommitted violation is reported. The two
      list steps in this scenario differ only in what preceded them, which is
      precisely the behavior under test.
```

### A6.11 `install-the-pre-commit-hook-and-enforce-it`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
  # ---------------------------------------------------------------- git hooks
    kind: happy
    claims:
      - hooks-install-installs-precommit-hook
      - hooks-install-seeds-hooks-yaml
      - hooks-yaml-created-by-hooks-install
      - hooks-yaml-default-block-on
      - hooks-status-shows-status-and-config
      - hooks-yaml-default-llm-false
      - no-verify-bypasses-the-hook
      - hook-runs-analyze-diff-on-every-commit
      - hook-allows-commit-without-matching-violation
      - hook-blocks-commits-introducing-new-violations
      - hook-blocks-on-configured-block-severities
      - hook-runs-the-same-diff-check
      - hook-diffs-against-latest-json
      - latest-json-is-baseline-for-diff-and-hook
      - hooks-uninstall-removes-precommit-hook
    starting-state:
      step-creatable:
        - "the hook script and `.truecourse/hooks.yaml` (hooks install) — asserted absent first, so \"created by install\" is falsifiable"
        - the baseline the hook diffs against (analyze + commit)
        - every commit in the flow (git)
      seedable:
        - a git repository with a clean JavaScript project and a git identity
        - "the two files written mid-flow: a `console.log` file (severity low — below the seeded block-on) and an `eval` file (severity high — inside it), which is what makes pass and block observable on the SAME policy"
        - "env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`, `TRUECOURSE_LLM_TRANSPORT=claude-code` (the install confirmation runs under a TTY)"
      supplied: []
    notes: >-
      Both verdicts live in one flow because they are one policy read two ways;
      splitting them would duplicate the whole install-and-baseline path. The
      "no baseline yet" hook path (exit 1, "No baseline analysis yet") is walked
      as a non-milestone step before the baseline exists — the second error path
      the plan names — and the commit that recovers from it is exactly the
      `--no-verify` claim. RUNTIME FACT the runner must satisfy: the installed
      hook script executes `npx -y truecourse hooks run`, so the CLI under test
      must be resolvable as `truecourse` on the sandbox PATH; without that the
      hook steps fail for a reason that has nothing to do with the claims.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `install-the-pre-commit-hook-and-enforce-it`.
# RUNTIME REQUIREMENT: the installed hook script runs `npx -y truecourse hooks
# run`, so the CLI under test must be resolvable as `truecourse` on the sandbox
# PATH. Without that, every commit step fails for a reason unrelated to the claims.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 3 `write:`, 11 `git:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 3
  - write:
      src/notes.js: |
        export function notes(rows) {
          console.log('notes', rows.length)
          return rows
        }
    expect:
      files:
        src/notes.js: { exists: true }

  # after store step 3
  - git: [add, src/notes.js]
    expect:
      exit: 0

  # after store step 3
  # The hook is installed but nothing has been analyzed yet: it has no baseline
  # to diff against and says so instead of guessing. Journey contract.
  - git: [commit, -m, add notes]
    expect:
      exit: 1
      stderr: { contains: "No baseline analysis yet" }

  # after store step 3
  - git: [commit, --no-verify, -m, add notes]
    expect:
      exit: 0
      stdout: { matches: '^(?![\s\S]*TrueCourse pre-commit check)[\s\S]*$' }
    milestone: no-verify-bypasses-the-hook
    note: >-
      The identical commit that the hook refused one step earlier goes through,
      with no hook output at all. This is also how a developer recovers from
      the no-baseline state, which is why the two steps sit together.

  # after store step 3
  - git: [log, --oneline]
    expect:
      exit: 0
      stdout: { contains: "add notes" }

  # after store step 4
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json, .truecourse/hooks.yaml]
    expect:
      exit: 0

  # after store step 4
  - git: [commit, --no-verify, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 4
  - write:
      src/util.js: |
        export function util(rows) {
          console.log('util', rows.length)
          return rows
        }
    expect:
      files:
        src/util.js: { exists: true }

  # after store step 4
  - git: [add, src/util.js]
    expect:
      exit: 0

  # after store step 4
  - git: [commit, -m, add util]
    expect:
      exit: 0
      stdout: { matches: '^(?=[\s\S]*TrueCourse pre-commit check)(?=[\s\S]*passed)[\s\S]*$' }
    milestone:
      - hook-runs-analyze-diff-on-every-commit
      - hook-allows-commit-without-matching-violation
    note: >-
      The change introduces a low-severity violation — a real new finding that
      does not match `block-on: [critical, high]` — so the diff check runs on
      this commit AND lets it through. Without this step the flow would only
      prove the hook blocks everything.

  # after store step 4
  - write:
      src/unsafe.js: |
        export function runRule(source) {
          return eval(source)
        }
    expect:
      files:
        src/unsafe.js: { exists: true }

  # after store step 4
  - git: [add, src/unsafe.js]
    expect:
      exit: 0

  # after store step 4
  - git: [commit, -m, add unsafe]
    expect:
      exit: 1
      stdout:
        matches: '^(?=[\s\S]*BLOCKED)(?=[\s\S]*Dynamic code evaluation)(?=[\s\S]*Commit blocked)[\s\S]*$'
    milestone:
      - hook-blocks-commits-introducing-new-violations
      - hook-blocks-on-configured-block-severities
    note: >-
      Same policy, same hook, higher severity: blocked, with the offending
      violation named. The commit is refused — `git log` still ends at "add util".

  # after store step 6
  - git: [commit, -m, add unsafe]
    expect:
      exit: 0
      stdout: { matches: '^(?![\s\S]*TrueCourse pre-commit check)[\s\S]*$' }
    milestone: hooks-uninstall-removes-precommit-hook
    note: >-
      The behavioral proof the claim asks for: the very commit that was blocked
      two steps ago now completes, with no hook output. Asserting only that a
      file disappeared would be a weaker test of the same sentence.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, hooks, status] (no milestone)
    note: The "before" state for both the hook and the policy file.

  # store step 2 — run: [truecourse, hooks, install] (milestone: 1)
    tty: true
    milestone:
      - hooks-install-installs-precommit-hook
      - hooks-install-seeds-hooks-yaml
      - hooks-yaml-created-by-hooks-install
      - hooks-yaml-default-block-on
    note: >-
      One command, four contracts: the hook is installed, the policy file is
      seeded by THIS command (it was absent one step ago), and the starter
      policy blocks on critical and high. The confirmation is answered yes; the
      decline path is its own flow.

  # store step 3 — run: [truecourse, hooks, status] (milestone: 5)
    milestone:
      - hooks-status-shows-status-and-config
      - hooks-yaml-default-llm-false
    note: >-
      Status is the state PLUS the effective policy. The seeded `llm: false` is
      asserted in the file and in the rendered status, which is as close to "no
      tokens per commit" as the promised surfaces get.

  # store step 5 — run: [truecourse, analyze, --diff, --no-llm] (milestone: 12)
    milestone:
      - hook-runs-the-same-diff-check
      - hook-diffs-against-latest-json
      - latest-json-is-baseline-for-diff-and-hook
    note: >-
      Run by hand, `analyze --diff` reports exactly what the hook just reported.
      Both read the same committed LATEST.json, which is the sentence three
      docs state three ways.
```

### A6.12 `decline-the-pre-commit-hook-installation`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - hooks-install-warns-and-requires-confirmation
      - declining-hooks-install-writes-nothing
    starting-state:
      step-creatable:
        - the baseline (analyze + commit) — established AFTER the decline, so the "nothing was installed" evidence is a commit that simply succeeds
      seedable:
        - a git repository with a JavaScript project and a git identity
        - the `eval` file written mid-flow — a change that WOULD be blocked, had the hook been installed
        - "env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`, `TRUECOURSE_LLM_TRANSPORT=claude-code` (TTY step)"
      supplied: []
    notes: >-
      Separate from the install flow because the paths diverge at the
      confirmation: one answers yes, the other no, and the decline path's only
      real evidence is behavioral (a commit that would have been blocked goes
      through silently). Asserting merely that no hook FILE exists would be a
      weaker proof of the same claim, so the scenario asserts the commit.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `decline-the-pre-commit-hook-installation`.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 4 `git:`, 1 `write:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 2
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 2
  - write:
      src/unsafe.js: |
        export function runRule(source) {
          return eval(source)
        }
    expect:
      files:
        src/unsafe.js: { exists: true }

  # after store step 2
  - git: [add, src/unsafe.js]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, -m, add unsafe]
    expect:
      exit: 0
      stdout: { matches: '^(?![\s\S]*TrueCourse pre-commit check)(?![\s\S]*BLOCKED)[\s\S]*$' }
    milestone: declining-hooks-install-writes-nothing
    note: >-
      A high-severity violation introduced against a committed baseline — the
      exact change the installed hook blocks in the enforcement flow — sails
      through with no hook output. Nothing was written when the confirmation was
      declined.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, hooks, install] (milestone: 1)
    tty: true
    milestone: hooks-install-warns-and-requires-confirmation
    note: >-
      Three things in one output: the latency warning about what the hook does
      on every commit, a question that must be answered, and — because the
      answer was no — a cancellation instead of an installation. The default
      answer is NO, so "requires confirmation" is not satisfied by silence.
```

### A6.13 `retune-the-hook-policy-in-hooks-yaml`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - hook-reads-only-from-hooks-yaml
      - block-on-accepts-five-severities
      - deleted-hooks-yaml-warns
      - deleted-hooks-yaml-passes-every-commit
    starting-state:
      step-creatable:
        - the baseline, the hook, and the seeded policy file (analyze, git, hooks install)
      seedable:
        - "the rewritten `hooks.yaml` bodies: a narrowed `block-on: [critical]`, then the full five-severity list"
        - a git repository, identity, and the violation-bearing files each policy is tested against
        - "env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`, `TRUECOURSE_LLM_TRANSPORT=claude-code`"
      supplied: []
    notes: >-
      The conflicting-state corner: the same commit is blocked under one policy
      and allowed under another, and then allowed again with NO policy at all.
      Honest scope on `block-on-accepts-five-severities` — the scenario proves
      all five values are ACCEPTED (`hooks status` renders the policy and exits
      0) and that a non-default severity genuinely changes the verdict (a low
      violation blocks once `low` is listed); it does not manufacture one
      violation per severity, which no seed can guarantee.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `retune-the-hook-policy-in-hooks-yaml`.
# The same commit is blocked, then allowed, then allowed again with no policy
# file at all — three verdicts from one change, driven only by hooks.yaml.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 10 `git:`, 5 `write:`, 1 `delete:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 2
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json, .truecourse/hooks.yaml]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, --no-verify, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 2
  - write:
      src/unsafe.js: |
        export function runRule(source) {
          return eval(source)
        }
    expect:
      files:
        src/unsafe.js: { exists: true }

  # after store step 2
  - git: [add, src/unsafe.js]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, -m, add unsafe]
    expect:
      exit: 1
      stdout: { contains: "BLOCKED" }
    note: The starting verdict under the seeded policy — this commit is blocked.

  # after store step 2
  - write:
      .truecourse/hooks.yaml: |
        pre-commit:
          block-on: [critical]
          llm: false
    expect:
      files:
        .truecourse/hooks.yaml: { contains: "block-on: [critical]" }

  # after store step 2
  - git: [commit, -m, add unsafe]
    expect:
      exit: 0
      stdout: { matches: '^(?![\s\S]*BLOCKED)(?=[\s\S]*TrueCourse pre-commit check)[\s\S]*$' }
    milestone: hook-reads-only-from-hooks-yaml
    note: >-
      Nothing changed but the file: the same staged change, the same hook, the
      same baseline. Narrowing `block-on` let it through, so the policy comes
      from this file and nowhere else — there is no code-level default quietly
      overriding it.

  # after store step 2
  - write:
      .truecourse/hooks.yaml: |
        pre-commit:
          block-on: [info, low, medium, high, critical]
          llm: false
    expect:
      files:
        .truecourse/hooks.yaml: { contains: "block-on: [info, low, medium, high, critical]" }

  # after store step 3
  - write:
      src/notes.js: |
        export function notes(rows) {
          console.log('notes', rows.length)
          return rows
        }
    expect:
      files:
        src/notes.js: { exists: true }

  # after store step 3
  - git: [add, src/notes.js]
    expect:
      exit: 0

  # after store step 3
  - git: [commit, -m, add notes]
    expect:
      exit: 1
      stdout:
        matches: '^(?=[\s\S]*BLOCKED)(?=[\s\S]*console\.log call)[\s\S]*$'
    milestone: block-on-accepts-five-severities
    note: >-
      A LOW-severity violation now blocks the commit — a severity the seeded
      default never blocked on — so the accepted values are honored, not merely
      parsed. Scope kept honest: this proves acceptance of all five plus
      enforcement at a non-default one; it does not manufacture one violation
      per severity, which no seed can guarantee.

  # after store step 3
  - delete: [.truecourse/hooks.yaml]
    expect:
      files:
        .truecourse/hooks.yaml: { absent: true }

  # after store step 3
  - git: [commit, -m, add notes]
    expect:
      exit: 0
      stderr: { contains: "No `.truecourse/hooks.yaml`" }
    milestone:
      - deleted-hooks-yaml-warns
      - deleted-hooks-yaml-passes-every-commit
    note: >-
      The commit blocked one step ago now passes, and the hook says why. Both
      claim ids ride this observation because they are one behavior stated in
      two sentences: with no policy file, the hook warns and enforces nothing —
      no hidden code-level defaults.

  # after store step 3
  - write:
      src/danger.js: |
        export function danger(source) {
          return eval(source)
        }
    expect:
      files:
        src/danger.js: { exists: true }

  # after store step 3
  - git: [add, src/danger.js]
    expect:
      exit: 0

  # after store step 3
  - git: [commit, -m, add danger]
    expect:
      exit: 0
      stdout: { matches: '^(?![\s\S]*BLOCKED)[\s\S]*$' }
    note: >-
      And a CRITICAL-adjacent change passes too — "passes every commit" is not
      an accident of the previous change's severity.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, hooks, install] (no milestone)
    tty: true

  # store step 3 — run: [truecourse, hooks, status] (no milestone)
    note: >-
      All five documented values are ACCEPTED: an unknown severity makes this
      command exit 1 with "unknown value(s) in `pre-commit.block-on`", so a
      clean exit 0 that renders all five is the acceptance proof.
```

### A6.14 `run-llm-rules-on-every-commit`

**From `flows.yaml`** — `kind` (G6), `variant-of` (G7), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: variant
    variant-of: install-the-pre-commit-hook-and-enforce-it
    claims:
      - hooks-yaml-llm-true-runs-llm-rules
    starting-state:
      step-creatable:
        - the baseline, the hook and the policy file
      seedable:
        - "a `hooks.yaml` with `pre-commit.llm: true`"
        - a git repository, identity, and a change to commit
        - env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`
      supplied:
        - "claude-code-cli — the `claude` binary, logged in. Unregistered ⇒ this variant blocks alone while the default `llm: false` hook flow keeps running."
    notes: >-
      The second configuration path of the hook policy. JOURNEY GAP recorded
      while authoring: `hooks run`'s promised stdout is one progressive line and
      a verdict — it carries no LLM usage or cost line — so "spending tokens per
      commit" is not directly observable on the public surface. The scenario
      proves the policy is HONORED instead of merely stored, with two
      observations the journeys do promise: `hooks status` reports "LLM rules on
      commit: enabled (tokens per commit)", and the same commit under the same
      policy with the transport made unusable fails with the LLM-configuration
      exit 1 rather than passing deterministically. The residue (usage on
      stdout) is a journey defect worth fixing, not a reason to weaken the
      assertion.

  # ------------------------------------------------------- resilience & scope
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `run-llm-rules-on-every-commit`.
# The hook policy's second configuration path (`pre-commit.llm: true`).
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22), `setup.supplied` (G24):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
  supplied:
    - name: claude-code-cli
      is: the `claude` binary from Claude Code, installed and logged in, put on the sandbox PATH by the runner
      blocks-when-unregistered: true
      binds: { env: { TRUECOURSE_LLM_TRANSPORT: claude-code } }
```

**Steps the step vocabulary cannot express** — 5 `git:`, 2 `write:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # after store step 2
  - git: [add, .truecourse/LATEST.json, .truecourse/config.json, .truecourse/hooks.yaml]
    expect:
      exit: 0

  # after store step 2
  - git: [commit, --no-verify, -m, add truecourse baseline]
    expect:
      exit: 0

  # after store step 2
  - write:
      .truecourse/hooks.yaml: |
        pre-commit:
          block-on: [critical, high]
          llm: true
    expect:
      files:
        .truecourse/hooks.yaml: { contains: "llm: true" }

  # after store step 3
  - write:
      src/notes.js: |
        export function notes(rows) {
          console.log('notes', rows.length)
          return rows
        }
    expect:
      files:
        src/notes.js: { exists: true }

  # after store step 3
  - git: [add, src/notes.js]
    expect:
      exit: 0

  # after store step 3
  - git: [commit, -m, add notes]
    env:
      TRUECOURSE_LLM_TRANSPORT: api
    expect:
      exit: 1
    milestone: hooks-yaml-llm-true-runs-llm-rules
    note: >-
      The proof that the policy is EXECUTED and not merely stored: with
      `llm: true` and the transport pointed at an api configuration that does
      not exist in this sandbox HOME, the hook fails with the unusable-LLM-
      configuration exit instead of quietly passing the commit deterministically.
      Under `llm: false` the very same commit passes (that is the default hook
      flow), so the difference is attributable to the policy alone.
      JOURNEY DEFECT recorded while authoring: `hooks run` prints one
      progressive line and a verdict and carries NO usage or cost line, so
      "spending tokens per commit" has no direct public observation. The
      assertion stays at the strongest promised surface rather than being
      weakened to something that would pass either way.

  # after store step 3
  - git: [commit, -m, add notes]
    expect:
      exit: 0
      stdout: { matches: '^(?=[\s\S]*TrueCourse pre-commit check)(?=[\s\S]*passed)[\s\S]*$' }
    note: >-
      Same policy, working transport (the supplied `claude` binary): the commit
      completes. This is what makes the previous step's failure a statement
      about the LLM path and not about the hook being broken.
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, hooks, install] (no milestone)
    tty: true

  # store step 3 — run: [truecourse, hooks, status] (no milestone)
    note: >-
      The policy is read and reported — including the token-cost warning the
      status line carries for exactly this setting.
```

### A6.15 `survive-a-file-that-exceeds-the-per-file-budget`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
  # ------------------------------------------------------- resilience & scope
    kind: edge
    claims:
      - det-file-timeout-env-override
      - pathological-file-skipped-with-warning
      - analysis-always-completes-and-writes-output
    starting-state:
      step-creatable:
        - the store and the analysis output that must exist even when a file was skipped
      seedable:
        - one large but entirely legitimate generated-looking source file (a few thousand lines), plus one ordinary file whose violation must still be reported
        - "env — `TRUECOURSE_DET_FILE_TIMEOUT_MS` set to a value small enough that the large file cannot finish; the same run without it is the control"
      supplied: []
    notes: >-
      The budget is driven from the documented env override rather than by
      authoring genuinely pathological source (catastrophic backtracking is not
      a thing a scenario can seed deterministically). The control step — the
      same project at the default budget, no skip warning — is what makes the
      override claim falsifiable rather than a tautology.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `survive-a-file-that-exceeds-the-per-file-budget`.
# Catastrophic backtracking cannot be seeded deterministically, so the budget is
# driven from the documented env override instead — the same code path, reached
# by the documented lever.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --no-llm, --no-skills] (no milestone)
  # Control: the same project at the default budget. No skips, full results.
      output: { matches: '^(?![\s\S]*bulk\.js)[\s\S]*$' }
    note: >-
      Without this control the override claim would be untestable: any warning
      seen later has to be attributable to the variable, not to the seed.

  # store step 2 — run: [truecourse, analyze, --no-llm, --no-skills] (milestone: 1)
      output: { matches: '^(?=[\s\S]*[Ss]kipp)(?=[\s\S]*bulk\.js)[\s\S]*$' }
    milestone:
      - det-file-timeout-env-override
      - pathological-file-skipped-with-warning
      - analysis-always-completes-and-writes-output
    note: >-
      Same command, same project, one environment variable: files that finished
      comfortably a step ago are now skipped WITH A WARNING that names the file,
      and the run still exits 0 and still writes its snapshot and history. The
      matcher spans both streams because no journey pins which one carries the
      warning — recorded as a journey gap, not papered over by asserting the
      exit code alone.

  # store step 3 — run: [truecourse, list, --limit, "200"] (no milestone)
    note: The report is readable after a skipping run — the output really was written, not just claimed.
```

### A6.16 `analyze-csharp-without-the-roslyn-host`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: edge
    claims:
      - csharp-without-host-fails-fast
    starting-state:
      step-creatable:
        - "nothing beyond the store; the point of the flow is that the run does NOT complete"
      seedable:
        - one small C# file alongside a JavaScript file, so the failure is attributable to the C# path and not to an empty repository
        - env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      Stands alone deliberately: a `.cs` file makes analysis fail hard by
      design, so folding it into any other flow would poison that flow's
      analyze steps. It is also the only C# claim that is provable WITHOUT the
      .NET SDK — the two positive C# claims are gaps below, waiting on a
      supplied `dotnet-sdk` instance.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `analyze-csharp-without-the-roslyn-host`.
# Stands alone on purpose: a `.cs` file makes analysis fail by design, so this
# seed cannot share a sandbox with any flow that needs analyze to succeed.
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 1 — run: [truecourse, analyze, --no-llm, --no-skills] (milestone: 1)
      output: { matches: '(?=[\s\S]*[Rr]oslyn)[\s\S]*' }
    milestone: csharp-without-host-fails-fast
    note: >-
      Fails FAST and loudly: a non-zero exit, an error naming the missing
      Roslyn host, and no snapshot written. The last assertion is the
      load-bearing one — the claim is that analysis does not silently fall back
      to a partial result, and a written LATEST.json would be exactly that
      partial result.

  # store step 2 — run: [truecourse, list] (no milestone)
    note: >-
      Nothing was persisted, so there is nothing to list. The JavaScript half of
      the repository was not quietly reported as if the analysis had succeeded.
```

### A6.17 `exclude-generated-and-ignored-files-from-analysis`

**From `flows.yaml`** — `kind` (G6), the claim ids (G1, G10, G19), `starting-state` (G8), `notes` (G9):

```yaml
    kind: happy
    claims:
      - gitignore-is-honored
      - nested-gitignore-is-honored
      - git-info-exclude-is-honored
      - global-excludes-file-is-honored
      - truecourseignore-excludes-tracked-paths
      - truecourseignore-uses-gitignore-syntax
      - truecourseignore-patterns-are-anchored
      - truecourseignore-globstar-matches-any-depth
    starting-state:
      step-creatable:
        - the store and each analysis snapshot
      seedable:
        - "violation-bearing files at every exclusion source: root `.gitignore`, a nested `.gitignore`, `.git/info/exclude`, a repo-local `core.excludesFile`, and paths matched by `.truecourseignore`"
        - "one control file that is never excluded — without it, an empty report would 'prove' every exclusion claim at once"
        - "`.truecourseignore` bodies written in two stages: first with the three documented forms (comment, `src/generated/`, `scripts/ingest-epub.js`), then with `**/generated/` added"
        - a git repository and identity
        - env — `TRUECOURSE_HOME`, `TRUECOURSE_TELEMETRY=0`
      supplied: []
    notes: >-
      The anchoring claim and the globstar claim CONTRADICT each other in one
      file (`src/generated/` must leave `lib/src/generated/` analyzed, which
      `**/generated/` then excludes), so the scenario runs them as two stages of
      the same file with an analysis between them. `core.excludesFile` is set
      repo-locally inside the sandbox; the developer's real global git config is
      never touched, which is a hard requirement of this flow, not a detail.
```

**Scenario file header** (no field in `GuardCliScenarioSchema`):

```yaml
# Scenario for flow `exclude-generated-and-ignored-files-from-analysis`.
# Every excluded file carries a DIFFERENT violation, so each exclusion source is
# attributable to its own missing title. `src/app.js` is the control: if it ever
# disappears from the report, an empty analysis is masquerading as an exclusion.
#
# Files the git sources must exclude are left UNTRACKED on purpose — git does
# not ignore tracked paths, so committing them would test nothing.
```

**Setup comments** (authoring rationale for the seeds):

```yaml
      # control — never excluded by anything
      src/app.js: |

      # excluded by the root .gitignore
      ignored/root.js: |

      # excluded by the nested .gitignore
      src/nested/skip.js: |

      # excluded by .git/info/exclude (written as a step, after git init)
      hidden-by-info.js: |

      # excluded by the configured global excludes file
      vendored-global.py: |

      # tracked in git, excluded by .truecourseignore (directory pattern)
      src/generated/gen.py: |

      # tracked in git, excluded by .truecourseignore (specific file path)
      scripts/ingest-epub.js: |

      # NOT excluded by `src/generated/` — the pattern is anchored to the root.
      # The import cycle between these two is this depth's unique marker.
      lib/src/generated/a.js: |
```

**Setup fields with no store home** — `setup.seeds.git.identity` (G22):

```yaml
      identity: { name: TrueCourse Reference, email: reference@truecourse.test }
```

**Steps the step vocabulary cannot express** — 3 `write:`, 2 `git:` (G14, G15), quoted whole. The
header comment on each says where it sat in the run order:

```yaml
  # before store step 1
  - write:
      .git/info/exclude: |
        hidden-by-info.js
      .globalexcludes: |
        vendored-global.py
    expect:
      files:
        .git/info/exclude: { contains: hidden-by-info.js }

  # before store step 1
  - git: [config, core.excludesFile, "${sandbox}/.globalexcludes"]
    expect:
      exit: 0
    note: >-
      Set repo-locally and pointed inside the sandbox. The developer's real
      global git config is never read or written by this scenario — that is a
      hard requirement, not a detail.

  # after store step 2
  - write:
      .truecourseignore: |
        # generated
        src/generated/
        # specific files
        scripts/ingest-epub.js
    expect:
      files:
        .truecourseignore: { contains: "src/generated/" }

  # after store step 4
  - git: [ls-files, src/generated/gen.py, scripts/ingest-epub.js]
    expect:
      exit: 0
      stdout:
        matches: '^(?=[\s\S]*src/generated/gen\.py)(?=[\s\S]*scripts/ingest-epub\.js)[\s\S]*$'
    milestone: truecourseignore-excludes-tracked-paths
    note: >-
      Both files are still TRACKED by git while their violations are gone from
      the report — which is the entire point of `.truecourseignore` and what
      distinguishes it from `.gitignore`.

  # after store step 4
  - write:
      .truecourseignore: |
        # generated
        src/generated/
        **/generated/
        # specific files
        scripts/ingest-epub.js
    expect:
      files:
        .truecourseignore: { contains: "**/generated/" }
```

**Annotations lost from the surviving `run` steps** — the step comment, `cwd` (G16), `tty` (G17),
the claim-id `milestone` tags (G18, G19), `note` (G20), `expect.output` (G21). Each fragment is
headed by the store step it belongs to:

```yaml
  # store step 2 — run: [truecourse, list, --limit, "200"] (milestone: 1)
    milestone:
      - gitignore-is-honored
      - nested-gitignore-is-honored
      - git-info-exclude-is-honored
      - global-excludes-file-is-honored
    note: >-
      Four absences, one per git exclusion source, each attributable to its own
      file's rule: `ignored/root.js` (root .gitignore), `src/nested/skip.js`
      (nested .gitignore), `hidden-by-info.js` (.git/info/exclude) and
      `vendored-global.py` (core.excludesFile). The three PRESENT titles are the
      before-state the `.truecourseignore` claims are measured against — at this
      point nothing but git is excluding anything.

  # store step 4 — run: [truecourse, list, --limit, "200"] (milestone: 6)
    milestone:
      - truecourseignore-uses-gitignore-syntax
      - truecourseignore-patterns-are-anchored
    note: >-
      All three documented forms in one file — a `#` comment, a directory
      pattern, a specific file path — and both targets vanish from a report that
      carried them a moment ago. The surviving cycle under
      `lib/src/generated/` is the anchoring half: `src/generated/` matched the
      top-level directory only.

  # store step 6 — run: [truecourse, list, --limit, "200"] (milestone: 8)
    milestone: truecourseignore-globstar-matches-any-depth
    note: >-
      One added line and the nested `generated/` directory is excluded too,
      while the control file is still reported. This claim and the anchoring
      claim contradict each other inside one file, which is why they run as two
      stages with an analysis between them.
```

## A7. Tally

What this appendix preserves, by category. Counts are the authored instances, not lines.

| dropped detail | count | gap | section |
|---|---:|---|---|
| `flows.yaml` header comment (the coverage rules + dependency classes) | 1 | G6, G8 | A1 |
| `area` (single-level, forced into `product/concern`) | 1 | G29 | A2 |
| coverage ledger (totals, per-kind split, exactly-once check) | 1 | G12 | A3 |
| `authored-decisions` entries | 11 | G13 | A4 |
| gap claim ids | 14 | G1 | A5 |
| flow `kind` | 17 | G6 | A6 |
| flow `variant-of` | 3 | G7 | A6 |
| flow `starting-state` blocks | 17 | G8 | A6 |
| flow `notes` | 17 | G9 | A6 |
| flow claim ids (the flow→claim mapping) | 106 | G1, G10, G19 | A6 |
| `setup.seeds.git.identity` | 15 | G22 | A6 |
| `setup.seeds.git.root` | 1 | G23 | A6 |
| `setup.supplied` dependency entries | 5 | G24 | A6 |
| `git:` steps (quoted whole) | 46 | G14 | A6 |
| `write:` steps (quoted whole) | 20 | G15 | A6 |
| `delete:` steps (quoted whole) | 2 | G15 | A6 |
| — of which: claim-id `milestone` tags riding a dropped step | 18 | G14 | A6 |
| — of which: `note`s riding a dropped step | 21 | G20 | A6 |
| — of which: `cwd`s riding a dropped step | 6 | G16 | A6 |
| — of which: per-step `env` riding a dropped step | 1 | G14 | A6 |
| claim-id `milestone` tags on surviving `run` steps | 88 | G18, G19 | A6 |
| `note` on surviving `run` steps | 55 | G20 | A6 |
| `cwd` on surviving `run` steps | 6 | G16 | A6 |
| `tty: true` on surviving `run` steps | 6 | G17 | A6 |
| `expect.output` (combined stdout+stderr) | 3 | G21 | A6 |
| scenario file-header comments | 17 | — | A6 |
| setup comment blocks | 10 | — | A6 |
| step comment blocks (leading + in-body) | 14 | — | A6 |
| `flows.yaml` flow-group divider comments | 5 | — | A6 |

Step totals for orientation: the drafts hold 170 steps — 102 `run` (carried), 46 `git`, 20
`write`, 2 `delete` (all three kinds dropped). 106 claim ids ride milestones: 88 on `run` steps
(49 of which collapse to one `milestone` integer each, losing 39) and 18 on `git` steps (lost
with the step). Everything else the drafts authored — seeds, env, git commits, argv, `expect`
matchers, `stdin`, per-step `env`, titles, journeys, gap reasons — is carried by the store files.

