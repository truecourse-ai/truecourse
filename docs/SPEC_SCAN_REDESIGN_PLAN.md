# Spec Scan Redesign — Curated Doc Corpus, Not Extracted Claims

STATUS: IN PROGRESS — Phase 0/1/2 engines DONE; the CLI (`spec scan`, `contracts generate`) now defaults to the corpus path (no flag). The claims ENGINE still backs the dashboard, EE, and legacy `spec conflicts/resolve/status` subcommands. **Value gate PASSED (2026-06-27)** — corpus-vs-claims head-to-head on two independent fixtures (Slate `sample-scheduling-saas`, js-il `sample-js-project-il`): the corpus path never loses spine coverage and is consistently more correct/complete (Slate: 9 endpoints vs claims' 0, + auth/validation rules claims dumped to `unenforceable`; js-il: same 9 real endpoints, and corpus correctly EXCLUDED 3 out-of-scope endpoints the claims path wrongly emitted). **Phase 4 (CLI) DONE (2026-06-27)** — the CLI is fully off the claims engine (corpus-native `spec conflicts`/`chains`/`status`/`docs`). Remaining: Phase 3 (delete claims engine) is still **gated by** Phase 5 (dashboard verify drift-origin resolution off `claims.json`) + Phase 6 (EE), which still call `scanInProcess`/`generateContractsInProcess`. After 5+6, the engine can be deleted.

## Implementation notes (as built)

Decisions made while implementing Phases 0–1, all consistent with the design above:

- **New `curate()` entry point, not an in-place `consolidate()` rewrite.** `consolidate()` has ~30
  consumers (CLI, dashboard, EE, workspace). To honor "both paths live across Phases 1–2" with zero
  risk, the corpus pipeline is a sibling `packages/spec-consolidator/src/curate.ts`; `consolidate()`
  (claims path) is untouched. Phase 4 wires `scanInProcess` to choose between them behind a flag (the
  scan command is NOT switched yet).
- **Relations are additive optional fields on the existing `DecisionsFile`** (`relations[]`,
  `manualAreas[]`, version still `1`), so one `decisions.json` round-trips through both paths during
  the migration. The claims-path mutation helpers preserve the new fields. Phase 3's migration shim
  bumps the version and folds `manualChains` → `relations`.
- **Area vocabulary is emergent + deterministically normalized**, not a hardcoded per-repo list (the
  engine must stay general). The classifier proposes free-form `product/concern` tags; `normalizeArea`
  (slug + synonym alias map) canonicalizes them at grouping time, with `process/{overview,goals,
  non-goals,open-questions}` as the one fixed slice.
- **Files added (Phase 1):** `corpus-types.ts` (schemas + normalization), `corpus-store.ts`,
  `area-tagger.ts`, `area-grouper.ts`, `overlap-detector.ts`, `relation.ts`, `curate.ts`. New stage
  ids in `core/config/llm-models.ts`: `spec.areaTag`, `spec.overlap`, `spec.relation`,
  `contract.enumerate`. Tests: `tests/spec-consolidator/{corpus-types,corpus-store,area-grouper,
  area-tagger,relation,overlap-detector,curate}.test.ts`.
- **Files added (Phase 2):** in `packages/contract-extractor/src/`: `corpus-reader.ts` (per-area
  generation inputs — relations applied, precedence order, process/empty excluded, DocRef→content),
  `corpus-prompt.ts` (enumerate + goal-directed generate prompts), `corpus-generate.ts`
  (`generateContractsFromCorpus`: enumerate→batch→completeness-gate, cross-area dedup via the shared
  tail), and `assemble.ts` (the merge→normalize→repair→validate tail extracted from `index.ts` so
  BOTH the claims slice-path and the corpus area-path finish identically). `merger.ts` still provides
  (kind,identity) dedup — its removal + the normalizer-dedup strengthening is Phase 3. Tests:
  `tests/contract-extractor/{corpus-reader,corpus-generate}.test.ts`. Hardened after an adversarial
  review: heading-chunked exhaustive enumeration for big docs, topological precedence ordering,
  tolerant target↔fragment coverage matching (method/slash/whitespace drift), area-local `replace`
  (no silent area-emptying), and enumerator-target de-dup.
- **CLI flipped to corpus by default (DONE):** `truecourse spec scan` now runs `curateInProcess`
  (writes `corpus.json`) and `truecourse contracts generate` runs `generateFromCorpusInProcess`
  (reads `corpus.json` → `.tc`). There is NO `--corpus` flag — corpus IS the behavior for these two
  CLI commands. The claims-scan CLI body + its `decideScanOutcome`/`summarizeExtractionFailures`
  helpers (and `tests/cli/spec-scan.test.ts`) were deleted. Drivers live in `core/spec-in-process.ts`
  (`curateInProcess`, `generateFromCorpusInProcess`, `CURATE_STEPS`, `CORPUS_GENERATE_STEPS`,
  `resolveCurateModels`/`resolveCorpusGenerateModels`); test `tests/core/corpus-in-process.test.ts`.
  - **The claims ENGINE still exists** (`scanInProcess`/`generateContractsInProcess`/`contract-extractor`
    claims path) because the dashboard server, EE, and the legacy `spec status`/`spec resolve`/
    `spec conflicts`/`spec chains`/`spec docs` subcommands still consume it. Those subcommands
    self-scan claims independently, so they keep working but now diverge from the corpus `spec scan` —
    a transitional state. Removing the claims engine + migrating those surfaces is **Phase 3 (engine)
    / Phase 4 (CLI conflict→relation commands) / Phase 5 (dashboard) / Phase 6 (EE)**.
  - The **value-gate eval** (a manual LLM run on the target repo confirming corpus contracts don't
    regress on the verifiable spine + gate completeness) should still be run to validate the corpus
    output before the claims engine is deleted in Phase 3.

## Why

Today `spec scan` extracts structured **claims** (per-block LLM → `claims.json`), merges them
by a `(topic, subject)` fingerprint, detects conflicts as JSON candidate-diffs, and
auto-resolves with Opus. On real repos this destroys value:

- **It fragments instead of consolidating.** One `users` table (~13 columns) became **25
  claims from 10 docs** — duplicated (`auth0_id` ×3), polluted with non-spec noise (a list of
  employee names, dev test fixtures), never assembled into one entity. The source `CREATE
  TABLE` is clearer than the output.
- **The intermediate is unreadable.** The Spec UI shows walls of JSON; conflict resolution
  shows N structured candidates. Unusable for a non-engineer.
- **It uses the LLM as a judge.** Auto-resolve picks a "winner" at self-reported confidence —
  the non-deterministic decision we can't trust as ground truth.

The fix is not to merge claims better. It is to **stop extracting structured data at scan
time**, and to treat the **document** — not an extracted fragment — as the unit of curation.

## The unit: the document

A `claims.json` claim, or a "section" with an id and links, is a brittle structured
intermediate — the exact thing we're deleting, just at a finer grain. So the curation unit is
the **doc itself**. The scan never disassembles a doc; it annotates it. The only structured
artifact in the whole system is the **contract**, produced later at generate time.

```
SCAN (curate docs):   discover → relevance keep/drop → tag each DOC with the AREAS it covers →
                      group docs by area → flag doc-level OVERLAPS (same area, may disagree) →
                      user resolves (replace / precedence / keep-both) →
                      persist a CURATED CORPUS (docs + area tags + relations).
                      NO claims, NO sections, NO structured extraction, NO auto-resolve.

CONFLICTS (readable): "doc A and doc B both cover <area> and disagree — which is current, or
                      keep both?" Shown as the actual prose passages. Resolution = a doc-level
                      relation, not a JSON pick.

SPEC UI:              docs grouped by area, rendered as READABLE markdown with
                      supersession/precedence badges. No JSON.

GENERATE (extract, goal-directed):  for each area, feed its relevant docs (replaced ones
                      dropped, in precedence order) to the model → it reads and produces the
                      contracts for that area. Sectioning happens TRANSIENTLY inside this call
                      (chunk a big doc by heading when needed) — never persisted.
```

Guiding principle: **the LLM proposes; deterministic code + the human + (later) the code
itself decide.** The LLM tags docs (cheap) and drafts contracts (goal-directed). It never
silently picks a conflict winner.

## Resolution: three doc-level relations

When two docs in the same area disagree, the user picks one of:

1. **replace (hard supersession).** Doc B fully replaces doc A; A is excluded from generate.
   For real version chains — `capacity-ml-plan-v1/v2/v3`, `0009 → 0009b → 0032`. This repo even
   encodes them in filenames.
2. **precedence (soft / refine).** Both docs feed generate, ordered: B wins **where they
   overlap**, A's unique content is kept. This is the case section-level supersession was
   wrongly invoked for — `auth0_id → auth0_sub` (doc `0008` refines `0003` on that one field;
   `0003`'s other fields survive). No section identity needed — precedence + generate-time
   reconciliation handles it.
3. **keep-both (peers).** Both current, neither wins — combine. e.g. auth is `DEV_USER_ID`
   (dev) **and** `Auth0` (prod), both true in different modes. This is also the **default** when
   docs in an area simply complement each other → no decision required.

Relations are doc→doc and may be **area-scoped** (`B refines A for the auth area`) so one doc
can be authoritative for one area without burying another.

## What is kept / removed / added

### KEEP
- `discovery.ts:discoverDocs` + `DocCandidate` — corpus doc index. **`.md` only**, unchanged.
- `relevance-filter.ts:filterByRelevance` (+ `deterministicSkip`, `dedupeNearDuplicates`,
  `RELEVANCE_SYSTEM_PROMPT`, KV-cache seam) — the curate keep/drop step. Already good.
- `version-chain.ts` / `version-chain-llm.ts` / `chain-recheck.ts` — **collapse into a single
  `spec.relation` stage** (doc→doc replace/precedence). Keep the deterministic filename detector
  (`version-chain.ts:detectVersionChains`, free, no LLM) + **one** LLM pass (from
  `version-chain-llm.ts`) for non-filename-obvious chains. Drop the separate conflict-triggered
  recheck (`chain-recheck.ts` two-pass machinery) — it existed only because the old pipeline
  re-checked off content conflicts. `detectedFrom: filename|llm|manual` → relation provenance.
- `runner.ts:spawnRunner` / `defaultConcurrency` + `LlmTransport` + KV-cache plumbing — reused
  to drive the per-doc area-tagger.
- `cache.ts` cache plumbing — repurposed to cache per-doc area tags (keyed by doc contentHash).
- `spec-in-process.ts:scanInProcess` shell (progress, store ingest, telemetry, transport) —
  only the inner stages + persisted artifacts change.
- `DecisionsFile#manualIncludes` (relevance force-include) + the `ManualChain` shape (already a
  doc→doc decision; generalizes into relations).

### REMOVE
- `extractor.ts` (whole), the claim bits of `prompt.ts` / `runner.ts`, `merger.ts` (whole),
  `conflict-explainer.ts` (whole), `conflict-resolver.ts` (whole) — per-block extraction,
  fingerprint merge, auto-resolve.
- `orchestrator.ts:consolidate` auto-resolve/claim plumbing — `applyAutoResolutions`,
  `collectRenderableClaims`, `synthesizeChainConflict`/`docToSyntheticClaim`,
  `enrichChainConflictsWithStats`, `filterByChainWinners`-on-claims, the second-merge recheck,
  the late chain-filter refresh.
- `claims-store.ts` (whole) + `module-detector.ts` as a claim-attribution step.
- `types.ts`: `Claim*`, `Provenance`, `ClaimKind`, `Topic`, `Conflict*`, `Resolution`,
  `Decision` (+ `decisions[]` / `candidateFingerprint`) schemas.
- `cache.ts`: `BlockCacheEntrySchema`, `EXTRACTION_PROMPT_FINGERPRINT`, the `blocks/` cache,
  `ScanState` claim/conflict fields.
- `spec-in-process.ts:resolveAllDefaultsInProcess` + the `extract/merge/explain/resolve` SCAN_STEPS.
- **No section machinery is added** (no section ids, links, or section-level supersession).

### ADD
- `area-tagger.ts` — per-**doc** classifier: read a doc, assign the **areas** it covers from a
  controlled vocab (two-level: `product / concern`, see below). Cheap (Haiku), cached by doc hash.
- `area-grouper.ts` — deterministic group of docs by area tag (+ vocab normalization).
- `overlap-detector.ts` — within an area, flag doc pairs that may **disagree**, surfaced as
  readable excerpts. Biased to flag-for-human; resolution sets a relation.
- `corpus-store.ts` — replaces `claims-store.ts`. `readCorpus`/`writeCorpus`/`hasCorpus` + the
  `CuratedCorpus` schema. Deterministic assembly from tagged docs + relations; no LLM at write time.
- `contract-extractor/src/corpus-reader.ts` — replaces `claims-reader.ts`: read the corpus,
  apply relations, build per-area generation inputs (the relevant docs in precedence order).
- A goal-directed generate prompt (rewrite of `contract-extractor/src/prompt.ts`): one area +
  its docs → **the contracts for that area** (Entity / Operations / Enum / EffectGroup …),
  newer docs winning on overlap.

## Area vocabulary

- **Two-level: `product / concern`** — e.g. `capacity-app / events`, `ccm-dashboard / events`,
  `core / users-entity`, `core / auth`, `lead-engine / serving`. The product axis is required:
  this repo has two products that share event names (the posthog "Call Center Dashboard" vs the
  "Capacity outbound app") — a flat vocab would merge them into one wrong contract.
- **Realistically ~20–30 areas + a process bucket** (`Overview`/`Goals`/`Non-Goals`/
  `Open-Questions` appear in 30–40 docs) — not a tiny 3-tag set. Controlled vocab + a
  normalization/alias map prevents drift (`auth` vs `authentication`).
- **A doc is multi-area** (a "god-PRD" like `0003` covers `users` + `auth` + `tenancy` + `RBAC`).
  That's fine: it appears in each area's generate input; the goal-directed prompt extracts only
  the relevant slice and ignores the rest (this is also how section-level noise — the employee
  list inside `0013` — is handled: the model ignores non-spec prose when extracting the users
  entity, so no scan-time section filter is needed).

## Generate: multi-doc in, many small calls out, with a completeness gate

Three findings from experiments on the real repo (numbers in *Experiment evidence* below)
shape this step. It is the hard part of the redesign — not a single call.

**1. Generate must read MULTIPLE docs.** A thing is specced incrementally across versions.
Generating the `users` entity from only the latest doc gave a broken 2-field entity; from all
three docs it gave the correct 12-field entity. So "one current doc wins" is wrong — generate
consolidates across the area's docs (the model does the merge + ignores non-spec prose; no
deterministic merger needed).

**2. A big area must be split into many SMALL calls — cut by contract count, not chars.** One
call asked to emit a whole area's contracts fails badly: on a 12k-char doc that fit easily in
one call, asking for 43 event contracts captured **0**; splitting into ~8 small calls (~5
events each) captured **39/43**. The input fit — the bottleneck is **output volume** (how many
contracts one call will produce). So the cut unit is **~10–20 target artifacts per call**,
independent of input size.

**3. Chunking alone reaches ~91%, not 100% — so a completeness gate is required.** Even chunked,
4 of 43 events slipped through. Generate must therefore verify it emitted a contract for every
target and retry the misses.

So generate per area:
1. Gather docs tagged with the area; drop `replace`-d docs; order the rest by precedence.
2. **Enumerate the targets first (cheap):** a light pass lists the area's targets (this entity,
   these N events, these endpoints) — names only, not contracts. This list is both the work plan
   and the **completeness checklist**.
3. **Generate in small batches** of ~10–20 targets per call (transiently gathering each target's
   passages across the docs; the slicer used in-memory, never persisted). Reconcile overlap by
   precedence; treat cross-area refs (shared enums, auth, error envelopes) as possibly defined
   in a `shared` area.
4. **Completeness gate:** diff emitted contracts against the step-2 checklist; **retry the
   missing targets** in focused calls until covered (or report them as gaps).
5. Run output through the existing `normalizer`/`validator`/`repair`/`writer` tail —
   **strengthened** to dedup identities across areas (since `merger.ts` is gone).

**Honest caveat on the gate:** it closes 91%→~100% *relative to the enumerated checklist* — so
it's only as complete as step 2's enumeration. If enumeration misses a target, the gate can't
catch it. This is the same "how do we know we found everything?" (extractor recall) question
that recurs; the checklist mitigates but does not guarantee it.

## Models & env overrides

Per-stage models resolve via `resolveModel(stageId)` → `TRUECOURSE_MODEL_<STAGE>` env / config
(unchanged mechanism). The stage set changes, so env vars are added/removed:

| step | stageId | default | env override |
|---|---|---|---|
| relevance keep/drop | `spec.relevance` | haiku | `TRUECOURSE_MODEL_SPEC_RELEVANCE` (kept) |
| area-tagging | `spec.areaTag` | sonnet | `TRUECOURSE_MODEL_SPEC_AREA_TAG` (**new**; load-bearing → sonnet) |
| overlap flagging | `spec.overlap` | haiku | `TRUECOURSE_MODEL_SPEC_OVERLAP` (**new**) |
| relation detection | `spec.relation` | sonnet | `TRUECOURSE_MODEL_SPEC_RELATION` (**new**; replaces `…CHAIN_DETECT`/`…CHAIN_RECHECK`). Filename detection is deterministic (no LLM); one Sonnet pass for the rest. |
| target enumeration | `contract.enumerate` | sonnet | `TRUECOURSE_MODEL_CONTRACT_ENUMERATE` (**new**) |
| contract generate | `contract.extract` | opus | `TRUECOURSE_MODEL_CONTRACT_EXTRACT` (kept) |
| repair | `contract.repair` | opus | `TRUECOURSE_MODEL_CONTRACT_REPAIR` (kept) |

**Removed env vars** (stages deleted/collapsed): `TRUECOURSE_MODEL_SPEC_CLAIM_EXTRACT`,
`TRUECOURSE_MODEL_SPEC_CONFLICT_EXPLAIN`, `TRUECOURSE_MODEL_SPEC_CONFLICT_RESOLVE`,
`TRUECOURSE_MODEL_SPEC_CHAIN_DETECT` + `TRUECOURSE_MODEL_SPEC_CHAIN_RECHECK` (→ single `…SPEC_RELATION`).

**Runtime env vars:**
- `TRUECOURSE_MAX_CONCURRENCY` — kept; now applies to every LLM stage (already wired).
- `TRUECOURSE_EXTRACT_BATCH` — **removed** (blocks-per-claim-call; claim extraction is gone).
- `TRUECOURSE_GENERATE_BATCH` — **new**; targets (contracts) per generate call, default ~10–20
  (the output-bounded cut from the experiments). Env-overridable like the old batch knob.
- `TRUECOURSE_LLM_LOG` / `TRUECOURSE_LLM_DUMP` — kept (per-call logging).

Update `STAGE_DEFAULTS` in `packages/core/src/config/llm-models.ts` accordingly (add
`spec.areaTag`, `spec.overlap`, `spec.relation`, `contract.enumerate`; remove
`spec.claimExtract`, `spec.conflictExplain`, `spec.conflictResolve`, `spec.chainDetect`,
`spec.chainRecheck`), and document the env vars in `README.md`.

## Data model

### Storage principle: reference the .md, never embed content
The corpus stores **no prose**. It references docs by **`DocRef`** = *where the .md lives*:
- OSS: a local repo path → slicer/reader reads the file.
- EE: a content-addressed **blob id** (materialized .md in `PgBlobStore`) → reader reads the blob.

All downstream stages read content through `DocRef`, blind to file-vs-blob (formalizes the
existing `DocCandidate.content?` / `docSource` seam). Because the unit is the whole doc, there
are **no section paths to drift, no H1-preamble loss, no re-match fallback** — the doc's full
content (including its `Status: / Version: / Depends on:` header) is always available.

### `.truecourse/specs/corpus.json` (committable — `LATEST.json` convention)
The curated spec; expensive to regenerate (LLM tagging) and not purely deterministic, so
teammates inherit it from git. Commit after merging to main. The per-doc tag cache keeps it
stable across re-scans (changes only where docs changed). In EE this overlay is Postgres rows.
```jsonc
{
  "version": 3,
  "generatedAt": "<iso>",
  "docs": [
    { "ref": "tasks/completed/0003-prd-auth-users-backend-foundation.md",  // DocRef
      "kind": "prd", "lastTouched": "<iso>", "status": "shipped",          // status from H1 header
      "areaTags": ["core/users-entity", "core/auth", "core/tenancy"] }
  ],
  "areas": [
    { "id": "core/users-entity", "product": "core", "concern": "users entity",
      "docRefs": ["tasks/completed/0003-...", "tasks/completed/0008-...", "tasks/completed/0013-..."],
      "overlaps": [ { "docs": ["0003-...","0008-..."], "note": "auth0_id vs auth0_sub" } ] }
  ]
}
```

### `.truecourse/specs/decisions.json` (committable — user-authored)
```jsonc
{
  "version": 3,
  "relations": [
    { "type": "replace",    "older": "capacity-ml-plan-v1.md", "newer": "capacity-ml-plan-v3.md" },
    { "type": "precedence", "older": "0003-...", "newer": "0008-...", "scope": "core/users-entity",
      "note": "0008 refines the auth0 column" }
    // (no relation = peers / keep-both)
  ],
  "manualIncludes": ["<docRef>"],
  "manualAreas": [ { "doc": "<docRef>", "areas": ["..."] } ]   // optional area-tag override
}
```

### `.truecourse/.cache/consolidator/` (derived; gitignored)
- `scan-state.json` → `{ scannedAt, docsScanned, docsKept, areaCount, overlapFlags,
  resolvedRelations, openOverlaps: [{ area, a: <docRef>, b: <docRef> }], skippedDocs? }`.
  Overlaps carry **refs**; the CLI/UI derive the passages at display time.
- `tags/<docContentHash>.json` → `{ contentHash, areaTags, cachedAt, classifierFingerprint }`
  (replaces `blocks/`; unchanged doc reuses its tags).
- REMOVED: `blocks/`, `claims.json`.

## EE / Knowledge Base (external sources)

OSS docs are repo `.md`. EE Knowledge sources are external (Notion, Confluence, web, uploads).
Same model:
1. **Materialize on ingest** — a connector writes each external source as `.md` into
   `PgBlobStore` (content-addressed). The blob is the "clone to md", needed only in EE, and a
   bonus stable snapshot of a source that can change upstream.
2. **Reference it like any doc** — the blob becomes a `DocRef`; the scan tags/groups it and
   records relations exactly as for a repo doc.
3. **Overlay in Postgres** — the corpus metadata is Postgres rows in EE vs `corpus.json` in OSS,
   same shape, behind the existing storage adapter.

One `.md` substrate (files in OSS, blobs in EE) + one thin reference overlay. Reuses
`DocCandidate.content?` / `docSource` + `PgBlobStore`; no new infra.

## Honest limit (where the LLM still reconciles)

Doc-level grouping + the three relations resolve the large majority. But some cases have no
clean human answer and still land on the generate call: genuine **concurrent disagreements**
between two current docs (e.g. a disposition-category enum that differs across three current
docs), and **multi-product overlaps** if tagging mis-assigns the product axis. For these,
generate's reconciliation is the decider — so the plan does **not** claim the LLM "never
judges"; it shrinks the judged set to a small tail. The eventual answer for that tail is
**grounding in code** (the verifier checks which variant the codebase actually implements) — a
later phase, not this one. The mitigations now: the `keep-both`/`precedence` verbs, the product
axis, and surfacing residual overlaps to the user rather than silently picking.

## Validated against the real repo (Capacity-Prototyping)

An evaluation against the actual 121 kept docs / 112 old conflicts confirmed:
- **Grouping dissolves the false-merge majority with zero decisions** — ~85–100 of 112 (e.g. the
  `users` entity's complementary column-sets, the forbidden-path cluster). The flagship
  users-shatter collapses to one area group.
- **Doc-level relations resolve the real version chains** (filename-encoded here: 0008→0013,
  0020a→0020-v2).
- **The doc unit removes the section-model's failures outright** — intra-doc "conflicts",
  emergent/​drifting section paths, lost H1 metadata, and same-doc redundancy were all
  section-specific and disappear when the doc is the unit.
- It also forced: the **product axis** (two posthog products), **area→many-contracts +
  chunking** (dispositions, 3,500-line posthog), and the **three relations incl. keep-both** —
  all folded in above.

## Experiment evidence (generate)

Run on the real repo, contracts generated with Opus:

| experiment | setup | result | conclusion |
|---|---|---|---|
| **Multi-doc** | `users` entity from latest-doc-only vs all 3 docs | 2 fields vs **12 fields** (correct, no noise) | generate must read multiple docs |
| **Chunk by output** | 43-event doc (12k chars, fits one call) — 1 call vs 8 small chunks | **0/43** vs **39/43** | bottleneck is output volume; cut by ~contract-count |
| **Completeness** | the chunked run's coverage | **39/43 (91%)**, 4 slipped | chunking alone is insufficient → need an enumerate→diff→retry gate |

Caveats: the 1-call `0` was an unparseable prose-bail (one-call is unusable either way); the
event denominator is the doc's clean implemented-events table (43); the gate's completeness is
bounded by the enumeration step's recall.

## Phased rollout

- **Phase 0 — decisions** STATUS: DONE. Area vocab locked as emergent `product/concern` +
  deterministic normalization + the fixed `process` bucket; the three relations + area-scoped
  precedence are encoded in `RelationSchema`. `.truecourse/specs/` + the committable/gitignored split
  documented in `CLAUDE.md`; per-stage model env vars documented in `README.md`.
- **Phase 1 — engine corpus** STATUS: DONE (engine). `corpus-store` + schemas; per-doc `area-tagger`,
  `area-grouper`, `overlap-detector`; relation stage collapsing the version-chain machinery; `curate()`
  produces `corpus.json`. Both paths live (claims path untouched). Tests cover tagging (+ caching +
  graceful degrade), grouping/normalization, overlap flags (+ relation-resolved skips + cap), relation
  detection (+ transitive reduction + user merge), corpus round-trip, and the full curate() flow.
  REMAINING TAIL: wire `scanInProcess` to run `curate()` behind a flag — bundled with Phase 4 (CLI).
- **Phase 2 — generate on corpus** STATUS: DONE (engine). `corpus-reader` + per-area inputs
  (relations applied, precedence order, process/empty excluded); **multi-doc consolidation** (the
  generate prompt reads all of an area's docs); **enumerate-targets → batch (~10–20 contracts/call,
  `TRUECOURSE_GENERATE_BATCH`) → completeness-diff → retry-misses → report residual gaps**;
  goal-directed enumeration + generate prompts; `shared`/`core` cross-ref instruction; cross-area
  identity dedup via the shared `assembleArtifacts` tail. Both paths live. Tests cover the gate,
  batching, gaps, dedup, enumerate caching, precedence/scope/replace. **Value gate (still required
  before Phase 3):** prove contracts don't regress on the verifiable spine (endpoints/effects/auth/
  entities) AND that the gate reaches ~full coverage vs the enumerated checklist — a manual LLM run
  on the target repo, plus the Phase-4 CLI wiring to make it runnable.
- **Phase 3 — remove claims path** STATUS: PLANNED, BLOCKED on consumer migration. Delete
  `extractor`/`merger`/`conflict-*`/`claims-store`/block cache + the claim schemas; migration shim
  maps old `manualChains`/`manualIncludes` → relations/`manualIncludes`; old claims/scan-state/blocks
  are derived → safe to delete. **Blocker:** the engine is reached via `scanInProcess`/
  `generateContractsInProcess`, still consumed by the dashboard (verify drift-origin resolution
  against `claims.json`), EE (knowledge sync / job worker / github-app / ee-db), and the legacy CLI
  subcommands (`spec docs`/`chains`/`conflicts`). Those (Phase 4/5/6) must move OFF the engine first,
  so Phase 3 deletion lands LAST. Value gate confirming the corpus output is safe to switch to is
  DONE (see STATUS).
- **Phase 4 — CLI** STATUS: DONE (2026-06-27). `spec scan` + `contracts generate` default to corpus.
  The conflict/relation surface is now corpus-native and the CLI no longer touches the claims engine:
  `spec conflicts list` (flagged within-area overlaps awaiting a relation) / `show <area>` (prose
  excerpts of the overlapping docs) / `resolve <area> --older P --newer P --replace|--precedence|
  --keep-both` (records a scoped relation + re-scans); `spec chains list/add/remove` repurposed as the
  doc→doc relation surface (`--type`/`--scope`); `spec status` is a pure corpus.json read; `spec docs`
  re-points to `curateInProcess`. REMOVED: `spec resolve --all-defaults` + `spec conflicts pick/custom/
  revoke` (claims auto-resolve has no corpus analog). New core write verbs `addRelation`/`removeRelation`
  + `curateInProcess({skipCorpusWrite})`. Tests: `tests/core/relation-helpers.test.ts`,
  `tests/cli/spec-corpus.test.ts`. CLI imports only `readCorpus`/`readCorpusDecisions` + corpus mutators.
- **Phase 5 — UI** STATUS: PLANNED. Area-grouped **prose** Spec tab (markdown + relation
  badges); passage-based conflict UX; corpus server routes; remove claim/candidate types + JSON
  rendering.
- **Phase 6 — EE** STATUS: PLANNED. Move the EE connector + `ee-data-store` to the corpus +
  relations shape (Postgres); materialize external sources to `.md` blobs; drop claims/rawClaims.

## Risks
- **Generate is the value gate.** Extraction + consolidation move into goal-directed LLM calls;
  Phase 2 must prove quality on the verifiable spine before Phase 3 deletes the old path. Both
  paths stay live across Phases 1–2.
- **The judged tail.** Concurrent disagreements + mis-tagged products fall to generate (see
  Honest limit). Keep-both/precedence + the product axis shrink it; grounding-in-code is the
  later real fix.
- **Area-tag accuracy is load-bearing.** Wrong tags → wrong generate inputs. Controlled vocab +
  normalization + the product axis + `manualAreas` override mitigate.
- **Coordinated breaking changes.** `ScanState` + server `/spec/*` shapes are shared across CLI,
  dashboard, and EE. EE is on Postgres, not files — a separate gated workstream (Phase 6).
- **Big-area context limits.** Some areas exceed one call. ADDRESSED in Phase 2: the enumerator
  chunks big docs by heading (`chunkByHeading`, transient) and unions the per-chunk target lists, so
  enumeration is exhaustive over a 3,500-line doc rather than truncated; generate truncation surfaces
  as gate-reported gaps, never a silent loss.

## What this fixes (tie-back)
- The `users` entity stops being 25 JSON shards → it's the docs tagged `core/users-entity`,
  shown as readable markdown, generating one Entity (plus the area's other contracts).
- Conflicts become "doc A says X / doc B says Y — replace, prefer one, or keep both?" in real prose.
- The Spec UI is readable. No fragile structured intermediate at any grain. The LLM never
  silently picks a conflict winner (modulo the named, shrinking tail). The contract stays the
  only structured output.

## Known gaps / follow-ups

### Workspace Knowledge conflict resolution (EE) — NOT BUILT
The repo Spec tab has full conflict resolution (overlaps → doc→doc relations → decisions →
regenerated contracts). **Workspace Knowledge (Confluence sync) does not.** The Knowledge page
(`ee/packages/client/src/KnowledgePage.tsx`) has only Sources + Contracts tabs — no corpus/overlap
view and no relations editor. Overlaps are computed during the sync curate and land in the workspace
`corpus.json`, but they're never surfaced, so a workspace conflict is only ever resolved by the
engine's automatic defaults.

Root cause is deeper than a missing UI: `syncWorkspaceCorpusInProcess`
(`packages/core/src/commands/spec-in-process.ts`) curates the synced docs but **never loads or
applies any user decisions**, and it persists only `corpus` + `contracts` (no `decisions`). Workspace
doc bodies are not stored (only the provenance ledger), so a resolution can only take effect by
**re-curating on a fresh Confluence re-sync**. A working feature therefore needs:

1. **Engine** — `syncWorkspaceCorpusInProcess` loads the stored `ws:<org>` decisions and materializes
   them into the scratch tree (as `decisions.json`) before curate so relations are folded in; persist
   the `decisions` artifact.
2. **Store** — a workspace-scoped decisions read/write API (the repo `addRelation`/`removeRelation`
   are repo-path-scoped).
3. **Routes** — `GET /api/ee/knowledge/corpus` (with overlaps) + `POST`/`DELETE
   /api/ee/knowledge/relations`.
4. **Regeneration** — enqueue a `knowledge.sync` on resolve (re-fetch → re-curate with the new
   decision → regenerate; ~0 LLM for unchanged docs via the content-addressed KV cache).
5. **Client** — surface overlaps + a resolution control on the existing Sources tab (no redundant
   doc list — Sources already lists the synced docs).
6. **Tests** for the above.

Related fix already shipped: resolving a conflict on a **repo** now enqueues `repo.contracts`
regeneration (the shared `/spec/relations` routes defer via the `background-tasks` seam; no-op in
OSS). The workspace path is the remaining half.
