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

---

# The `spec` + `guard` journeys (authored 2026-08-08)

Appended, never rewritten: the sections above belong to the code-analysis area's
transform and are left exactly as they were. This section covers ONE layer of one
later area — the journeys of the `truecourse spec` and `truecourse guard` command
trees, derived from `tools/cli/src/**` (the source of truth) and cross-checked
against `reference/spec-docs/reference/cli.mdx` plus the `guard/*.md` pages.

What landed in `reference/store/.truecourse/guard/journeys.json`, additively, with
every pre-existing journey byte-identical and every pre-existing fingerprint
unmoved:

| journey | fingerprint | carried |
|---|---|---|
| `cli/spec` | `sha256:fc8c4d5ddb9203e73c8831381877c7c0ffd4539a860f994d7caa82312df2a956` | 19 commands · 50 options · 9 positionals · 17 prompts · 69 env · 104 reads · 162 output · 23 rows · 72 exits · 82 writes |
| `cli/guard` | `sha256:e9a6be7d4d84647db4b4451f8c57149baebd34a8d257f0f579db7b57877136bc` | 13 commands · 46 options · 2 positionals · 31 prompts · 43 env · 77 reads · 251 output · 41 rows · 62 exits · 53 writes |

Two things the authoring contract asks for have no schema home at all (G37, G38),
and six narrower facts could not be stated as facts (G39–G44). All of it is
preserved verbatim in Appendix B below.

## E. Gaps found authoring the spec + guard journeys

### G37. `diagnostics[]` has no store home — REOPENED by the 2026-08-07 narrowing
**What:** the authoring contract (`reference/AUTHORING.md` §2) requires every
code-versus-docs discrepancy to be recorded, code winning for grammar, so the
diagnostics are "the doc-bug feed; do not resolve them silently". This layer found
22 of them (Appendix B1): 11 grammar, 9 behavior, plus 2 agreements.
**Where it lived:** `Journey.diagnostics[]` (`{kind, subject, detail, right?}`),
landed 2026-08-07 and recorded CLOSED as G5 above. The same day's narrowing removed
it from `packages/shared/src/journeys.ts` — "Discrepancies the mapper finds at
derivation are transient run reporting, never stored journey data" (plan §7.2
STATUS). G5 is therefore stale as written: the field is gone again.
**What that costs:** nothing CONSUMES a transient diagnostic today either — there is
no run-reporting channel for the journey mapper, so a derivation that finds
`--story` documented and unregistered has nowhere to put it, and the doc bug is
found once and lost. The decision to keep diagnostics out of the ARTIFACT is
compatible with a run-report channel; that channel is the open work.
**Owner:** Guard Setup (produce them at derivation, into a run report), Guard
Generate (consume them).

### G38. `authored-decisions` still has no store home (the journeys half)
**What:** AUTHORING.md §2 requires each post-Phase-0 divergence to be recorded "in
the journeys file's authored-decisions section, same as the existing entries do".
There is no such section: `JourneyContractSchema` is `{summary, commands}` and
strict. 11 decisions (Appendix B2) — the Phase 0 deletions modeled out, the
modeling rule that bounds them, and the honest-provenance notes.
**Where it lived:** `contract.decisions[]`, removed by the same 2026-08-07
narrowing that removed diagnostics ("authored decisions … are REMOVED from the
schema and the data"). G13 above records the flows-file half of the same hole.
**Why it matters here specifically:** the reference is authored against a TARGET
that does not exist yet. Without the decision record, a reviewer cannot tell an
authoring omission (`--io` missing because the author forgot it) from a deliberate
Phase 0 deletion (`--io` missing because the agent transport is gone). That
distinction is the whole reviewability of a benchmark authored ahead of its engine.
**Owner:** the plan (§4/§5 own the divergence list); Guard Setup if the artifact is
ever meant to carry it.

### G39. There is no DELETE fact — only `writes`
**What:** `JourneyProducesSchema` carries `writes[]` (a path the command writes) and
nothing for a path it REMOVES. Three commands in this layer remove things as their
main effect:
- `guard generate` deletes a re-authored flow's prior scenario YAMLs
  (`deleteScenarioFiles`, `packages/guard-generator/src/serialize.ts`), and deletes
  a dismissed flow's tests entirely;
- `spec source remove` deletes a whole snapshot directory plus its registry entry;
- `guard flows undismiss` removes an entry from `decisions.json`.

A `writes` entry for a deleted path would be a lie, and omitting it means the
journey says a destructive command produces nothing. A scenario that wants to prove
"the file is gone" has no journey fact to read the path off.
**Owner:** Guard Setup (the io fact vocabulary).

### G40. A row template cannot contain literal angle brackets
**What:** `templateSlotNames` treats every `<…>` run in a template as a slot name,
and the schema then rejects any that no slot declares. Real output lines that quote
a command's own usage therefore cannot be stated as printed. The concrete case:
`spec conflicts list`'s footer is
``<open> open · <resolved> resolved. Inspect with `spec conflicts show <n|area>`.``
and the trailing sentence had to be moved into `when`, so the row fact no longer
carries the whole line. Any CLI that prints usage hints inside a summary line hits
this; there is no escape syntax.
**Owner:** Guard Setup (the row-fact schema).

### G41. A registered-but-removed flag has no structured marker
**What:** four options exist ONLY as compatibility tombstones — `guard recipe
--init`, `guard recipe --refresh`, `guard seed --init` (each exits 1 with a pointer
to `guard setup`) and `guard externals --list` (accepted, changes nothing). They are
not `hidden`: all four print in `--help` (probe-verified). The fact "passing this
does not do what its name says" lives only in the `description` prose, which the
schema's own doc comment says is not what the artifact is for. A worker reading the
grammar has no structured signal to avoid them.
**Owner:** Guard Setup (a `deprecated` / `tombstone` member on `JourneyOptionSchema`).

### G42. Prompt facts carry no order, grouping, or repetition
**What:** `guard setup` asks up to 16 questions in ONE interactive sequence (the
externals provisioning loop): a per-service confirm, a select, then six to eight
questions per service, an inner "add another env var?" loop, and a final write
confirm — repeated until the user stops. `consumes.prompts` is a flat array with no
order, no "these belong to one sequence", and no "this repeats per service". A
scripted TTY answer sequence is exactly an ordered list with repetition, so it
cannot be derived from the journey; an author has to read the source.
**Owner:** Guard Setup (prompt sequencing), Guard Generate (the consumer).

### G43. There is no "this stream is a JSON document" fact
**What:** seven commands have a `--json` mode whose entire stdout is one JSON
document (`spec status`, `spec conflicts list`, `spec conflicts show`, `guard
findings`, `guard drifts`). The io vocabulary can only say "this substring appears
on stdout", so the mode is recorded as markers on quoted key names (`"hasCorpus"`,
`"autoResolved"`). That is true and stable, but it says nothing about the output
being parseable JSON or what its shape is — which is the ONLY thing an agent
consumer cares about, and `guard findings --json` is explicitly documented as the
agent contract.
**Owner:** Guard Setup (io fact vocabulary).

### G44. `default` cannot say WHO applies the default
**What:** `guard drifts --limit` reads `(default: 20)` in help, but commander
declares no default: the action applies 20 when the flag is absent, and a
non-numeric value reaches the query layer as `NaN`. `JourneyOptionSchema.default` is
a bare value, so "declared by the parser" and "applied by the action" are the same
field — and only the second one can be wrong for out-of-range input. Recorded as
`default: 20` with the caveat in prose, exactly as the code-analysis area had to do
for `list --limit`.
**Owner:** Guard Setup (option schema).

### E-index. Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G37 (produce diagnostics into a run report), G39, G40, G41, G42, G43, G44 |
| the plan (§4/§5) | G38 |
| Guard Generate | G37 (consume), G42 (consume) |

---

# Appendix B: journey content the schema cannot carry, preserved verbatim

## B1. `diagnostics` — 22 doc-versus-code findings (G37)

Code wins for grammar. `right` names the side that is correct; an `agreement` kind
records a cross-check that came back clean, which is evidence too.

```yaml
diagnostics:
  # ---- grammar --------------------------------------------------------------
  - kind: docs-describe-nonexistent-flag
    subject: guard flows --story
    right: code
    detail: >-
      Two docs promise `--story`: the CLI reference row ("Flags: `--show <id>`,
      `--story` (with `--show`: the flow's committed tests in plain words)") and
      guard/generate.md, which both shows `truecourse guard flows --show <id>
      --story` and states "`--story` prints the same words in the terminal". The
      code registers `--show <id>` and nothing else, so `--story` is an unknown
      option and exits 1. Phase 0 §5 deletes scenario Story mode outright, so the
      fix is a doc deletion, not a flag.
  - kind: docs-missing-flag
    subject: guard recipe --init
    right: code
    detail: >-
      Registered and printed in `--help` ("Removed — `truecourse guard setup`
      derives the recipe"); it exits 1 with a pointer to setup. The CLI reference's
      `guard recipe` row lists no flags at all, so a script that still passes it
      finds no documentation of what happened.
  - kind: docs-missing-flag
    subject: guard recipe --refresh
    right: code
    detail: >-
      Same tombstone as `--init`, same silence in the docs. Note the collision
      hazard: `guard setup --refresh` is real and does re-derive, while `guard
      recipe --refresh` is a hard error.
  - kind: docs-missing-flag
    subject: guard seed --init
    right: code
    detail: >-
      Registered, printed in `--help`, exits 1 with a pointer to `guard setup`.
      Undocumented in the CLI reference and in guard/seeding.md.
  - kind: docs-missing-flag
    subject: guard externals --list
    right: code
    detail: >-
      Registered and printed in `--help` ("Kept for compatibility — the view is
      this command's only behaviour"). Unlike the three tombstones above it is
      accepted silently and changes nothing. Undocumented.
  - kind: docs-narrows-grammar
    subject: spec docs include <path...> / spec docs exclude <path...>
    right: code
    detail: >-
      guard/spec-scan.md writes both as `<path>` singular ("Force-include a skipped
      doc"), and the whole point of the batch form is that recording five docs costs
      ONE re-scan instead of five. The CLI reference row has the variadic form
      right, so the two doc pages disagree with each other as well as with the code.
  - kind: docs-missing-flag-detail
    subject: guard drifts --limit / --offset
    right: code
    detail: >-
      The CLI reference row lists them as bare `--limit`, `--offset`; both take a
      required `<n>`. The same table spells `--show <id>`, `--kind <class>` and
      `--flow <id>` with their values, so this is an omission, not a convention.
  - kind: docs-overstated-behavior
    subject: spec conflicts resolve --json
    right: code
    detail: >-
      guard/conflicts.md opens with "Resolve conflicts from the CLI (agent-friendly;
      every command has `--json`)". `spec conflicts resolve` has no `--json` flag —
      only `list` and `show` do. An agent driving `resolve` gets clack decoration on
      stdout with no machine-readable form at all, and every one of its validation
      errors is a `p.cancel` on STDOUT rather than a line on stderr.
  - kind: choices-not-in-grammar
    subject: guard findings --kind
    right: both
    detail: >-
      The docs state a closed set (`drift | defect | escalation`) and the action
      enforces it (an unknown value exits 1 rather than silently matching nothing),
      but commander registers a free `--kind <class>`, so `--help` prints no
      `(choices: …)` clause and the failure lands at run time instead of parse time.
      Identical shape to `list --severity`. The docs are right about the set; the
      grammar should declare it.
  - kind: post-phase-0-divergence
    subject: --llm-transport <cli|agent|api>
    right: code
    detail: >-
      Code and docs agree today (the probe prints `(choices: "cli", "agent", "api")`
      and the CLI reference's analyze row spells `<cli|agent|api>`). Phase 0 §5
      deletes the agent transport, so the reference models `cli | api` and BOTH the
      code and the docs owe an update. Recorded as a diagnostic, not silently, so
      the doc edit is not forgotten when the code change lands.
  - kind: post-phase-0-divergence
    subject: --io <dir>
    right: code
    detail: >-
      Documented on `spec scan`, `guard generate` and `guard setup`, and registered
      on all three. Its only purpose is the agent transport's request/response
      mailbox, which Phase 0 §5 deletes, so the reference models the flag as absent
      and the three doc cells that name it have to go with it.
  - kind: grammar-agreement
    subject: the spec tree
    right: both
    detail: >-
      Every other grammar fact of the 19 spec commands matches the CLI reference
      exactly: the command set, every flag, every value hint, and the positional
      arity of `show <n|area>`, `resolve [targets...]`, `include/exclude <path...>`,
      `uninclude/unexclude <path>`, `add <llms-txt-url>`, `refresh [id]`,
      `remove <id>`. Verified against `--help` on all 19 paths.
  - kind: grammar-agreement
    subject: the guard tree
    right: both
    detail: >-
      Every other grammar fact of the 13 guard commands matches: the command set and
      its registration order, `run --scenario/--verbose`, `generate -y/--yes`,
      `setup --refresh/-y`, `flows --show <id>` plus the `dismiss`/`undismiss`
      subcommands with `<flow-id>`, `findings --flow/--json`, `drifts --all/--json`.
      Verified against `--help` on all 13 paths.

  # ---- behavior -------------------------------------------------------------
  - kind: docs-missing-behavior
    subject: the non-interactive estimate, and its three-way inconsistency
    right: code
    detail: >-
      With no TTY and no `-y`, `spec scan` and `guard generate` print "Cannot prompt
      for confirmation non-interactively. Pass --yes to approve the estimate.",
      cancel, and exit ZERO having written nothing — a CI job reads that as success.
      `guard setup` in the same situation prints "Re-run with `-y` to proceed
      non-interactively." and exits ONE. Three commands, two answers, and the docs
      describe only "`-y` / `--yes` skips it". This is a product defect as much as a
      doc gap: a silent successful no-op is the worst of the three behaviors.
  - kind: docs-missing-behavior
    subject: guard run and BLOCKED scenarios
    right: code
    detail: >-
      The CLI reference says `guard run` "exits non-zero on any drift" and
      guard/run.md sells it as a CI gate. A scenario whose supplied dependency has
      no registered instance is `blocked`, which is deliberately NOT drift: the run
      prints "Every section that ran succeeded — some never ran." and exits 0. A CI
      gate on a repo with no registered instances therefore passes green while
      proving nothing, and no doc says so.
  - kind: docs-missing-behavior
    subject: spec docs skipped and the four override commands spend LLM calls ungated
    right: code
    detail: >-
      `spec docs skipped` recomputes the skipped set by running the FULL curate
      pipeline (`curateInProcess(root, {skipCorpusWrite: true})`), and `include`,
      `uninclude`, `exclude`, `unexclude` each run a complete re-curate. Cached
      verdicts make the common case free, but a doc that changed costs real calls —
      with NO pre-flight estimate and NO confirmation on any of the five, unlike
      `spec scan`. The docs present them as list/override operations; only
      include/exclude even say "(re-scans)".
  - kind: docs-vs-code-detail
    subject: guard drifts --json ignores pagination
    right: code
    detail: >-
      The `--json` branch returns before pagination is applied, so `--limit`,
      `--offset` and `--all` have no effect and the payload is always the whole set.
      The CLI reference lists all four flags in one cell as if they compose.
  - kind: docs-missing-detail
    subject: guard status also prints the externals footprint
    right: code
    detail: >-
      The CLI reference describes the rows as "setup state, section coverage, last
      run, last generate". It also renders the external-services block (the same
      renderer `guard externals` uses) and the per-dependency blocked lines of the
      last run. Silent only when the repo has no third party.
  - kind: docs-missing-behavior
    subject: guard flows dismiss / undismiss refuse an unknown id
    right: code
    detail: >-
      `dismiss` requires an id the flow corpus actually synthesizes (a dismissal for
      an id that never appears would sit in decisions.json matching nothing);
      `undismiss` requires an id that is actually dismissed. Both exit 1 and name
      the known ids. Documented as if the writes always succeed.
  - kind: docs-missing-detail
    subject: guard setup's seed-replace confirm in a non-TTY
    right: code
    detail: >-
      The CLI reference says `--refresh` "asks before replacing an existing seed
      script". In a non-TTY the answer is NO unless `-y` was passed — `--refresh`
      alone never clobbers a hand-edited seed — and `-y` without `--refresh` never
      reaches the question at all.
  - kind: docs-missing-detail
    subject: TRUECOURSE_DEV
    right: code
    detail: >-
      The CLI reference's environment table lists `TRUECOURSE_LLM_LOG` and
      `TRUECOURSE_LLM_DUMP` but not `TRUECOURSE_DEV`, which turns the full
      prompt/response io dump on by default and makes the logger announce itself on
      stderr. It is set by `pnpm dev`, so a developer's runs behave differently from
      the documented ones.
  - kind: docs-missing-behavior
    subject: spec conflicts resolve mode exclusivity
    right: code
    detail: >-
      Exactly ONE of `--right` / `--dismiss` / `--recommended` is required (neither
      and both exit 1). `--right` takes exactly one conflict and rejects `--area`.
      `--area` rejects positional targets. A target list mixing indexes and an area
      id is rejected. An area form that matches several conflicts is rejected with a
      pointer to address one by number. The docs list the five flags in one cell
      with no constraint stated.
```

## B2. `authored-decisions` — 11 decisions (G38)

```yaml
# Decisions taken while authoring the spec + guard journeys, and the Phase 0
# deletions they model. These are the parts most worth a reviewer's argument.
authored-decisions:
  - id: model-is-the-code-today-minus-exactly-phase-0
    decision: >-
      The journeys model the CLI as the CODE defines it today, with exactly the
      deletions plan §5 (Phase 0) names applied, and nothing else. Everything
      §§7.4–7.8 will later change — the setup step taxonomy (recipe → detect →
      catalog → journeys → auth), the dependency catalog absorbing `api.externals`
      and `externals.local.json`, the retirement of the externals and seed setup
      steps, the recipe's `expose` block — is NOT applied, because those surfaces
      are designed but not decided down to their grammar. Applying a half-decided
      redesign would make the benchmark unfalsifiable; each pending change is
      recorded instead.
  - id: no-agent-transport
    decision: >-
      Phase 0 §5 deletes the agent transport, so `--llm-transport` is modeled with
      choices `cli | api` (the code declares `cli | agent | api`) and `--io <dir>`
      is modeled as ABSENT on all three commands that register it (`spec scan`,
      `guard generate`, `guard setup`) — its only purpose is the agent mailbox.
      Three consequences are modeled out with it: the "`--llm-transport agent`
      requires `--io <dir>`" error and its exit 1 on generate and setup, and the
      "agent transport implies auto-approve" branch, so `-y` / `--yes` is the ONLY
      auto-approval in the post-Phase-0 grammar.
  - id: no-api-surface-generation
    decision: >-
      Phase 0 §5 deletes API generation end to end, so no api journeys exist:
      `guard generate` authors cli scenarios only and `guard flows`' surface chips
      only ever read `cli`. `guard status`'s per-driver classification line is
      therefore modeled as a row with a TEXT slot (`<byDriver>`) rather than a
      template with the seven driver ids baked in — WHICH drivers survive Phase 0
      is not decided, and spelling today's list into the template would encode a
      guess as a fact.
  - id: apis-stay-as-external-services
    decision: >-
      `guard externals` and every recipe external declaration are modeled in full:
      Phase 0 removes the API as a VERIFIED surface, not as a dependency of a CLI
      scenario. The externals-need-api coupling Phase 0 also deletes is already gone
      from the CLI (`provisionExternals` stands down only on an unreadable recipe,
      never on a missing `api` block), so nothing had to be modeled out for it.
  - id: guard-seed-is-modeled-and-flagged
    decision: >-
      §7.6 says the api seed leaves with Phase 0, but §5 does not name the `guard
      seed` COMMAND and no replacement surface is decided. Deleting it would leave
      the catalog incomplete for the CLI as it stands, so it is modeled as the code
      defines it — including its one api-block-specific line ("No seed yet — the
      recipe has no `api` block, so there is no api driver to seed for", which a
      probe confirms is also what a repo with NO recipe prints). Recorded here so
      the surface that has to change is visible rather than quietly resolved.
  - id: group-commands-carry-an-empty-prompt-list
    decision: >-
      The first-run LLM wizard runs from commander's `preAction` hook, which fires
      only for a command with an action handler. `spec`, `spec conflicts`, `spec
      docs`, `spec source` and `guard` therefore carry an EMPTY `prompts` array —
      the established "never asks anything" — not an omitted one. `guard flows` HAS
      an action, so it carries the prompt; and for the same reason commander gives
      it no implicit `help [command]` subcommand, which the probe confirms and the
      contract records.
  - id: help-and-version-are-program-scoped
    decision: >-
      `--help` / `-h` and `--version` / `-V` appear on every command with
      `scope: program`, matching the code-analysis area. Commander adds `-h/--help`
      per command and resolves `-V/--version` program-wide; neither prints in a
      subcommand's own help output (probe-verified), yet both work there.
  - id: the-first-run-wizard-write-is-recorded
    decision: >-
      Every action command carries `~/.truecourse/config.json` as a write, gated on
      "the first-run wizard was answered". The code-analysis area's journeys omit
      it. It is a true fact of every command's contract — the wizard saves the
      selection before the command's own work begins — so it is stated here rather
      than dropped for cross-area consistency. The code-analysis journeys are the
      ones with the gap.
  - id: unenumerable-env-vars-are-named-as-a-class
    decision: >-
      `guard run` reads whatever env vars the recipe's credentials and external
      services declare; `guard setup` reads whatever shell variable a `from-env`
      answer names; `guard externals` resolves whatever a declared service's
      `valueFromEnv` points at. No list exists for an arbitrary repo, so each is ONE
      entry with a bracketed class name (`<the recipe's declared credential and
      external env vars>`) carrying the consequence in its `when` — the same
      placeholder idiom the existing reads use for `<cwd ancestors>/.truecourse/`.
      Omitting them would read as "this command needs no environment", which is the
      opposite of true.
  - id: repo-resolution-is-cwd-not-an-ancestor-walk
    decision: >-
      Unlike `list` and `rules`, every spec and guard command resolves its store
      from `process.cwd()` directly — there is no walk up to the nearest
      `.truecourse/`. The read facts therefore name `<cwd>/.truecourse/…`, and the
      "no TrueCourse project found here" exit those commands have does not exist
      here. Modeled as the code does it; recorded because the difference between the
      two families is invisible in the docs.
  - id: probe-verified-where-a-probe-could-reach
    decision: >-
      Every grammar entry was verified by running `--help` on all 32 command paths
      against the built CLI, and every empty-state marker and exit code was verified
      by running the read-only commands in a scratch directory with an isolated
      `TRUECOURSE_HOME`. Facts a probe cannot reach without spending money or
      mutating a repo (a real scan, a real generate, a real run) were read from the
      source; they are marked by their `when` conditions and by nothing else, and
      where the source did not settle a fact it is absent rather than guessed.
```

## B3. Tally

| dropped detail | count | gap | section |
|---|---:|---|---|
| `diagnostics` entries (11 grammar, 9 behavior, 2 agreement) | 22 | G37 | B1 |
| `authored-decisions` entries | 11 | G38 | B2 |
| delete facts (`guard generate` scenario files, `spec source remove` snapshot, `guard flows undismiss` entry) | 3 | G39 | — |
| row template truncated to dodge a literal `<…>` | 1 | G40 | — |
| tombstone / compatibility flags with no structured marker | 4 | G41 | — |
| interactive prompts with no sequence, order or repetition (`guard setup` provisioning) | 16 | G42 | — |
| `--json` modes with no "stdout is one JSON document" fact | 5 | G43 | — |
| action-applied (not parser-declared) defaults | 2 | G44 | — |

Everything else the layer established — the full grammar of 32 commands, 96 options,
11 positionals, 48 prompts, 112 env reads, 181 read paths, 413 output markers, 64 row
grammars, 134 exit conditions and 135 written paths — is carried by
`Journey.contract` and parses against `JourneysFileSchema` unchanged.

---

# F. Gaps found authoring the spec-consolidation + guard CLAIMS

The claims layer for `truecourse/spec-consolidation` (3 docs) and `truecourse/guard`
(7 docs): 482 claims and 107 untestable statements appended to
`.truecourse/scenarios/claims.json`. Every field the layer authored is carried by
`GuardClaimSchema` except the two below.

### G45. A claim's `needs` has no field — the vocabulary went away with the schema narrowing
**What:** `reference/AUTHORING.md` §1 requires, per claim, both how a scenario
observes it AND "what it needs (llm-transport, supplied project, committed
baseline, and so on; open vocabulary)". Only the observation has a field
(`verifyVia`). This layer's claims need an llm-transport (every scan/setup/generate
claim), a supplied docs corpus, a registered web source, an OpenAPI document, a
committed scenario corpus, a datastore, an external-service account, and a terminal
for the prompt claims.
**Where it lived:** `GuardClaim.needs[]`, landed as the fix for G3 above and
documented there as "deliberately an OPEN string list". It is gone from
`packages/shared/src/guard/claims.ts`, which is now `.strict()` with
`{id, doc, anchor, title, claim, contentHash, verifyVia}` and states the reason:
"What testing it would take is the dependency catalog's answer … neither belongs on
the claim, where they were a second, staler copy." G1 and G3 above are stale as
written: both `needs[]` and `notes` are gone.
**What that costs:** the dependency catalog (`scenarios/dependencies.json`) keys its
requirements by FLOW (`needs[].flowId`), so a claim that reaches no flow — a gapped
or blocked claim, exactly the ones whose requirement matters most — carries its
requirement nowhere. This layer parked each one as prose inside `verifyVia`
("with an llm-transport configured", "with the network unavailable"), which is a
sentence, not a binding: nothing can read it, and it drifts from the catalog.
**Owner:** Guard Setup (the dependency catalog — either a claim-keyed requirement,
or a documented rule that requirements are flow-keyed and AUTHORING.md §1 drops the
per-claim half).

### G46. A collapsed same-doc restatement has no structured link to the claim that absorbed it
**What:** AUTHORING.md §1 says to "collapse same-doc restatements into one claim
with a note". There is no note field on either half of the record: `GuardClaimSchema`
dropped `notes` with the narrowing, and `GuardUntestableStatementSchema` is
`{doc, anchor, text, reason}` with, by design, "no `title` and no id — it is not an
object anything can bind to". 14 statements in this layer are collapsed restatements
(for example run.md's "non-zero on any drift" under `guard-run/in-ci`, restating the
lead; external-services.md's key-rotation sentence, restating the fingerprint claim).
**What that costs:** the collapse is recorded as an `untestable[]` entry whose
`reason` names the absorbing claim in prose ("same-doc restatement of X; collapsed
into that claim"). It reads correctly and keeps extraction auditable, but it is
indistinguishable, to any consumer, from a statement refused as marketing or as
dashboard surface — and if the absorbing claim is later retitled or deleted, nothing
detects the dangling pointer, unlike every other claim reference which
`crossCheckClaimRefs` resolves at load.
**Owner:** Guard Generate (extraction writes both halves; a `collapsedInto` claim id
on the untestable entry would fall into the same cross-check).

### F-index. Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G45 |
| Guard Generate | G46 |

---

# G. Gaps found authoring the spec-consolidation FLOWS + SCENARIOS

The flow and scenario layer for `truecourse/spec-consolidation` (spec-scan.md,
web-sources.md, conflicts.md): 13 flows carrying 81 of the area's 99 claims, 13 cli
scenarios, 18 `noFlowClaims`, and two new supplied dependencies
(`spec-docs-project`, `llms-txt-site`). Every file parses against the real Zod
schemas and `loadScenarios` returns zero load errors and zero claim-ref errors.

**11 of the 18 gaps are capability gaps, not doc problems** — G47 to G51 below are
the reason those claims have no scenario. That ratio is the finding: the claims are
testable, the cli driver cannot reach them yet.

### G47. A file matcher carries ONE content assertion per path and no regex
**What:** `spec-scan-writes-corpus-json` states that `corpus.json` holds five things
(kept docs, their area tags, the docs grouped by area, the overlap flags, and the
relevance-dropped docs with path and reason). `GuardFileMatcherSchema`
(`packages/shared/src/guard/scenario.ts`) is `{exists|absent|equals|contains}`: one
`contains` per path, no `matches`, and a `files` record keys by path so the same file
cannot appear twice in one step.
**What that costs:** the claim is tagged across FOUR steps of
`curate-a-repository-of-docs-into-a-spec-corpus`, each reading one part through a
different command (the scan's own rows, `spec docs list`, `spec status`), with only
`"skippedDocs"` read from the file itself. That works, but it means a multi-part
claim about one artifact is authored as a scattered proof rather than one assertion,
and any structured assertion about a JSON file's SHAPE (a key with a non-empty value,
an array with at least one element) is unavailable — `contains` on a serialized
fragment is the only tool, and it breaks on any formatting change.
**Owner:** Guard Generate (scenario schema — a `matches` file matcher, and a list of
matchers per path).

### G48. The cli driver cannot carry a value from one step's output into a later step
**What:** several documented commands take an argument that only EXISTS at run time:
`spec conflicts resolve <n> --right <docPath>` takes one of the two disputing doc
paths, `resolve --area <id>` and `spec conflicts show <area>` take an area id the
model assigned. Both are printed by `spec conflicts list`. The api driver has
`capture` (`GuardApiRequestStepSchema`) for exactly this; the cli driver has nothing.
**What that costs:** four claims gapped —
`spec-conflicts-resolve-right-picks-a-side`,
`spec-conflicts-resolve-area-dismisses-a-whole-area`,
`spec-conflicts-show-accepts-an-index-or-an-area`, and
`spec-conflicts-losing-side-is-suppressed-at-generate`, which needs a `--right`
verdict before anything else. Index-addressed conflicts are reachable because `1` is
a literal; nothing else about a bound corpus is. The workaround the corpus refused —
seeding two contradicting documents so their paths are known — would have graded the
scenario's own fixture instead of the detector, and would still not have made the
area id knowable.
**Owner:** Guard Generate / runner (a cli `capture`: a named regex group over a
step's stdout, interpolated like `${supplied:…}` into later argv).

### G49. A cli step cannot be interrupted mid-flight
**What:** `spec-scan-resumes-from-cache-after-an-interruption` needs a scan that
stopped part-way (the doc's example is an LLM usage limit) and then a re-run. A cli
step runs to completion or to its `timeoutMs`, and an overrun is classified as
infrastructure (`error`), never a step outcome. The api driver has `signal`
(`GuardApiSignalStepSchema`); the cli driver has no counterpart.
**What that costs:** one claim gapped. It is also the shape of every partial-progress
claim the other areas will hit (a generate interrupted between flows, a run
interrupted between scenarios).
**Owner:** Guard Generate / runner (a cli `signal` step, or a step option that sends
SIGINT after N ms and treats the exit as the step's own outcome).

### G50. The cli sandbox has no network-egress control
**What:** `sandbox.ts` says it outright — "Network-egress blocking is intentionally
OUT of scope for the CLI driver in this phase". web-sources.md makes two claims about
exactly that boundary: only `spec source add` and `spec source refresh` touch the
network, and `spec scan` reads the snapshot and stays offline.
**What that costs:** two claims gapped. While every step can reach the network, a
command that completes proves nothing about whether it went out — and the honest
proof (run it with the network cut) is unavailable.
**Owner:** Guard Setup / runner (per-step egress control; the api driver's loopback
proxy for provided externals is the nearest existing machinery).

### G51. Nothing relates one step's observation to another's
**What:** three claims in this area are comparisons between two runs: the real bill
lands at or below the estimate (estimate on one stream, actual cost only in
`.truecourse/logs/llm-spec-scan-<runId>.summary.json`), two runs over an unchanged
corpus print the same numbers, and a scan after the cache was deleted "reproduces the
same corpus". Every matcher in the format is scoped to ONE step's own streams and
files; there is no cross-step capture, no stored value, and no arithmetic.
**What that costs:** one claim gapped outright
(`spec-scan-real-bill-lands-at-or-below-the-estimate`) and two claims proved on their
single-run half only, with the comparison half written down in the step note instead
of asserted (`spec-scan-prints-a-token-and-ceiling-cost-estimate`,
`spec-scan-cache-is-safe-to-delete`). A step note is documentation, not a verdict.
**Owner:** Guard Generate (the same cli `capture` as G48 would carry the first half;
a numeric comparison matcher is a separate, larger question).

### G52. A supplied dependency's fields gate as one unit, so an edge flow blocks the happy one
**What:** `llms-txt-site` declares two fields: `llms-txt-url` (a site that publishes
an index) and `no-llms-txt-url` (one that does not — the negative case
`refuse-a-site-that-publishes-no-llms-txt` measures a refusal against). A supplied
entry is `provided` only when every non-optional field resolves
(`dependencyBlockFor`, `packages/guard-runner/src/dependencies.ts`), so an instance
registering only the first blocks all four flows that bind the entry, including three
that never reference the second field.
**Why `optional` is not the answer:** `optional: true` means the field never gates and
never resolves; a `${supplied:…}` token naming it still throws unless it sits inside
an `optional:` argv PAIR, which drops both halves. That is right for a flag with a
working default (`--base-url`) and wrong for a positional the command cannot run
without.
**What that costs today:** either one dependency entry whose blocking is coarser than
its use, or one entry per field, which fragments a single real-world thing (one
documentation site) into unrelated catalog rows.
**Owner:** Guard Setup (per-FIELD provisioning: a scenario blocks on the fields its
own steps reference, not on the entry's whole declaration).

### G53. A gap can be blocked on a precondition nobody is able to register
**What:** `spec conflicts resolve <n> --recommended` needs a flagged overlap that the
verify pass attached a recommendation to, and the `fix-doc` variant needs one whose
recommendation is specifically `fix-doc`. Whether a recommendation exists is the
model's judgment over the bound documents — it is not a property of the instance a
user can supply, so it cannot be contributed as a `needs[]` requirement.
**What that costs:** two claims recorded as `blocked-on` gaps whose blocker nobody can
clear, which is precisely the outcome `guardNoFlowClaimGapKind`'s doc warns about
("inventing one would put a to-do on a user's list that nothing can ever clear") —
except here the blocker is real and merely unactionable. There is no gap kind for
"reachable only when the pipeline's own output happens to take a particular shape".
**Owner:** Guard Generate (either a gap kind for a non-deterministic precondition, or
a way for a scenario to SKIP a step whose precondition the corpus does not exhibit,
reported as an unproven milestone rather than a failure).

### G54. `noFlowClaims` has no gap-kind field — the kind is parsed back out of the prose
**What:** `guardNoFlowClaimGapKind` (`packages/shared/src/guard/flows.ts`) re-derives
`no-journey | blocked-on | unrealizable | untestable` from the reason SENTENCE with an
ordered regex ladder, and the default is `untestable`.
**What that costs:** authoring is writing to a parser. Each of this layer's 18 reasons
had to be phrased so the ladder classifies it — a reason that happens to contain "no …
journey" is reclassified, and one that names an unreachable blocker without the words
"blocked-on"/"needs"/"requires" silently becomes `untestable`, which is a materially
different verdict for a reader deciding whether to act. The classification of the
18 was verified by running the ladder over them (14 `blocked-on`, 4 `unrealizable`)
rather than being stated by the record itself.
**Owner:** Guard Generate (a `kind` field on `GuardNoFlowClaimSchema`, with the ladder
kept only as the reader for records written before it).

### G-index. Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G50 (shared with the runner), G52 |
| Guard Generate | G47, G48, G49, G51, G53, G54 |

# H. Gaps found authoring the guard FLOWS + SCENARIOS

The flow and scenario layer for `truecourse/guard` (overview.md, recipe.md, setup.md,
external-services.md, seeding.md, generate.md, run.md): 16 flows carrying 132 of the
area's 383 claims, 16 cli scenarios, 251 `noFlowClaims`, and one new supplied
dependency (`guard-subject-project`). Every file parses against the real Zod schemas,
`loadScenarios` returns zero load errors and zero claim-ref errors, all 120 bindings
resolve as exact matches against the live section index, and the 11 hand-written probe
scenarios the flows commit into their sandboxes parse against `GuardScenarioSchema`
too.

**The headline is the ratio, and it is not a schema problem.** 251 of 383 claims carry
no flow, and 175 of those 251 are blocked on ONE thing: the api driver and the api
block, which Phase 0 (§5 of the plan) deletes from the target this corpus models.
seeding.md is 37 of 37 gapped; recipe.md's three api sections are 64 of 64;
external-services.md is 43 of 52. That is the honest post-Phase-0 picture of these
pages, and it says something the plan should absorb: **two of the seven pages in this
area, and three whole sections of a third, document a surface the MVP will not have.**
Two further families are worth naming before the schema items:

- **The Phase-0 externals decoupling is the single highest-value unblock.** Eighteen
  claims (`setup declares every detected external API`, the declaration/fingerprint
  pair, the local-overlay and `valueFromEnv`/`value` set, the provided/unprovided/
  incomplete states, the interactive fill-in) become realizable the moment
  the externals-need-api coupling in `applyExternalsSkeleton`
  (`packages/guard-generator/src/setup.ts`) goes, because a CLI-only recipe would then
  get a declaration skeleton to observe. They are gapped rather than authored red on
  purpose: a red test whose cause is "a planned deletion has not landed" reads as
  drift, and drift is what this corpus reserves for the code and the doc disagreeing.
- **The doc will need edits Phase 0 forces.** `there are two drivers today: cli and
  api` (twice, overview.md and generate.md) and `guard catches any behaviour drivable
  through the CLI **or** its HTTP API` are doc statements Phase 0 falsifies. They are
  recorded as gaps naming the deletion rather than asserted, because the corpus cannot
  assert a count it expects to be wrong.

### G55. A cli matcher is textual, so a claim about a VALUE'S TYPE has no form
**What:** `guard-catches-missing-or-mistyped-output-fields` is a disjunction: a missing
output field and a mistyped one. The missing half is assertable — a stream matcher
naming a marker the program never prints fails the scenario. The mistyped half is a
JSON-value notion, and every cli matcher (`GuardStreamMatcherSchema`,
`GuardFileMatcherSchema` in `packages/shared/src/guard/scenario.ts`) compares TEXT.
The api driver has `GuardJsonMatcherSchema` for exactly this; the cli driver has
nothing.
**What that costs:** one claim gapped, and the same hole will reappear for every CLI
that emits JSON (`guard drifts --json`, `guard findings --json`, `truecourse list
--json`): a scenario can assert that a token appears in the output and never that the
value at a path is a number rather than a string.
**Owner:** Guard Generate (a `expect.json` matcher on the cli driver's `run` step,
scoped to a step that declares its stdout is a JSON document).

### G56. A `write` step replaces a whole file, so a one-field edit of a bound instance is impossible
**What:** three claims turn on EDITING the recipe of the repository under test —
`recipe-edits-re-author-sections-generated-against-the-old-recipe`,
`guard-setup-editing-the-recipe-re-authors-every-section-against-it`, and (from the
other side) `guard-setup-refresh-replaces-the-recipe-only-if-it-verifies`, which needs
the registered repository's own build script broken. `GuardWriteStepSchema` takes
`path → whole content`; there is no patch, no JSON-pointer set, no append. A supplied
instance's `recipe.json` and `package.json` are its own content, so replacing them
wholesale is either impossible (the content is unknown) or a content-exact assertion
the rules forbid.
**What that costs:** three claims gapped, and one flow
(`detect-the-third-parties-the-repository-calls`) forced to DELETE the subject's recipe
and write a minimal replacement just to add a two-element `ownHosts` array — which
works only because `guard setup` reuses an existing recipe without verifying it.
**Owner:** Guard Generate / runner (a `patch` step: set/merge/remove at a JSON path, or
a line-anchored append, for files the scenario did not author).

### G57. Every argument of the flow-curation surface is a run-time id, so the whole surface is unreachable
**What:** G48 recorded the cli driver's missing `capture` against four
spec-consolidation claims. In this area the same hole takes out an entire command
group: `guard flows --show <id>`, `guard flows dismiss <flow-id>` (and `--note`),
`guard flows undismiss <flow-id>`, `guard findings --flow <id>`, and the two claims
about what the NEXT generate does with a dismissal. A flow id exists only after a
generate has run against the bound repository, it is printed only by `guard flows`, and
nothing carries it from that output into a later argv.
**What that costs:** seven claims gapped, and the shape of the loss matters more than
the count: the curation surface — the one place a user overrides what guard tests — has
no coverage at all, in an area whose whole subject is guard.
**Owner:** Guard Generate / runner (the cli `capture` of G48: a named regex group over a
step's stdout, interpolated like `${supplied:…}` into later argv, env and file content).

### G58. A `noFlowClaims` entry carries prose and nothing else, so gaps cannot be grouped or cleared as a set
**What:** `GuardNoFlowClaimSchema` is `{doc, anchor, claimTitle, reason}`. G54 already
noted that the KIND is parsed back out of the reason; at 251 entries the missing field
is a BLOCKER IDENTITY. 182 of this area's gaps are blocked on the same thing (the api
driver), 9 on the same Phase-0 coupling, 7 on the same missing cli capture — and the
only thing that says so is the wording of 251 sentences, which no surface can group,
count, or mark cleared when the blocker goes.
**What that costs:** the reader cannot ask "what does the api driver's return unblock?"
and the engine cannot answer "these 182 gaps are now stale". Every reason in this layer
had to repeat its blocker in prose so a human grep can approximate the query.
**Owner:** Guard Generate (a `blockedBy` key on `GuardNoFlowClaimSchema` — a short
stable token, open vocabulary, beside the sentence; the reason stays the human half).

### G59. A committed scenario's world is hermetic, so only the recipe env can make it change verdict
**What:** `guard-run-red-at-birth-comes-back-green` (and its overview twin) needs ONE
committed test to fail and then pass with no re-authoring. A scenario sandbox is a
fresh cwd with an allowlist-built environment (`packages/guard-runner/src/sandbox.ts`),
so nothing an outer scenario changes in the repository reaches inside it — except the
recipe's declared `env`, which is the one layer the sandbox copies through.
**What that costs:** the claim IS realized, but through the recipe's env (the probe
reads a value with `git config --get`) rather than through the repository's own source,
because a scenario may not assert content-exact behaviour of a registered instance.
"The code catches up" is therefore proved as "the declared world catches up". A driver
that could observe a repo-root file, or a scenario-visible workspace, would let the
claim be proved in the words the doc uses.
**Owner:** Guard Setup / runner (a declared read-only mount of the repository root into
the scenario sandbox, or a `repo:` file matcher).

### H-index. Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G59 (shared with the runner) |
| Guard Generate | G55, G56, G57 (shared with the runner), G58 |
| Phase 0 | the externals-need-api decoupling (18 claims) and the two-drivers doc edits (4 claims) |

## The api surface wave (2026-08-09)

The plan's §5 reversal put the api surface back, so the 197 gaps whose reason blamed
its deletion were re-read against the engine that actually exists. 76 of them became
milestones of 8 new flows, all cli-driver, all bound to the new supplied class
`api-subject-project`; 121 kept a gap with a reason naming the capability that really
stands in the way. Two earlier items are partly overtaken by that re-reading and are
left standing rather than edited: **G56**'s missing JSON edit now exists as the `patch`
step (its non-JSON half survives as G61 below), **G57**'s missing cli `capture` now
exists (the flow-curation claims it covers are still gapped for their own reasons), and
**G58**'s "182 of this area's gaps are blocked on the api driver" is now zero — which is
itself the argument for the `blockedBy` key that item asks for, since nothing but a
grep could have found those 182 sentences to rewrite.

### G60. `expect.files` has no pattern matcher, so a generated file can only be read by substring
**What:** `GuardFileMatcherSchema` offers `exists` / `absent` / `equals` / `contains`.
`equals` needs the whole file, which for a file the ENGINE generated is content nobody
authored; `contains` is a fixed substring. There is no `matches`, which the stream
matchers have had all along.
**What that costs:** one claim gapped
(`guard-setup-generated-compose-pins-one-container-per-engine-with-a-healthcheck`): the
healthcheck half is a substring and is asserted, but "one PINNED container per detected
engine" is `image: <name>:<tag>` — a shape, not a string — and a claim proved on one of
its two halves is not proved. The same hole makes every other generated artifact
(a drafted seed script, a written compose file) readable only as "this exact word is in
there".
**Owner:** Guard Generate / runner (a `matches` matcher on `GuardFileMatcherSchema`,
compiled and reported exactly as the stream matchers' is).

### G61. Nothing can edit a NON-JSON file the scenario does not own
**What:** G56 asked for a partial-file edit and got one: the `patch` step sets and
removes key paths in JSON documents, which is what made most of this wave's recipe
manipulation possible. It is JSON only, on purpose. `write` replaces a whole file.
**What that costs:** two claims gapped —
`guard-setup-generated-compose-is-committable-and-in-the-fingerprint` (the committable
half is proved; the fingerprint half needs the generated YAML edited, and rewriting it
wholesale would destroy the generated content the claim is about) and
`seed-script-content-is-hashed-into-the-recipe-fingerprint` (the hashed file is the
repository's own seed script, in whatever language its ORM lives in).
**Owner:** Guard Generate / runner (a line-anchored append, or a `patch` that also
speaks YAML).

### G62. A `path` registration carries a description and nothing else, so a supplied repository cannot say what a probe may drive
**What:** `GuardDependencyRegistrationSchema` is a closed union: `env` (named variables),
`path` (one directory) and `config-dir`. A `path` instance therefore resolves exactly one
token, `${supplied:<name>.path}`. Everything a scenario would need to KNOW about that
repository — which operation to call, which route sets a cookie, which one redirects,
which variable breaks its boot — has nowhere to be registered.
**What that costs:** the largest gap cluster of this wave, 43 claims — 24 that need a
second route of the bound repository and 19 that need the app to CALL a third party on
a route the scenario may name. Every api-driver
behaviour that needs a second route (capture, `captureHeaders`, redirects, the cookie
jar and its attributes, `{{cred:…}}` and `{{fixture:…}}` resolution and their masking,
the `fromRequest` login, the `Authorization` warning) is reachable only through the ONE
route an api recipe always declares — its health path, which this wave captures out of
`guard recipe` and drives a probe scenario against. A registration that let an instance
name a handful of its own operations by ROLE (`a create returning an id`, `a session
login`, `a redirect`) would clear the cluster without any scenario naming a path.
**Owner:** Guard Setup (a `path` registration that also declares named facts, or a
fourth registration kind for "a repository plus the roles its operations play").

### G63. The run store records no per-scenario SERVER facts, so the api driver's whole process half is invisible from outside
**What:** a run snapshot carries per-scenario verdicts, steps and evidence transcripts of
the HTTP exchange. It records nothing about the process the api driver started: no port,
no working directory, no environment keys, no restart count, no exit code, and no count
of how many servers were alive at once.
**What that costs:** 33 claims gapped — every sentence the docs write about the server
process. `PORT` allocation and injection, `api.cwd`'s default and its `repo` mode,
`api.env` being server-only, `readyTimeoutMs`'s default, one fresh server per scenario,
a restart on a fresh port, `signal` delivery and its exit code, `api.services` up/down
running once per run, the seed's ordering and its inherited environment, and the
externals precedence that resolves into that same environment. A cli scenario can prove
that the machinery WORKS (the wave does: a probe boots, polls, requests and asserts);
it cannot prove any statement about HOW.
**Owner:** Guard Run (a `servers[]` block on the per-scenario run record: per boot the
port, cwd, the env KEYS applied and where each came from, the exit code, and the
sequence — the same shape the step list already has).

### G64. One supplied class cannot carry two mutually exclusive instances
**What:** a catalog entry has one registration and one rolled-up requirement, so all its
flows share one instance. Two pairs of api claims are contradictory ABOUT THE SUBJECT:
`guard-setup-reads-docker-compose-for-services` needs a repository that ships a
datastore-declaring compose file while `guard-setup-generates-a-compose-file-when-the-repo-has-none`
needs one that ships none, and `recipe-api-port-template-keeps-the-fingerprint-stable`
needs a server that does NOT read `PORT` while every other api flow needs one that does.
The multi-service claims (13 of them) are a third case: `api.serve` and `api.servers` are
mutually exclusive in one recipe by construction.
**What that costs:** 15 claims gapped, none of them for want of a capability — only for
want of a SECOND registered repository of the same class: 12 multi-service ones plus
the compose-file pair, the `${PORT}`-template one, and the three-way seed-draft gate.
**Owner:** Guard Setup (a supplied entry that accepts several named instances, with each
flow's need naming the one it wants; the local overlay already keys by entry name and
would key by `<entry>.<instance>`).

### H-index (api surface wave). Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G62, G64 |
| Guard Generate / runner | G60, G61 |
| Guard Run | G63 |

## API reference journeys (2026-08-10)

Found while authoring the dashboard server's HTTP journeys — the realization
surface of plan §2 — into `guard/journeys.json`. The journey ENTRY is already
operation-rooted (`{method, path}`) and `buildApiJourneys` already mints ids and
fingerprints for it, so the surface itself fits. What does not fit is the
CONTRACT: every field of `JourneyCommandContractSchema` was shaped for a command,
and an operation borrows them. Each item below names what the borrowing costs.
Nothing here was worked around in the schema; the catalog carries the closest
honest field and the loss is recorded.

### G65. A request BODY has no region, so its fields ride the flag grammar
**What:** an operation's caller-supplied inputs arrive in three places — the path,
the query string, and the JSON body — and the contract has two: `positionals` and
`options`. Path parameters map cleanly onto positionals. Query parameters and body
fields both have to become `options`, and `JourneyOptionSchema` has no `in`
discriminator (`query | body | header | cookie`), so the two are one namespace. The
reference states the location in each option's `description` (`Query parameter.` /
`JSON body field.`) — prose, which nothing can read.
**What that costs:** four of the 25 operations take a body (`POST /api/repos`,
`POST /api/repos/{id}/analyses`, and the two graph PUTs), 8 body fields in all. A
generator reading this catalog can see the field names, their requiredness, their
choices and their defaults, but not that they belong in a body — so it cannot build
the request without parsing English. It also cannot express a body that is not a
flat object (none of these are, today) or the content type it is sent under.
**Owner:** Guard Setup (an `in` member on `JourneyOptionSchema`, defaulting to the
surface's natural location — `command` for cli, `query` for api — so no cli option
moves; a nested body shape needs more than that and can wait for a case).

### G66. An HTTP status has no fact kind of its own, so it rides `exits`
**What:** `JourneyExitFactSchema` is `{exit, when?}` and its doc calls `exit` "the
status", which is exactly what an HTTP response has — but the field is named for a
process exit code and the dashboard renders the block as "Exit codes". The reference
carries all 91 response statuses there, one fact per condition, the same rule the
cli journeys follow.
**What that costs:** nothing a scenario cannot act on — the api driver's
`expect.status` takes exactly these numbers. The cost is legibility and typing: a
reader of the Journeys tab sees an HTTP 404 under "Exit codes", and a consumer
cannot tell a process status from a response status without looking at the
journey's `type`.
**Owner:** Guard Setup (either a surface-aware LABEL for the same fact kind, or a
`status` sibling; the fact SHAPE is already right, so this is naming, not structure).

### G67. A response body is not a stream, and its shape can only be said as markers
**What:** `JourneyOutputFactSchema` requires a `stream`, and `JourneyStreamSchema` is
the closed set `stdout | stderr | combined`. An HTTP response body is none of them.
The reference records every response marker as `stdout`, following the runner's own
mapping — `step-actuals.ts` says "an api request's response body rides as `stdout`",
and `run-api-scenario.ts` files the response body as the failing step's `stdout`
excerpt — so the vocabulary is at least consistent with what a run reports back.
**What that costs:** two things. The stream chip on the Journeys tab reads `stdout`
on 188 HTTP facts, which is the runner's word and not the surface's. And the body's
SHAPE is reduced to key markers: the reference states `"violations"` and `"total"`
as stable substrings, but cannot say that `violations` is an array of objects, that
`total` counts the whole filtered set rather than the page, or that this route has
TWO response shapes depending on whether it was paged (that last one survives only
in the `when` of each marker). A schema is deliberately not wanted here — the
journey is a calling interface, not an OpenAPI document — but "this field is an
array" is not a schema.
**Owner:** Guard Setup (a `response` member on the stream vocabulary, and a `kind`
on an output fact — `substring` today, `json-path` for a body field — so a consumer
knows whether to reach for `expect.body` or `expect.json`).

### G68. The contract's `path` is argv-shaped, so an operation states its identity twice
**What:** `JourneyCommandContractSchema.path` is "the argv a user types, program name
first". An operation has no argv, so the reference writes `["GET",
"/api/repos/{id}/violations"]` — which joins to exactly the string
`journeyEntryLabel` produces, and therefore renders correctly everywhere — but it is
a restatement of the journey's own `entry`, because an operation contract always has
exactly one entry and no tree beneath it.
**What that costs:** no information, and one honest oddity: the field a reader meets
in the artifact is named for a command line. The dashboard inherits it — the contract
card's nav is labelled "Commands" and its grammar column "Flag", so an api journey's
query parameters render under a flag heading. Cosmetic, and not worth a redesign
until the web surface arrives with a third shape.
**Owner:** Guard Setup (surface-aware labels in `GuardJourneyContract`, or a rename
of `commands` to something that covers a command AND an operation; the DATA is right
either way).

### G69. Nothing records a header, on either side of the exchange
**What:** there is no header fact kind. Three real facts of this surface have
nowhere to go: `GET /api/repos/{id}/graph` sets `Cache-Control: no-store` on its
success path and NOT on its empty one (probe-verified); `GET /api/repos/browse`
gates on the `Origin` header, which is the only reason a cross-origin read is
refused; and the enterprise auth gate replies with `Set-Cookie` when it rotates a
session. The Origin gate survives in the reference only as the `when` of a 403 exit
fact.
**What that costs:** a scenario cannot be told from the journey that a request needs
a particular header, nor that a response promises one — and the api driver supports
both (`request.headers`, `expect.headers`), so this is a fact gap, not a runner gap.
**Owner:** Guard Setup (`consumes.headers` and `produces.headers`, each
`{name, when?}` plus a marker on the produces side — the same two-field shape
`env` already has).

### G70. An accepted-then-streamed route cannot say where its outcome goes
**What:** `POST /api/repos/{id}/analyses` answers 202 before the run starts, and
everything that matters afterwards — progress, the LLM estimate, the dirty-tree
question, the completion, the cancellation, and any failure past the accept —
travels over Socket.io. The contract can say the status is 202 and can list the
files the run writes; it cannot say that a caller must listen elsewhere, or name the
events. The same is true of every future long-running trigger (`guard generate`,
`spec scan`).
**What that costs:** read alone, the journey implies the request IS the operation. A
generator authoring a scenario against it would assert the 202 and stop — which is
what the reference's own facts support, and which proves almost nothing about
analyzing. Testing the real outcome means polling a second operation, and nothing in
the journey says which one.
**Owner:** Guard Setup (an `async` fact naming the channel and the event markers, or
— cheaper and more useful — a `settles-at` pointer from the trigger operation to the
read operation that observes its result).

### G71. OMITTED cannot distinguish "not established" from "cannot apply here"
**What:** the artifact's rule is that an omitted list means the extraction
established nothing and an empty list means it established "none". A third case
appears the moment a second surface exists: a fact kind that CANNOT apply. An HTTP
operation asks no questions on stdin and prints no enumerated rows, so the reference
omits `prompts` and `rows` on all 25 — which reads, under the stated rule, as "the
mapper still owes them".
**What that costs:** the honesty the rule exists for. A reader of an api journey
cannot tell a genuinely missing prompt list from one that could never exist, and a
completeness check over the catalog ("every command answers what it reads") has to
special-case the surface rather than the fact.
**Owner:** Guard Setup (either a per-surface declaration of which fact kinds are in
play, or the smaller fix: let the derivation record `prompts: []`/`rows: []` as an
established none, and say in the schema that a surface without the concept states it
as none).

### G72. There is no UI-to-API relation, so a realization surface cannot say what it realizes
**What:** plan §2 requires a realization surface's journeys to record "the UI-to-API
relation" — which screen or interaction reaches which operation — so a web scenario
can act through the API and a reader can see why an un-promised surface is in the
catalog at all. `JourneySchema` has no such field, and this wave deliberately did not
add one: the shape has to land together with the web journey contract (§10), not
ahead of it.
**What that costs:** today, the 25 api journeys stand unattached. Nothing in the
catalog says that `GET /api/repos/{id}/violations` is what the Files tab reads, and
the derivation that WOULD say it (the client's own call sites) was consulted by hand
to scope this wave and then discarded.
**Owner:** Guard Setup with §10 (one relation field, authored once for both
directions, when the web journey shape is decided).

### G73. An option cannot say WHEN it applies, so a conditionally-effective parameter is prose
**What:** every io fact kind carries an optional one-condition `when`.
{@link JourneyOptionSchema} does not — it has `flag`, value shape, `choices`,
`default`, `scope`, `hidden` and a free `description`, and nothing else. A parameter
that is accepted but only takes effect under a condition therefore has nowhere
structured to say so.
**What that costs:** four witnesses in this corpus, all of them traps. `branch` on
`analytics/breakdown` and `analytics/top-offenders` applies in LATEST mode only — an
explicit `analysisId` skips the filter, so the same value changes the answer or does
nothing depending on a SECOND parameter. `branch` on `analytics/resolution` filters
the snapshot walk but not the active set the same response reports. And on the cli
side the gap is older than this wave: `truecourse list --diff` silently ignores
`--limit`, `--offset`, `--all` and `--severity`, which the reference states in the
`--diff` flag's description because there is nowhere else to put it. A generator
reading the grammar sees four usable filters and one usable branch scope; only the
English says otherwise.
**Owner:** Guard Setup (a `when` on `JourneyOptionSchema`, same shape and same
one-short-condition rule the fact kinds already obey — additive, never fingerprinted,
so no journey identity moves).

### H-index (api journeys wave). Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G65, G66, G67, G68, G69, G70, G71, G73 |
| Guard Setup with Web Driver (§10) | G72 |

## The web surface wave (2026-08-10)

The §10 reference ladder's stage 1, opened on the plan's first subject: the
dashboard's analyze page. One mixed flow
(`review-analysis-and-silence-a-rule-in-the-dashboard`) composed of the four
dashboard-UI statements the CLI wave consciously refused (promoted out of
`untestable[]`), and the manifest entry that records the web driver as the
awaiting gap.

**Re-scope 2026-08-11 (user review).** The first draft's journey
(`web/repo-analyze`) was a page-rooted ELEMENT INVENTORY — 64 steps, one per
interactive element — and the review rejected it: an inventory does not read
as a journey and is not one. Replaced by three TASK journeys, each one thing
a user can do from a specific state, walked in order by the flow:
`web/open-repo-report`, `web/silence-rule-from-violation-card`,
`web/reenable-rule-from-rules-panel`. Two consequences for the ledger below:

- `startingState` / `endState` landed on `JourneySchema` (and the journeys
  view renders them) — the state-contract half of what G75 said had no home
  is now carried; G75's remaining substance is the consumes/effects half.
- The fingerprint now covers only the entry route and the task's steps. The
  full element inventory (the G76 material) is no longer stored ANYWHERE —
  it reverts to extraction-time material per §10.4, and "does the fingerprint
  under-cover the surface" moves from G76 into the owner's segmentation
  design. G76's dynamic-name facts still bite wherever a task step needs a
  data-driven target (`link "{repoName}"`, `switch "Enable {rule}"` — both
  in the task journeys today, leaning on substring name matching).

Everything below is what the authored ideal states and the store schemas
cannot yet carry; the journeys' steps, state contracts, and the flow itself
are carried in full.

### G74. A web journey has no route-rooted entry
**What:** §10.4 defines a web journey's identity as "the route (path pattern +
the surface serving it)". `JourneyEntrySchema` is a union of the command entry
(argv path) and the operation entry (method + path) — there is no route entry.
`web/repo-analyze` is authored with the operation entry `GET /repos/{repoId}`
as the closest parseable shape: a browser does GET that URL, but the method is
noise (it is a client-side React Router route, not an HTTP operation), and
`journeyEntryLabel` renders it as an api operation.
**What that costs:** the journey's identity carries a fact nobody established
(the method), and the entry cannot say WHICH surface serves the route.
**Owner:** Web Driver (§10.4 — a `{ route }` entry shape; when it lands, the
entry-identity fold must either keep this journey's fingerprint where it is or
move it once, deliberately, before any web scenario exists to re-author).

### G75. The journey contract cannot carry a page's calling interface
**What:** `JourneyContractSchema.commands` is argv-shaped — options,
positionals, stdout/stderr markers, exit codes, TTY prompts. A page's contract
per §10.4 is none of those, so `web/repo-analyze` carries NO contract block and
the interface facts live only here:
- **Consumes (route + query):** `repoId` (route param; empty ⇒ redirect `/`);
  query params `section` (codequality|guard), `tab`, `gview`, `file`, `flow`,
  `guard`, `gconf`, `gflow`, `gfind`, `gjourney`, `gclaim`, `view` (=diff),
  `mode`, `scopeService`, `scopeModule` (`NavigationContext.tsx`,
  `ViewModeContext.tsx`, `GraphViewContext.tsx`). Tab-scoped params are
  deleted on tab/section switches; `view=diff` survives tab switches only.
- **Element kind nuance:** the step vocabulary collapses §10.4's
  click/submit/input/navigate kinds into `activate`/`input`, and a step target
  is one string (`role "name"`) — role and accessible name are not separate
  facts, and the owning component has no field at all.
- **Produces (navigations):** brand link → `/`; missing `repoId` → `/`;
  section switcher → `?section=&tab=<default>`; left-rail tab → `?tab=`;
  diff toggle → `?view=diff`; depth/scope → `?mode`/`?scopeService`/
  `?scopeModule`; "Open" on a violation card → `?file=<path>`; GitHub/Discord
  → external, new tab. Run-history select and every violations filter are
  state-only (no URL change).
- **Produces (API effects, one-hop through `lib/api.ts` `fetchApi`):** on
  load `GET /api/capabilities`, `GET /api/repos/{repoId}`,
  `GET /api/repos/{repoId}/violations`, `…/analyses`, `…/spec/staleness`,
  `…/guard/staleness`, `…/analytics/{trend,breakdown,top-offenders,resolution}`,
  `…/violations/code-summary`; `?view=diff` adds `…/analyses/diff`; tab-gated
  `…/graph`, `…/flows`. Per interaction: Analyze →
  `POST /api/repos/{repoId}/analyses` `{mode:'full'|'diff'}` (202); Cancel →
  `POST …/analyses/cancel`; Disable rule → `PATCH …/rules/{ruleKey}`
  `{enabled:false}`; Browse Rules → `GET …/rules`; Delete analysis →
  `DELETE …/analyses/{analysisId}`; node drag / auto-layout →
  `PUT`/`DELETE …/graph/positions`. Theme and graph display toggles are
  localStorage-only.
- **Produces (socket, socket.io same origin):** client emits `joinRepo`,
  `leaveRepo`, `analysis:llm-proceed`, `analysis:stash-confirm-response`;
  server pushes `analysis:{progress,complete,canceled,llm-estimate,
  llm-resolved,stash-confirm-request}`, `violations:ready`, `spec:{progress,
  complete}`, `files:changed`. The estimate and stash dialogs open ONLY off
  server pushes — no client element leads to them, which no static grammar
  can say today.
- **Readiness ("the page settled"):** no polling anywhere; settled =
  `analysis:progress` stream ended (progress overlay gone), the Analyze
  button's accessible name is back to "Analyze" and it is enabled, and the
  violations list is past its spinner. Run state is restored server-side on
  load (`repo.latestAnalysis.status`).
**Owner:** Web Driver (§10.4's elements/effects contract regions; the
frontend→API join is the one-hop resolution over the analyzer's cross-file
call data).

### G76. Element steps cannot carry dynamic accessible names, so a real page's surface is only partly steppable
**What:** a step's target is a literal string, and nothing marks a name as
state-flipping, count-suffixed, data-driven, title-only, placeholder-only, or
colliding. Stepped with their RESTING names and the caveat lost: "Analyze"
(⇄ "Analyzing..."), "Copy Fix" (⇄ "Copied!"), "Code Analysis" (section
trigger, ⇄ "Spec Guard"), "Latest" (run-history trigger, ⇄ a locale-formatted
date), category/severity filters ("Security" renders "Security {count}"),
"Disable rule for this repo" (renders with `{ruleKey}` + explainer appended).
Not stepped at all, each for a stated reason:
- **Dynamic name pairs with no restable form:** the graph edge/animation/
  collapse/select-mode toggles ("Show all edges"⇄"Show edges on hover only",
  "Expand All"⇄"Collapse All", …), the scope pickers (name = current
  selection), per-run history items (locale dates), per-rule switches in the
  Rules panel (`aria-label` "Enable {rule.name}"/"Disable {rule.name}").
- **Unlocatable (no role, no accessible name — the §10.3 policy refuses to
  guess):** the icon-only back-arrow link, the sidebar resize handle, every
  ReactFlow node/edge/minimap/pane, node collapse chevrons, recharts slices
  and bars, sortable `<th onClick>` headers, `<tr onClick>` analytics rows,
  the Live/Offline pill.
- **Name collisions on one surface:** two `button "All"` (detection-type vs
  category filter) — stepped once; `button "Cancel"` names three distinct
  controls (estimate cancel, progress cancel, modal close-by-title).
- **Dialogs with `role="dialog"` and no accessible name:** the LLM estimate
  and stash modals — `getByRole('dialog', {name})` cannot address them.
**What that costs:** the fingerprint under-covers the surface (a renamed
toggle pair moves nothing), and a future generator cannot learn the
answer-a-dialog path from the journey alone.
**Owner:** Web Driver (element facts with role + name + dynamism separated),
plus a dashboard a11y debt list the diagnostics channel should carry (G78).

### G77. The recipe cannot describe how a web surface starts
**What:** `recipe.json` carries the cli build + entry (and the api wave's
serve block); §10.5 needs "how the web surface starts and how readiness is
observed (URL probe)". The reference flow's scenario will need the dashboard
server AND the built client serving against the sandbox store before its
first web step, and no recipe field can say so.
**What that costs:** the flow's starting state names the serving dashboard in
prose only; nothing machine-readable blocks or boots it.
**Owner:** Web Driver / Guard Setup (the web-surface recipe kind of §10.5,
reusing the api server-boot machinery).

### G78. Web mapper diagnostics have no store home (G37's web form)
**What:** authoring surfaced doc-vs-code and a11y findings with nowhere to
live: the docs' "Rules panel (Shield icon in the top-right)" is rendered as a
"Browse Rules" control in the violations toolbar (`HomePanel.tsx`) — the flow
is authored to the doc and will run red as doc drift; the a11y debts of G76
(nameless dialogs, unlocatable graph region, placeholder-only inputs) are
exactly what §10.4 calls recorded mapper diagnostics feeding reconciliation.
**What that costs:** the findings ride this ledger and the flow's `notes`
instead of a queryable channel; nothing will clear them when the code or the
docs move.
**Owner:** Journey mapping (the same run-reporting channel G37 asks for,
driver-agnostic).

### I-index (web surface wave). Owning workstream

| workstream | items |
|---|---|
| Web Driver | G74, G75, G76 (element facts), G77 |
| Guard Setup | G77 (recipe kind) |
| Journey mapping | G76 (diagnostics half), G78 |

## Migration note — journey → INTERFACE (2026-08-10)

The concept this ledger calls a "journey" is now an **interface**, and the
catalog is one entry per INVOCABLE THING (plan §2, "The concept is named
INTERFACE, one entry per invocable thing"). What changed in the reference store:

- `.truecourse/guard/journeys.json` → `.truecourse/guard/interfaces.json`, with
  `journeys[]` → `interfaces[]`. The cli's SEVEN command trees became **22
  per-command entries** (one per contract command, ids in the api slug style —
  `cli/rules-list`, `cli/config-llm-setup`, `cli/hooks-install`, the root staying
  `cli/root`), each carrying only its own command contract. The 32 api entries and
  the 3 web task entries were already per-invocable-thing and only gained a group.
  Catalog total: **57** (22 cli + 32 api + 3 web).
- Every entry carries the new optional `group` field — the family it belongs to:
  the cli command tree's root word, an api route family (`analyses`, `graph`,
  `analytics`), the page a web task acts on (`home`, `repos`).
- `cli/add`, `cli/analyze`, `cli/list` and `cli/root` kept their fingerprints (one
  command, one step, unchanged). `cli/config`, `cli/hooks` and `cli/rules` moved:
  they used to fingerprint over a step per subcommand and now fingerprint over
  their own single invoke step. The identity rule itself is untouched — type +
  entry + steps.
- Each scenario's `journey:` block is now `interface:`, and its `path` is DERIVED
  from the argv its steps actually run rather than restated at tree granularity.
  Nineteen of the 33 scenarios changed ids as a result (a scenario that ran
  `rules list` and `rules disable` recorded `cli/rules`; it now records both). The
  manifest's `journeys[].journeyIds` → `interfaces[].interfaceIds`, rebuilt from
  the same derivation; the web flow, which has no scenario, keeps the ids its plan
  recorded.
- `guard/result.json`'s `journeys` tally → `interfaces`, 7 → 22: the same cli
  surface at the new granularity.

Two things this note is the record of, because they are NOT migrated:

- **`reference/fixtures/**` keeps the pre-rename vocabulary** (`guard/journeys.json`,
  `journey:` blocks, `guard: 3`) — frozen artifacts, out of scope by directive.
  Nothing reads them; the engine has no read fallback for the old filename.
- **The mapper derives `group` for cli and api, never for web.** The cli rule is
  the command path's first token; the api rule is the first static segment after a
  path parameter (else the first static one, stepping over a leading `api` mount).
  A web task's group is the page it acts on, which no route shape establishes — the
  three reference entries carry hand-assigned groups, and the web mapper owes the
  derivation.
**Owner:** Interface mapping (the workstream formerly called Journey mapping
throughout this file).

## The dashboard area — the web driver's first RUNNING flow (2026-08-11)

The §10 ladder's stage 2, on its own subject: the published **Dashboard** page
becomes an area of the corpus, and one flow of that area is authored as a
MIXED cli+web scenario and RUN for real. What landed:

| layer | landed |
|---|---|
| corpus | `truecourse/dashboard`, one doc ref — `.truecourse/specs/sources/docs.truecourse.dev/dashboard.md`, the registered source's own snapshot — plus **24 `skippedDocs`** entries, one per uncurated sibling page of that source |
| claims | **38 claims + 9 untestable** over the whole 49-line page, the stale Guard half included, anchored to the five sections `deriveSections` really derives (`dashboard-2` is the doc's lead: the llms.txt harness block) |
| interfaces | 3 new web tasks (`web/open-dashboard-home`, `web/filter-violations-by-category`, `web/switch-to-the-guard-section`) → 60 entries, and the UI-to-API relation on the web ones (G72, below) |
| flow | `review-a-repository-analysis-in-the-dashboard` — 7 claims, 4 task interfaces walked in order; the other 31 claims are `noFlowClaims` with reasons |
| scenario | one mixed file: a cli `analyze --no-llm` seeds the world, six web steps read it. PASSES (2026-08-11), with a screenshot per step and the session video in its evidence |
| recipe | the `web` block: `build: pnpm build:dist`, `serve: node dist/server.mjs`, `healthPath: /api/health` — the same bundle `truecourse dashboard` spawns |

### G72. There is no UI-to-API relation — CLOSED (schema + reference)
**What it asked for:** plan §2 requires a realization surface to record which
screen reaches which operation, so the 32 api entries do not stand unattached.
**What the store carries now:** `Interface.apiEffects` — the api entries a web
task's steps invoke, by CATALOG ID (`api/get-api-repos-id-violations`), so a
renamed or dropped operation breaks the link visibly instead of leaving a
plausible-looking string. Additive, optional, and outside
`interfaceFingerprint`: learning what a click calls is not which task it is.
The absence rule of the contract region applies unchanged, and this area
exercises both halves — `web/filter-violations-by-category` records `[]`
(established NONE: the category tabs filter state the page already holds),
while `web/switch-to-the-guard-section` OMITS the field (the one-hop resolution
has not been run over the surface it loads).
**Still open:** nothing PRODUCES it — the reference carries the only relation in
the store, and the mapper owes the one-hop derivation. Three routes the report
really loads (`violations/code-summary`, `spec/staleness`, `guard/staleness`)
have no api entry to point at, so they are absent from the relation rather than
recorded as unresolved: the api wave scoped its catalog to 32 operations.
**Owner:** Interface mapping (derive it), dashboard view work (render it — the
Interfaces pane shows a task's steps and states, not yet what it reaches).

### G79. A page-text assertion reads only the first 2,000 characters
**What:** `readVisibleText` (`packages/guard-runner/src/web/executor.ts`) caps
the page's `innerText` at `WEB_TEXT_LIMIT = 2_000` and the `expect.text`
matcher runs against that truncation, so what a step can assert depends on
where the text sits on the page. The dashboard's repo report renders 1,898
characters with a four-violation project: the flow's own assertions fit with
about a hundred characters to spare, and a fifth violation card would push the
last title past the cap.
**What that costs:** the authored assertion had to pick the two finding titles
the list reaches EARLY (they are asserted; the third and fourth cards are
deliberately unnamed), which is placement forced by the reader rather than by
the claim — the web analogue of G36. Scoping with `within` reads the element's
full text and dodges the cap, but the locator policy needs a role AND an
accessible name, and the violations region has neither.
**Fix shape:** cap the EXCERPT that rides evidence, not the text the matcher
sees; or let `within` address a landmark by role alone.
**Owner:** Web Driver (runner).

### G80. A mixed scenario is recorded on one surface
**What:** the manifest entry records `scenarios[].surface` per test, and a
scenario file declares one `driver`. This flow's scenario is cli AND web — one
cli step arranging the world, six browser steps proving the claims — so it is
recorded as `cli` (what the file declares) while its `interfaces` block honestly
lists both surfaces. `unaccountedSurfaces` therefore reports `web` for the
entry; it is inert here only because a hand-authored entry carries no
`generationInputsHash`, and a generated one in the same shape would be left
unsettled every run.
**What that costs:** "coverage per surface" cannot be read off the manifest for
a mixed flow, which is exactly the accounting question §10.9 flags as
undecided.
**Owner:** Guard Run / Guard Generate (define per-surface counting under mixed
scenarios), then the manifest shape follows.

### G81. `result.json` had drifted from the corpus it describes — CORRECTED
**What:** the generate-result record still reported the CLI wave's numbers:
33 flows (the web wave added a 34th) and 22 interfaces on one surface (the api
and web waves added 35 more). Nothing was wrong with the schema; the waves
simply did not rewrite the tally they invalidated, and the coverage view colours
from this file.
**What the store carries now:** the derivation, applied to the corpus as it
stands — `flows.total`/`settled` = the live flows (35), `noFlowClaims` = the
flow corpus's own list (127), `interfaces` = the catalog by type (60: 22 cli, 32
api, 6 web), `sectionsTotal` = every section of every curated doc (42), plus the
written row and the 31 coverage gaps of this area.
**Still open:** nothing recomputes it — a hand-authored corpus has no generate
behind it, so the tally is re-derived by hand at each wave and can drift again
between them.
**Owner:** Guard Generate (write it), or a corpus-consistency check.

### J-index (dashboard web wave). Owning workstream

| workstream | items |
|---|---|
| Web Driver | G79, G80 (with Guard Run) |
| Interface mapping | G72 (produce the relation) |
| dashboard view work | G72 (render the relation) |
| Guard Generate | G81 |

### G82. Interface diagnostics still have no store home (CLI half of G78)
**What:** An interface carries no diagnostics field, by design (`InterfaceContractSchema`: “no doc-versus-code diagnostics — discrepancies the mapper finds are run reporting, never stored interface data”), while plan §7.5's amendment says diagnostics live per-journey as `{kind, subject, detail, right?}`. The twelve findings of this pass therefore have no home in the artifact and ride in this fragment's `diagnostics[]`. Same shape as the already-recorded G78 (web mapper diagnostics have no store home), now confirmed for the CLI half too.
**Owner:** Guard Setup (§7.5 — give diagnostics the per-journey home the plan amendment describes)

### G83. A state id matches by equality only — one interface cannot serve several starting worlds
**What:** A state id matches by EQUALITY only, and an interface names exactly one `startingState`, so a task invocable from several worlds cannot say so. Concrete losses in this area: the header's “Analyze” click is one interface but three tasks (first analysis from `repo-no-analysis-open`, re-analysis from `repo-report-open`, diff check from `diff-mode-on`); returning to the Home tab is one interface reachable from all six tab states; clearing a filter chip is one interface per filter but reachable from any combination of the others. A second entry for the alternatives is impossible — `interfaceFingerprint` folds only type + entry + steps, so two tasks that differ only in the world they assume are the same identity.
**Owner:** Guard Setup (interface schema — starting-state sets or per-world tasks with distinct identity)

### G84. No step for a native browser dialog (`window.confirm`)
**What:** There is no step for a NATIVE browser dialog. `web/delete-a-past-analysis` activates `button "Delete analysis"`, but the deletion only happens after a `window.confirm` that no `activate`/`input` target can name (it is not in the page's accessibility tree). The same applies to the repository-delete confirm on the home page.
**Owner:** Web Driver

### G85. No way to record a step outcome deferred to a socket push
**What:** A web interface cannot say that a step's outcome is DEFERRED to a server push. `web/run-an-analysis-from-the-header` ends at `analysis-running`, but whether the next thing on screen is the progress card, the stash dialog or the LLM dialog is decided by socket events (`analysis:stash-confirm-request`, `analysis:llm-estimate`), and nothing in the schema carries that fan-out — the three successor states are authored as separate interfaces with no way to say what selects between them.
**Owner:** Web Driver (with Guard Setup for the schema half)

### G86. No keyboard verb in the step vocabulary — the documented `Escape` cancellation is unauthorable
**What:** The step vocabulary has no verb for a keyboard-only interaction, so the documented `Escape` cancellation of both dialogs (running-analyses.mdx: “Closing the dialog (the X, the backdrop, or `Escape`) cancels the run”) is unauthorable; only the labelled buttons are.
**Owner:** Web Driver

#### Appendix to G82 — the twelve diagnostics of the dashboard cli+web interface wave (preserved verbatim; the doc-bug / product-bug feed)

**D1. cli/dashboard — the run-mode question**
- code: The question is gated on `fs.existsSync(~/.truecourse/config.json)` (`runDashboard`, tools/cli/src/commands/dashboard.ts:209-225). That file is ALSO where the LLM first-run wizard saves its answer (`saveTransportSelection` → `writeGlobalConfig`, `getGlobalConfigPath()` = `~/.truecourse/config.json`), and the wizard runs in the program's `preAction` hook — before every command's action, including this one. So on an interactive machine the file always exists by the time `runDashboard` looks: the question never arrives, and `readConfig().runMode` falls through to the `console` default. It can only appear when the file is absent at that moment — `TRUECOURSE_LLM_TRANSPORT` set (wizard skipped, nothing written), a deleted config, or `--reconfigure`.
- docs: dashboard/overview.mdx:28 — “The first `truecourse dashboard` asks whether to run in this terminal (console) or as a background service; `--reconfigure` re-asks later.”
- verdict: Code wins for grammar: the prompt fact is authored with the real condition (`no ~/.truecourse/config.json yet (or --reconfigure), no --service/--console, stdin is a TTY`). Not resolved here — this is a product-bug candidate (the documented first-run choice is unreachable on a normal machine), for the user to rule on.

**D2. cli/dashboard-logs — “service mode only”**
- code: `runDashboardLogs` short-circuits ONLY when the health endpoint answers and no service is running (console mode); in every other case — service running, service stopped, nothing running at all — it tails `~/.truecourse/logs/*.log` and, with no live log file, prints “No log files found. Is the service running?”.
- docs: reference/cli.mdx:100 and dashboard/overview.mdx:24 — “Tail dashboard logs (service mode only)”.
- verdict: Code wins: the command is not service-only; it is console-mode-only-excluded. Recorded, not resolved.

**D3. cli/dashboard — `--service` with `--console`**
- code: tools/cli/src/index.ts:113-116 prints `error: --service and --console are mutually exclusive` on STDERR and exits 1 before any other work.
- docs: reference/cli.mdx:99 and dashboard/overview.mdx:17-26 list all three flags and never state the exclusion or its error path.
- verdict: Code wins; the exclusion and its exit-1 path are authored on the grammar and the io facts. Doc gap, unresolved.

**D4. cli/dashboard — console mode while a service runs**
- code: `runDashboard` refuses with exit 1 (“A dashboard service is already installed and running. Stop and remove it first: `truecourse dashboard uninstall`, then rerun `truecourse dashboard`.”) whenever the resolved mode is not `service` and an installed service is running.
- docs: No dashboard page mentions this refusal; `--console` is documented only as “Run in this terminal (skips the mode prompt)”.
- verdict: Code wins; recorded as an authored exit fact. Doc gap, unresolved.

**D5. cli/dashboard — the service→console fallback**
- code: A throw out of `runServiceMode` is caught: the CLI prints “Service mode failed: …” and “Falling back to console mode.”, runs console mode instead, and persists `runMode: "console"`.
- docs: Undocumented on every page.
- verdict: Code wins; authored as output facts. Doc gap, unresolved.

**D6. cli/dashboard-uninstall — what it actually does**
- code: The command reads `config.runMode` FIRST and returns doing nothing (“Dashboard isn't installed as a service — nothing to uninstall.”) whenever it is not `service` — even if a service really is installed. On the other paths it always writes `runMode: "console"` back to `~/.truecourse/config.json`.
- docs: dashboard/overview.mdx:25 — “truecourse dashboard uninstall  # Remove the background service”. The config flip is undocumented, and so is the config-driven no-op.
- verdict: Code wins; the command's own description (“…and revert to console mode”) is the accurate one. Recorded, unresolved — the no-op-on-stale-config path is a product-bug candidate.

**D7. web — the Graphs tab before the first analysis**
- code: RepoPage's Graphs empty state reads “No graph data” / “Run an analysis to generate the architecture graph.” in the community build and names no button; only the enterprise branch says “No analysis yet”.
- docs: dashboard/overview.mdx:74 — “Home shows **No analysis yet** and points at the **Analyze** button …; Graphs offers the same prompt”.
- verdict: Code wins: the two empty states share neither wording nor a call to action. Recorded, unresolved.

**D8. web — the Rules panel entry point**
- code: The control is a Sheet trigger whose accessible name is “Browse Rules” (both `aria-label` and `title`); a Shield icon is its only visible content.
- docs: dashboard/violations.mdx — “The shield button at the right of the filter row opens the **Rules** panel”.
- verdict: Code wins; the existing `web/reenable-rule-from-rules-panel` already targets `button "Browse Rules"`. Same drift the web wave logged on 2026-08-10 (reference/transform-gaps.md); re-confirmed, still unresolved.

**D9. web — the severity dropdown's value set**
- code: `SeverityDropdown` offers `all, critical, high, medium, low` — an “All severities” reset item the docs omit, and no `info` entry, although violation cards render an `info` severity (and the CLI's `--severity` accepts it).
- docs: dashboard/violations.mdx — “**Severity** is a dropdown of Critical, High, Medium and Low, each with a live count.”
- verdict: Code wins. Two findings: the docs omit the reset item, and `info` findings cannot be filtered for in the dashboard at all. Recorded, unresolved.

**D10. web — when Analyze is hidden**
- code: `onAnalyze` is withheld (so the button does not render) on FOUR conditions: not the Code Analysis section, viewing a past run, the repository is not a git repo, and a repo-load error.
- docs: dashboard/running-analyses.mdx:37-43 lists three (past analysis, not a git repository, Spec Guard section).
- verdict: Code wins; the repo-error condition is undocumented. Recorded, unresolved.

**D11. web — “where you are is written into the URL”**
- code: `?section=`, `?tab=`, `?file=`, `?flow=` and `?view=diff` are all URL-backed, but the selected past run (`selectedAnalysisId`, ViewModeContext) and the open database (`activeDbId`, OpenTabsContext) are plain component state — a link cannot reopen a past-run view or an open schema, and both are lost on reload.
- docs: dashboard/overview.mdx:76-78 — “Where you are is written into the URL, so a link reopens the same view”, then lists exactly the params that are backed.
- verdict: Code wins on the params; the general sentence over-promises for the two unlisted selections. Recorded, unresolved.

**D12. web — unlocatable interactive elements (locator policy, plan §10.3)**
- code: These real interactions have no role and no accessible name, so no role+name step can be authored for them: the file-tree row and its folder chevron (`<div onClick>` / `<span onClick>`, components/files/FileTree.tsx), the pie slice and the severity bar (recharts SVG paths with `onClick`), the open-item tab strip and its close buttons (`<div onClick>` + icon-only `<button>` with no label), the header back link, and the graph's own node bodies (custom React Flow nodes whose ARIA this pass did not establish).
- docs: The docs promise all of them: violations.mdx (“Click a slice…”, “Click a bar…”), files-flows-databases.mdx (“Click a file to preview it, double-click to pin it”, “Click a folder to expand or collapse it”), architecture-graph.mdx (“Clicking a service, module, function or database node zooms to it”).
- verdict: Not a doc bug — a product accessibility gap that costs the corpus coverage. The file-open task is authored through the shareable URL instead (`web/open-a-file-in-the-code-viewer`); the chart drill-downs are authored only where a role exists (`columnheader`/`row` in Top Offenders and Code Hotspots); the graph node click is NOT authored. Recorded, unresolved.

#### Authored decisions of the same wave (recorded per AUTHORING §2)

1. No Phase-0 divergence exists in the `cli/dashboard` family: §5 deletes the agent transport, the scenario Story mode and the externals/api coupling, and this family exposes none of them. Its one inherited surface, the first-run transport question, already offers exactly the two transports Phase 0 keeps (`Claude Code | API`, `runWizard`), so its `answerHint` is authored as the code has it, not narrowed.
2. Slate item 2 (“run the dashboard as a background service”) adds NO web interface: the service is entirely a CLI surface (`cli/dashboard --service`, `cli/dashboard-status`, `cli/dashboard-stop`, `cli/dashboard-logs`, `cli/dashboard-uninstall`), and what the browser then shows is the already-catalogued `web/open-dashboard-home` / `web/open-repo-report`.
3. The empty state (slate item 3) is NOT authored as a second click on the home page's repo link: that is the SAME invocation as `web/open-repo-report` (same entry, same step), so a second entry would carry an identical fingerprint. It is authored as the direct-URL task `web/open-an-unanalyzed-repository`, which is a real invocation the product itself performs — `truecourse dashboard` opens `<origin>/repos/<slug>` in the browser (`targetUrlFor`).
4. `web/run-an-analysis-from-the-header` is authored from `repo-no-analysis-open` because a state id matches by equality only: the same “Analyze” click also starts a re-analysis from `repo-report-open` and a diff check from `diff-mode-on`, and neither can be a second entry (identical fingerprint). Same reason no “return to the Home tab” task is authored — it would have to pick one of the six tab states it can be invoked from. See the state-equality gap below.
5. `apiEffects` lists only operations that exist in this catalog, which is analyze-area scoped. The repository page ALSO issues `GET /api/repos/{id}/spec/staleness` and `GET /api/repos/{id}/guard/staleness` on every mount; both are out-of-area routes with no api entry, so they are deliberately not listed rather than authored as dangling ids.
6. The LLM estimate dialog's labels are authored as the NON-staged pair (“Run LLM rules” / “Skip — deterministic rules only”): the analyze path's socket payload (`createSocketLlmEstimateHandler`) carries `{totalEstimatedTokens, tiers, uniqueFileCount, uniqueRuleCount}` and no `stages`, so `LlmEstimateModal` cannot render its staged variant (“Proceed” / “Cancel”) for an analysis. Established from source, not assumed from the docs.
7. For the integrator, not a change made here: the existing `web/open-repo-report` omits `api/get-api-repos-id-violations-summary` from its `apiEffects`, although `useAnalytics` issues `GET /api/repos/{id}/violations/summary` in the same `Promise.all` as the four analytics calls it does list. The new `web/open-an-unanalyzed-repository` lists all five. `apiEffects` is not fingerprinted, so correcting the existing entry would move no identity — but the existing 60 were left untouched by scope.
8. Every `apiEffects: []` in this fragment is the established “reaches no server”, verified at the call site: the violation-list filters, the fix-prompt expand/copy, the Top Offenders sort and both drill-downs, the graph fit-view, the schema view toggle, opening the Analyses tab and selecting a past run there (the analyses list is already loaded page-level, and on that tab the violations/graph/flows hooks are all disabled), leaving diff mode, and the two socket-answered dialogs (stash, LLM estimate) which emit `analysis:stash-confirm-response` / `analysis:llm-proceed` and issue no HTTP at all.

### J-index (dashboard flows+interfaces wave). Owning workstream

| workstream | items |
|---|---|
| Guard Setup | G82 (with §7.5), G83, G85 (schema half) |
| Web Driver | G84, G85, G86 |

### G87. The sandbox step union has no verb for a LONG-RUNNING process
**What:** `truecourse dashboard` (console mode) holds the terminal and `dashboard
logs` follows a file; a `run` step can only await exit, so both exhaust their
`timeoutMs` and land as INFRASTRUCTURE errors that stop the scenario. The api
driver already owns the needed verbs (`boot`/`signal`/`logs` with matchers) but
the sandbox union excludes lifecycle verbs by design (scenario.ts: the served
surface's lifecycle belongs to the sandbox). Cost, concretely:
`open-the-dashboard-and-find-your-way-around` had to put the console-mode step
LAST (7 milestones ride on it red-by-timeout), and
`run-the-dashboard-as-a-background-service` cannot reach its
`--reconfigure`/`stop`/`uninstall` steps past the mid-flow `logs` step.
**Owner:** Guard Run (a lifecycle/background verb for the sandbox union, or
sandbox-owned dashboard lifecycle like the api driver's).
**STATUS: CAPABILITY BUILT 2026-08-11** (plan item 91.4) — a `run` step may declare
`until: { marker: … }`: the runner watches what the command writes, terminates the
child the moment that line appears, and evaluates the step's `expect` against the
output so far. A console-mode step therefore passes on its real output and the
scenario CONTINUES past it, so neither the last-step placement nor the
red-by-timeout milestones are forced any more; `dashboard logs` mid-flow is
reachable the same way. A marker that never appears is a FAIL naming it, not an
infrastructure timeout, and `expect.exit` beside `until` is refused at load (the
runner ends the child, so there is no exit code of the command's own). Not covered
by this: the FIXED PORT 3001 the sandbox's dashboard binds (the G87 sibling noted in
the run classification below) — that is still a recipe/runner allocation question,
and the false green it produced is a separate item. The reference corpus has not
been re-authored against the new field; the scenario edits are the corpus's own
call.

### G88. The web vocabulary cannot OBSERVE style, motion, input state, or SVG geometry
**What:** seventeen claim-level gaps recorded in `guard/result.json` (reason
prefix ``claim `…` ``) trace to missing observation channels: no
attribute/class/inline-style matcher (theme dark-mode, severity colouring,
trend delta colour, gutter bars, slice pop-out), no browser-history verb
(Back/Forward), no drag (the violations divider), no scroll, no clipboard read
(Copy Fix), no motion observation (graph animations), no hover (edges-on-hover,
edge dimming), no locator for SVG-geometry targets (recharts donut slices and
severity bars are bare `<path>`es; React Flow nodes are `role=group` without
accessible names, the pane a plain div), and no transform on a captured value
(Code Hotspots renders a basename while the store holds the full path).
**Owner:** Web Driver (each channel is its own decision; the roles-and-labels
policy stays the default).
**STATUS: THREE CHANNELS BUILT 2026-08-11** (plan item 91.1–91.3, 91.5), the rest
still open:
- **attribute / class** — `expect.attribute { of?, name, value? | present? }` and
  `expect.class { of?, has? | absent? }`, reading the DOCUMENT ELEMENT when `of`
  names no element. Dark mode is now assertable exactly as the product implements
  it (the `dark` class on `<html>`, `data-theme` beside it), both the flip and its
  survival across a reload. `class` matches whole TOKENS, so `has: dark` never
  passes for `darkroom`. The `theme` STORAGE key is still unreadable — no storage
  channel was added.
- **ARIA state** — `expect.state { role, name, checked? | pressed? | selected? |
  expanded? | disabled? }`. This is the disabled-state observation this entry lists,
  plus tab strips and toggle switches. The three-way detection switch is now
  ASSERTABLE-AND-RED rather than unstatable: the step fails with "…exposes no
  aria-pressed state", which is the honest finding (nothing exposes its position to
  a screen reader either), and is a product fix waiting to happen rather than a
  vocabulary gap.
- **browser history** — `history: back | forward` is a web verb now, on the same
  footing as navigate/click/fill, and works for a single-page traversal that loads
  no document. The overview flow's Back/Forward claim no longer has to ride as
  "the old address still renders".
- **several `visible` targets** — one expectation may name a LIST of role+name
  targets (the graph canvas's three icon buttons after a reload: one claim, one
  step, one check each, and a miss names which target).
Still open, untouched: drag (the violations divider), scroll, clipboard read,
motion, hover, SVG-geometry locators, and the transform on a captured value.
**APP-SIDE MOVEMENT, same day (2026-08-11), superseding two sentences above:**
the "ASSERTABLE-AND-RED" reading of the detection switch is already outdated —
the client now exposes `aria-pressed` on every position of the detection
switch, the category tabs and the rules panel's three switches (inside named
groups: `Detection type filter`, `Violation category filter`, `Rule detection
type filter`, `Rule status filter`, `Rule category filter`), so `expect.state`
reads a real answer there, green. The React-Flow-nodes-without-names clause in
the What paragraph is likewise history — see the red-board entry for
`explore-the-architecture-graph` (every node carries `ariaLabel` since
`3bac254f`). Two more surfaces gained identities the vocabulary can now use:
the violations divider is a `separator` named `Analytics panel width`
advertising `aria-valuenow` (readable via the new attribute channel, though
RESIZING it still needs the missing drag/keyboard verbs), and the rail badges
name their counts as `status` elements (`Home, 12 violations`,
`Home, 3 new, 2 resolved`) without touching the buttons' own names.

### G89. Dependency registration kinds cannot express a HOST CAPABILITY
**What:** the new `host-service-session` dependency (the background-service
flow) is really "this machine grants a capability", but the catalog's
registration kinds are `env | path | config-dir`, so it rides an opt-in env var.
The authoring note, verbatim: REGISTRATION-KIND CAVEAT: the catalog's registration kinds are `env` | `path` | `config-dir`, and none of them says "this machine grants a capability". `env` is used here as the closest honest mechanism (an explicit opt-in variable the runner can check and the user can withhold), but a `host-capability` kind — a named capability with a probe — is what this dependency actually is. Recorded as a schema gap rather than papered over.
**Owner:** Guard Setup (a `capability` registration kind).

### G90. Interface catalog gap: the dirty-tree dialog's SECOND answer has no entry
**What:** the catalog carries `web/stash-pending-changes-before-a-run` but no
entry for the other button ("Don't stash — analyze the working tree as-is"),
which `run-an-analysis-from-the-dashboard` walks to prove the as-is claim; the
step exists, honestly unlisted in the interface path rather than misdescribed.
**Owner:** Interface mapping. **STATUS: CLOSED 2026-08-11** —
`web/analyze-working-tree-without-stashing` now carries the sibling task and the
existing scenario names it in both its path and manifest mapping.

#### Product/doc findings of the scenario wave (the feed; not schema gaps)

1. The documented first-run console-vs-service question is unreachable on a
   normal machine (G82 appendix D1). The scenario wave adds the concrete fix
   candidate: gate on a `runMode` KEY in `~/.truecourse/config.json`, not on the
   file's existence — the LLM first-run hook creates that file first.
2. The trend chart's legend resolves labels by data key and the total-active
   series is keyed differently, so `Total Active` renders as a swatch with no
   text. Authored to the doc; expected red.
3. The file tree renders NO rollup count text, while the doc promises "folders
   roll up the counts"; recorded as an untestable gap and a doc/UI divergence to
   rule on.
4. Top Offenders is EMPTY under every deterministic seed: no deterministic rule
   attributes a finding to a service or module, so the doc's ranking claims are
   only reachable with LLM-attributed findings (the two claims ride as
   blocked-on gaps).
5. "The first open registers the repository" (overview) is unfalsifiable inside
   a flow that also needs a stored analysis — every arranging route registers
   too. Candidate for a later edge flow seeded with a config-only store.

### J-index (dashboard scenario wave). Owning workstream

| workstream | items |
|---|---|
| Guard Run | G87 |
| Web Driver | G88 |
| Guard Setup | G89 |
| Interface mapping | G90 |

#### Run classification, 2026-08-11 (the red board, marked)

Every current red/false-green of the two dashboard-area runs, classified. The
authoring defect found (history flow: cap-blind past-run assertion; unanswered
LLM modal after the diff-mode Analyze) is FIXED and that flow is green; the rest
are deliberate reds or engine findings, kept red on purpose:

- `read-a-violation-card-and-silence-its-rule` — PRODUCT BUG, FIXED 2026-08-11:
  after a rule was disabled the Home badge, donut and trend refreshed but the
  `active` summary chip (and `stale`/`rate`/`resolved`, same sources) kept the
  stale count. Root cause: `getResolution()`'s LATEST branch read `LATEST.json`
  directly, bypassing the shared `readActiveViolationsForAnalysisId` resolver
  where the `disabledRules` filter lives; `resolved` separately counted refs
  from disabled rules (ResolvedViolationRef carries no ruleKey — now resolved
  via the snapshot walk's own `added` rows). Fixed in
  `apps/dashboard/server/src/services/analytics.service.ts`; pinned by a new
  case in `tests/dashboard-server/dashboard-routes.test.ts` (fails on the
  unfixed code) and a controlled Playwright run (chip 31→29→31 tracking the
  badge; the unfixed bundle reproduces chip=31 vs badge=29). Scenario expected
  green on the next full run.
- `read-the-analytics-of-a-run` — PRODUCT BUG (predicted at authoring), FIXED
  2026-08-11: the trend legend rendered `New`/`Resolved` plus an UNLABELLED
  swatch. Root cause: `ChartLegendContent` resolves labels by `item.dataKey`
  (the tooltip prefers `item.name`, which is why only the legend broke), and
  `TrendChart` registered the total-active series under config key `total`
  while drawing the Area with `dataKey="active"`. Fixed by keying the config
  as `active` (matching the dataKey, the convention every other chart follows)
  in `apps/dashboard/client/src/components/analytics/TrendChart.tsx`; pinned by
  `tests/dashboard-client/trend-chart-legend.test.tsx` (fails unfixed) and a
  before/after Playwright run. Scenario's step stays red until the run repeats.
- NEW FINDING (same component, spotted during the fix, NOT yet fixed):
  `TrendChart.tsx` computes `active: p.total - p.resolved`, but the server's
  `total` is already active-only (`new + unchanged`), so resolved findings are
  subtracted TWICE and the Total Active line plots 0 whenever a run resolves as
  many findings as remain active (visible in the verification screenshots).
  Needs its own fix + a claim/scenario check on what the doc promises the trend
  plots.
- `explore-the-architecture-graph` — a11y half FIXED 2026-08-11: every graph
  node now carries `ariaLabel` (React Flow's per-node mechanism; its NodeWrapper
  is the element with role=group) via `nodeAriaLabel()` in
  `apps/dashboard/client/src/hooks/useGraph.ts`, pinned by
  `tests/dashboard-client/graph-node-names.test.ts` and a Playwright run
  (`group "postgres"`/`"api"`/`"worker"` each resolve; screenshots in the
  session scratchpad). The unblocked click ADJUDICATES the doc contradiction:
  clicking a database node switches to the Databases tab and opens the schema
  (RepoPage.handleNodeSelect intercepts type=database and wins over
  GraphCanvas.onNodeClick's zoom, which still fires underneath) — so the
  db-specific sentence is TRUE and the doc bug is the generic click-zooms
  sentence LISTING database among its node types. Doc fix: drop "database" from
  the zoom list. Known residue: at modules depth a serviceGroup and its layer
  can share a name (role locator ambiguous there); services depth is unique.
- `walk-files-flows-and-databases` — RETRACTED as an engine race, FIXED
  2026-08-11 as three smaller things. The "read-once expects" diagnosis was
  wrong: `awaitWebExpect` polls the whole expectation every 100ms until the
  step deadline, and the "559 chars" was `truncate()`'s 400-char DISPLAY cap
  (the full text held the entire Flows sidebar — steps 16/17 passed on the
  same string). The real miss was case: the scenario asserted `api`/`worker`
  while `innerText` returns what CSS renders, and `FlowList` uppercases its
  group headings. Fixed by (1) the scenario asserting the rendered case
  `API`/`WORKER`, (2) the driver naming a case-only miss in its mismatch
  ("differs only in letter case", with the CSS-renders-the-case why on the
  web text subject), (3) web text mismatches carrying the full channel width
  (2000) instead of re-truncating to 400, and (4) an AUTHORING.md rule: web
  `text` is CSS-rendered text. Scenario is green.
- `open-the-dashboard-and-find-your-way-around` — FALSE GREEN on the console
  step: the sandbox serves the dashboard on the fixed port 3001, so the
  scenario's own `truecourse dashboard` run hit "Port 3001 is already in use"
  and exited 1 AFTER printing every asserted marker. The port is not
  runner-allocated (G87's sibling); the "console mode holds the terminal"
  reality was never observed.
- seven code-analysis scenarios (`commit-a-baseline…`, `decline…`, `diff-uncommitted…`,
  `install-the-pre-commit-hook…`, `retune…`, `run-llm-rules-on-every-commit`,
  `work-from-a-fresh-worktree…`) — ENGINE/DOC DRIFT, investigated 2026-08-11:
  each fails at `git add .truecourse/config.json` (exit 128, "pathspec did not
  match"). CORRECTION to this entry's first form: analyze NEVER wrote
  `config.json` — the file has been write-on-settings-mutation-only since it
  was introduced (`5f16005c`); the docs' "commit config.json" block (`c433a6cf`)
  was never true against any engine. The intended fix already exists unmerged:
  `620b06ff` on `sm/api-wave-stage-3` adds an absent-only `ensureProjectConfig`
  called from `persistFullAnalysis` ("a completed analyze must leave a
  config.json next to the baseline it just wrote"), with tests. Restoring that
  write fixes all seven scenarios and the one falsified claim
  (`baseline-files-exist-and-are-stageable-after-analyze`) with zero doc edits
  and zero fingerprint churn.
- `exclude-generated-and-ignored-files-from-analysis` — ENGINE: findings from
  excluded files (`generated_helper` camelCase, SELECT *) still listed after the
  `.truecourseignore` arrangement.
- `survive-a-file-that-exceeds-the-per-file-budget` — ENGINE DRIFT: no
  "skipped … bulk.js" message; the run completes silently with 1 violation.

### G91. No web CAPTURE channel, and the hotspots ranking has no API
**What:** cli and api steps capture values (`stepCaptureNames`) but web steps
cannot read anything off the page into `${captured:…}` — and the Code Hotspots
table is ranked CLIENT-SIDE from the unordered `violations/summary` `byFile`
map, so no JSON path can name the top hotspot either. Against a SUPPLIED
project the hotspot-row click is therefore unrealizable: the row's accessible
name (its file) is unknowable at authoring time by every channel the vocabulary
has. Cost: `dashboard-violations-code-hotspot-row-scopes-the-list` rides as a
blocked-on gap in `guard/result.json`; the seeded analytics flow proves the
same interaction for its own doc's claim.
**Owner:** Web Driver (a text-capture channel — regex over rendered text, the
web sibling of the cli stdout capture), or dashboard-server (a ranked
hotspots endpoint the capture vocabulary can address).

### Analyze-tab web corpus expansion (2026-08-11)

The Code Analysis-only follow-up added 15 stateful web interfaces and seven
mixed-driver flows. In addition to the stash/clean-tree/LLM paths, executable
journeys now cover adding a repository by path, a non-git repository, repository
rule configuration, and the Rules panel. Existing walks gained the interactions
they already needed or can now observe honestly: Functions depth, folder
collapse/expand, flow search/forward/back/play, shared tabs, schema expansion,
Top Offenders sorting, hotspot severity, graph connection state, and the detailed
Normal/Git Diff comparison. G90 closes as described above.

The store now contains 114 interfaces (55 web), 51 settled flows, and 51
scenarios. The dashboard documentation has 301 extracted claims: 222 occur once
as executable milestones and the remaining 79 occur once in `noFlowClaims` with
claim-specific reasons. There are no unaccounted or duplicate dashboard claims.

The no-flow inventory makes the remaining transformation boundary concrete:
native `window.confirm`/directory dialogs (G84), socket-deferred cancellation and
failure (G85), Escape and other keyboard-only paths (G86), long multi-run caps
(G87), drag/hover/style/SVG geometry and disabled-state observations (G88), web
value capture for cross-driver equality (G91), and state-distinct actions that
still fingerprint identically (G83). The corpus does not invent steps or weaken
assertions to hide those limitations.

**Boundary update, 2026-08-11 (engine side).** Five of those limitations are gone
as CAPABILITIES — the held-command step (G87) and four web channels: ARIA state,
attribute/class on the document element, several `visible` targets, and a browser
history verb (the observable half of G88). See the STATUS blocks on G87 and G88
above and plan item 91 for the field names and their semantics. Nothing in
`reference/store/` was re-authored for them: the inventory above still describes
the corpus as committed, and closing the claims those channels unblock is the
corpus's own next pass.
