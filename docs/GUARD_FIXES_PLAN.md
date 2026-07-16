# Guard fixes plan

Rolling batch of guard-pipeline fixes surfaced by live-testing on sqlfluff. Each numbered
item is a self-contained work unit (the contract an implementation agent executes);
STATUS tracks per item.

## Baseline to beat (sqlfluff, guard generate of 2026-07-15)

Re-run guard on sqlfluff after implementing items and compare against these numbers:

- 190 sections · **87 scenarios written** · 178 coverage gaps · 4 held sections ·
  16 authoring-error entries (= 7 failed sections) · 97 calls / $22.08.
- **9 birth findings → 6 real doc-drift catches, 3 generation defects** (defect rate
  33% — items 2/4/6 attack this; target: near zero).
- **Tracker overlap: 1 feature-area match, 0 exact.** Findings 1&3 (nested-config
  templater behavior contradicts the docs' "ignored in subdirectory" caveat) share a
  root with open sqlfluff bug **#7091** ("cli not using dialect from per-file or nested
  config") — same nested-config application area, different key. The other real catches
  (stale fix walkthrough §basic-usage, tty-gated emoji) are unreported doc bugs —
  trackers under-report doc drift, so exact matches are expected to stay rare; the
  overlap count to watch is findings sharing a root with open code bugs.

## 1. Authoring must always see the full document — remove the titles-only fallback

STATUS: BUILT 2026-07-15

**Problem.** `buildAuthorDocContext` (`packages/guard-generator/src/prompts.ts`) sends the
whole doc as authoring context only when it is ≤ `AUTHOR_DOC_BUDGET` (48k chars). Over
budget it silently degrades to a titles-only outline plus just the cited sections'
`ownText` — the rest of the document's content is dropped. Lossy fallbacks like this are
banned: scenarios authored from an outline are a worse product than advertised, and
nothing surfaces the degradation. (Lossless chunking — extraction's view mechanism, where
every slice is processed and results unioned — is fine and stays.)

**Fix.**
- `buildAuthorDocContext` returns `gd.content` unconditionally. Delete the outline
  branch, `AUTHOR_DOC_BUDGET`, and the now-dead `anchors` parameter (call sites:
  `buildAuthorCtx` / `buildAuthorCtxFor` in `generate.ts`).
- Update the `AuthorUserContext.docContext` doc comment and the authoring user-prompt
  wording that references the outline shape.
- No new cap and no silent handling in its place: if a doc ever physically exceeds the
  model context, the call fails loud (house fail-hard rule), it does not thin.
- `grep -rn AUTHOR_DOC_BUDGET` across the repo (including the token/cost estimate under
  `packages/core/src/services/llm/`) — if the estimate models the outline fallback,
  update its math to the always-full-doc shape so estimate and pipeline never drift.
- If the authoring prompt fingerprint derives from changed prompt text, let it re-key
  naturally; do not pin it.

**Tests.** `tests/guard-generator/` — update any test pinning the outline fallback;
add one proving an over-48k doc still sends full content (docContext === doc content).

## 2. CLI: authoring failures surface live, not buried in the closing summary

STATUS: BUILT 2026-07-15

**Problem.** An authoring call that times out (10-minute cap in `runners.ts`) or returns
invalid output twice is silent while it happens: unsettled sections never tick the
progress display (`generate.ts` — by design), so a timing-out call is indistinguishable
from a slow one, and its retry burns another 10 minutes with no signal. The closing
summary prints only `errors N` plus the top 3 raw error entries (16 raw attempts on
sqlfluff = 7 failed sections, 13 hidden behind "and 13 more"). CLI only — the user
explicitly does NOT want failure rows added to the dashboard generate-progress popup.

**Fix.**
- New generate progress hook (alongside the existing ones in `generate.ts`): fired the
  moment an authoring attempt fails, carrying doc, anchor, reason one-liner, and attempt
  number. The CLI (`tools/cli/src/commands/guard.ts`) renders it immediately as a warn
  line: `✗ <section leaf> — timed out after 10m, retrying (2/2)` / `— section failed,
  will retry next generate`.
- The live section counters gain a failed count: `N settled · M failed · K remaining`
  (counters are the wanted signal — no bars, house progress rule).
- Closing summary: replace the top-3 raw-errors block with ALL failed sections, deduped
  by doc+anchor, one line each — section leaf, collapsed reason (`timed out (3
  attempts)` / `invalid output twice`), and one trailing line: nothing was written for
  these, re-run generate to retry. Nothing capped.
- Dashboard generate-progress popup: unchanged.

**Tests.** `tests/guard-generator/` progress-hook emission on timeout + invalid-output
paths; `tests/cli/` summary rendering — multi-attempt errors dedupe to per-section
lines, all listed, no top-3 cap.

## 3. Coverage: error-blocked sections paint as their own status, never "unguarded"

STATUS: BUILT 2026-07-15

**Problem.** A section whose authoring failed has no manifest entry, no gap, no finding
— so `composeDocCoverage` (`packages/core/src/commands/guard-read.ts`) falls through to
`unguarded`, which reads as "nothing ever tried" when the truth is "generate tried and
failed" (observed: 7 layout.md sections on sqlfluff). Builds on the uncommitted
finding/held coverage work already in the tree.

**Fix.**
- New coverage status painted from the generate report's `errors[]`, joined by
  doc+anchor like findings/held. Distinct id (e.g. `authoring-error`) — `error` is
  already taken by the RUN outcome and the two must not conflate in totals or meta.
- Precedence keeps `held` reachable: run outcome > guarded > `finding` > `held` >
  `authoring-error`. (A held section's blocker IS an error; `authoring-error` is for
  sections whose ONLY record is errors — no findings, no ready scenarios.)
- Reason line from the deduped errors (`authoring failed — N attempts; re-run generate
  to retry`). Section detail (`GuardSectionDetail.tsx`) lists the deduped error
  messages with attempt counts — and finding/held section details also list their
  sibling authoring errors as blocker context, same join.
- Client meta: red treatment, label distinct from the run `Error` badge (e.g.
  "Authoring error"); `GUARD_STATUS_ORDER` grows 17 → 18 (update the pinned-length
  test + comment). Shared `GuardSectionCoverage` gains the error projection; totals
  backstop (`_MissingStatus`) enforces the new key. OSS and EE both render it — the
  join is server-side in core, so no EE-specific work.

**Tests.** `tests/server/guard-coverage.test.ts` — errored section paints
`authoring-error` with deduped reason, held+error section stays `held`, totals key;
client — status meta/order, section-detail error rows, coverage band rendering.

## 4. Scenarios must explain themselves — claim on the YAML, promise titles, rendered story

STATUS: BUILT 2026-07-15

**Problem.** A committed scenario is unreadable even to an engineer (sqlfluff review):
the YAML carries only the title and mechanics (setup files, argv, regex matchers). The
extracted CLAIM it defends — the doc sentence that justifies every detail — is consumed
at authoring and dropped (findings keep a `claim:` field; committed scenarios don't).
Titles state the expected output ("parse tree shows an unparsable node containing
tokens '2' and '3'") instead of the doc's promise, and both UI and CLI show raw YAML
only, so the reader has to reverse-engineer regexes to learn what is being tested.

**Fix.**
- **Persist the claim.** The scenario YAML gains `claim:` — the extracted claim text,
  written at authoring (the author batch already holds it per ref; thread it through
  serialization in `packages/guard-generator/src/serialize.ts`). Optional in the
  scenario schema so existing corpora keep loading; a regenerate backfills it.
- **Titles state the promise.** Authoring prompt rule: the title is the doc's
  behavioral promise in plain words (optionally citing the doc's example in
  parentheses), NEVER the literal expected output. Prompt fingerprint re-keys
  naturally.
- **Render the story.** One shared helper translates a scenario's mechanics to words
  (`packages/shared`, next to the expect DSL types): each `expect` matcher to a plain
  sentence ("exit code is 1", "stdout contains an `unparsable:` node listing '2' and
  '3'"), setup to a file list, `run` to the full argv. Consumers:
  - Dashboard scenario detail (and the section-detail rows): *Doc says* (claim +
    section heading) → *Setup* → *Run* → *Expect*, with raw YAML behind the existing
    toggle. Scenarios without a stored claim render the story minus the claim line.
  - CLI `guard drifts` failure detail gains the claim line ("doc says: …") so a
    failure reads as doc-vs-code, not regex-vs-stdout.

**Tests.** Schema round-trip + serializer writes `claim:`; authoring threads ref→claim
onto its scenarios; the describe-expect helper unit-tested per matcher kind; client
detail renders the story (with and without claim); drifts output includes the claim
line.

## 5. Fast-vs-economical generate: ask first, estimate for the chosen mode

STATUS: BUILT 2026-07-15

**Problem.** SPEC_GUARD_PLAN stage-4 sub-bullet, measured 2026-07-06 but never scheduled:
authoring batch size is a speed-vs-cost dial (same 4 claims — 1 call × 4 claims = 388s /
$0.87; 4 solo calls = 147s / $1.25; thinking tokens ~identical, batching serializes them,
solo re-pays the shared input context, ~1.4× cost). The user should own the dial; today
only the raw `TRUECOURSE_GENERATE_BATCH` env override exists.

**Scope.** Authoring and its retries ONLY — the one stage where independent work items
share a call. Extraction (per doc/view), fidelity (per section), and spec scan (per
doc/pair) have no batch to dial and do not change.

**Fix.**
- `guard generate` asks fast-vs-economical BEFORE the estimate, in both surfaces:
  - CLI: a two-option prompt (fast — one claim per call, parallel, ~1.4× cost /
    economical — batched, cheapest, slowest). Skipped when `TRUECOURSE_GENERATE_BATCH`
    is set (the raw override wins) or when nothing changed (no-stage estimate rule).
  - Dashboard: the same choice in the generate confirm modal, before the estimate line.
- The estimate is parameterized by the choice: fast mode prices per-claim calls (input
  context re-paid per call), economical prices per-batch calls. CLI and modal render
  identical numbers from the same `spec-estimate.ts` source (house estimate rule).
- Default: economical (current batched behavior). Remember the last choice per repo
  (`config.json`) so the prompt pre-selects it.
- `TRUECOURSE_GENERATE_BATCH` stays as the raw override for both modes.

**Tests.** Estimate math per mode (call counts + ceiling); CLI prompt flow (choice →
estimate → confirm, env override skips the ask); modal renders the mode-scoped
estimate; batch plumbing honors the choice (1 vs default 4).

## 6. Finding triage: every finding carries a verdict + how to unblock

STATUS: BUILT 2026-07-15

**Problem.** A birth/fidelity finding reports expected-vs-actual and stops — "defect or
drift, your call" — even though everything needed to make the call is already stored.
Conflicts got resolution briefs + a recommendation; findings must get the same: the tool
always recommends how to unblock, never just reports.

**Fix.**
- New generate stage after findings settle: one triage call per finding on **Opus**
  (`guard.triage: 'opus'` in `llm-models.ts` — a judgment stage, deliberately top-tier
  like the overlap verify pass). Input: the claim text, the section's own text, the
  authored YAML, expected/actual, the failing step's raw output excerpts, grounding
  probe transcripts. Output (Zod-validated): `verdict` (`doc-drift` | `code-drift` |
  `generation-defect` | `environment`), `confidence`, a one-paragraph `brief`, and a
  concrete `recommendation` — for doc-drift it QUOTES the exact doc line to change and
  the replacement; for code-drift it names the observed behavior vs the promise; for
  generation-defect/environment it recommends dismiss-or-retry with the reason.
- Stored on the finding in `result.json` (read-side pattern like `headingText`
  enrichment is NOT enough — triage is expensive, so it persists with the finding).
  Cached content-keyed on finding identity (doc, anchor, claim, expected, actual) so
  re-generates re-triage only new/changed findings. Counted in the pre-flight estimate
  as its own stage.
- Surfaces:
  - CLI `guard findings`: verdict chip + recommendation line per finding.
  - Dashboard finding detail: brief + highlighted recommended action (conflict-brief
    layout language), Dismiss wired when that is the recommendation.
  - Coverage section-detail finding rows (item 3's pane): verdict chip.
- Honesty rule: a recommendation with quoted evidence, never auto-applied — the user
  stays the judge, exactly like conflict resolution.

**Tests.** Triage runner + schema validation with re-ask; cache keying (unchanged
finding = no call); estimate includes the stage; result.json round-trip; CLI findings
renders verdict + recommendation; finding-detail UI shows the brief; verdict chip on
coverage finding rows.

---

Items 7–9 come from an 11-tracker study (sqlfluff, eslint, prettier, ruff, jq, ripgrep,
gh, pnpm, poetry, terraform, yt-dlp; ~1,500 bug reports sampled, ~90 bodies read): the
current engine's concrete-promise scenarios cover the universal config/CLI-contract
class, but three reachable bug classes need engine extensions. Build order is
evidence-ranked: examples (universal, cheapest) → invariants (severest bugs, 8/11 tools
document them) → support corpora (parser/dialect genre, reuses item 8's machinery).

## 7. Example mining — documented example blocks become scenarios

STATUS: OPEN

**Problem.** Docs are full of worked examples: a fenced code block plus the promised
outcome ("this SQL is an anti-pattern, ST07 flags it"; jq's manual gives input⇒output
per builtin — its single largest bug class, ~30%, is "documented builtin returns wrong
output"; eslint/ruff per-rule pages ship incorrect/correct pairs; poetry has an open
issue literally titled "the example in the documentation does not work"). Extraction
today reads the prose and drops the example; the input AND expected outcome are already
in the doc, so these are the cheapest scenarios the pipeline can author.

**Fix.**
- Extraction: recognize example blocks — a fenced block whose surrounding prose states
  an outcome — and emit them as a new claim flavor (`example`) carrying the block
  content verbatim plus the promised outcome. Claims stay section-bound as today.
- Authoring: an example claim's scenario uses the doc's own block as the setup file
  content (never paraphrased — byte-faithful, minus doc-escaping), and asserts the
  documented outcome (rule fires / output equals the shown output / passes clean).
  Prompt rule: the model may pick argv and matcher form but must not invent inputs.
- Both flavors ride the existing schema — no new scenario shape; birth validation,
  manifest, coverage join all unchanged.
- Estimate: example claims price like normal claims (they flow through the same
  stages); no new stage.

**Tests.** Extraction emits example claims from fenced-block + outcome fixtures (and
does NOT from bare code blocks with no stated outcome); authoring preserves block
content byte-faithfully; e2e: a doc with an incorrect/correct pair yields two
scenarios asserting flag/no-flag.

## 8. Invariant scenarios — documented always-rules checked over many inputs

STATUS: OPEN

**Problem.** The severest reachable bug class everywhere is a violated documented
invariant: "fix never breaks your code" (ruff's top bug co-label at ~28%, eslint ~13%,
sqlfluff #6733 "fix causes script corruption"), "formatting is idempotent" (prettier
states it outright; terraform fmt), "install is deterministic given a lockfile"
(pnpm). One hand-picked input can't test the word "never" — the engine needs scenarios
that run a rule over MANY inputs.

**Fix.**
- **Input-corpus store** (shared with item 9): `scenarios/corpus/<pack>/` — committed
  files + a small manifest (pack id, provenance, per-file notes). Packs referenced by
  scenarios; deleting a pack orphans its scenarios loudly.
- **Scenario schema**: `inputs: { pack: <id> }` on a scenario — steps run once per
  corpus file with the file staged into the sandbox under a stable name the steps
  reference. Property expect forms: `stableOnRerun` (step output identical when the
  step runs twice) and step-chaining ("output of step N must itself pass step M" —
  e.g. fix output re-parses / re-lints clean). Composable with existing matchers.
- **Extraction**: recognize invariant claims (always/never/idempotent/deterministic
  phrasing about the tool's behavior) as a new claim flavor (`invariant`).
- **Authoring**: an invariant claim authors ONE scenario (the rule) bound to a pack;
  round 1 seeds the pack from inputs already at hand (the doc's own example blocks
  from item 7 + repo fixtures the recipe surfaces); item 9 adds generated packs.
- **Runner + report**: per-input execution with an honest per-file report — a failure
  NAMES the failing corpus file (that file is the bug repro) and one bad file fails
  the scenario. Progress ticks per file (counters, no bars).
- **Birth validation** runs the full per-input sweep — an invariant scenario is only
  committed when the rule holds over the whole pack today.

**Tests.** Schema round-trip for `inputs`/property expects; runner per-input expansion
+ failure names the file; stableOnRerun and step-chaining matchers; birth sweep over a
pack; coverage/manifest join unchanged for invariant scenarios; orphaned-pack error.

## 9. Support-claim corpora — "supports X" tested by a generated exemplar pack

STATUS: OPEN

**Problem.** "Supports the Postgres dialect" quietly promises thousands of inputs;
docs never enumerate them, so today the claim produces nothing testable. This is the
dominant reachable class in the parser/formatter genre (sqlfluff parser bugs ~40% of
its tracker — "[oracle] `1.` can't be parsed"; prettier language-coverage ~30%; jq
RFC/number/regex claims ~17%; ruff version-syntax ~7%).

**Fix.**
- **Extraction**: recognize quantified support claims ("supports / compatible with /
  handles <language|dialect|format|syntax> X") as claim flavor `support`.
- **Exemplar-pack generation**: a support claim adds one generation call whose whole
  job is diversity — "write N diverse X inputs exercising grammar corners" — written
  to `scenarios/corpus/<pack>/` (item 8's store), committed, content-cached on the
  claim so regeneration is a no-op while the claim stands. Pack size default modest
  (~40), configurable; the estimate prices the generation call.
- **Scenario**: one per support claim — run the documented operation over the pack,
  shared boring expectation (parses clean / exits 0 / no "unparsable" in output —
  authored from what the section promises). Rides item 8's per-input runner
  unchanged.
- **The ratchet**: users drop real-world repro files into the pack directory by hand
  (a reported bug becomes a permanent regression input); the manifest marks them
  user-added so regeneration never removes them.
- Honest limit, stated in docs: the pack only catches what it samples — novel corners
  still escape until ratcheted in.

**Tests.** Extraction classifies support claims (and does NOT flag mere mentions);
pack generation writes + commits + caches; scenario runs per exemplar and failure
names the file; user-added files survive regeneration; estimate includes the
generation call.

## 10. Retry must use its evidence; authoring must carry the example's assumed environment

STATUS: BUILT 2026-07-16

**Problem.** The 2026-07-16 sqlfluff run's dominant defect pattern (5+3 of 12 defects):
scenarios copied a doc example faithfully but not the CONFIGURATION the doc assumes
around it (an indent width set by surrounding prose, a mandatory base setting), or ran
the whole tool instead of isolating the claimed behavior, so unrelated rules
contaminated the outcome. Worse: the birth retry received the tool's own error naming
the missing setup ("No dialect was specified", exit 2) as evidence and STILL did not
correct the setup — five times. The retry-with-evidence loop is the engine's general
self-heal mechanism; if it cannot act on a literal usage error, that is the root cause,
and any prompt work is secondary.

**Fix — investigation FIRST, no speculative changes.**
- Reconstruct the exact retry contexts for the run's dialect/config defects from
  `result.json` (findings carry expected/actual, raw output excerpts, and the authored
  YAML) plus the deterministic prompt builders. Determine concretely why the evidence
  did not produce a setup correction — e.g. the stderr excerpt never reaches the retry
  prompt, the "keep the claim's assertion" rule reads as "change nothing", or the
  failing step's error is drowned. Fix the MECHANISM (context content / rule wording /
  evidence placement), not the symptom.
- Then two GENERAL authoring-prompt rules (no repo-specific token may ever enter a
  prompt): (a) an example's assumed environment is part of the example — configuration
  stated in the surrounding section/document that the example depends on must be
  reproduced in `setup`; (b) a scenario verifies ONLY its claim — constrain the
  invocation (scoping flags, minimal input) so unrelated behaviors cannot contaminate
  the asserted outcome.
- Overfit guard: nothing in the change may reference sqlfluff or any concrete tool
  setting; validation is by prompt-content tests + fixture e2e (a doc whose example
  depends on config stated in a sibling paragraph), and by the numbers on the NEXT
  cross-repo run — never by making one repo's defect list zero.

**Tests.** Retry-context content test proving the failing step's raw stderr/usage error
is present and labeled; e2e fixture where the doc states config in prose above the
example — the authored scenario seeds it; prompt-content assertions for both rules.
