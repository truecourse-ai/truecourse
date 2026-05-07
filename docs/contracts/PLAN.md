# Contract Framework — Plan

Spec-driven verification: prose specs (SPEC.md, ADRs, RFCs) become typed
contract artifacts (`.tc` files), extracted by Claude Code and verified
deterministically against the implementation. Drift is reported as
violations through the existing `truecourse analyze` pipeline.

This document owns the design and phasing of the contract framework. The
top-level [PLAN.md](../PLAN.md) tracks all other product phases.

---

## Mental model

```
prose specs        contract DSL          live code
─────────────      ────────────          ─────────
SPEC.md       ┌─▶  .truecourse/    ┌─▶   src/**/*.ts
adr/*.md   ───┤    contracts/   ───┤     src/**/*.js
rfc/*.md      │    *.tc            │
              │                    │
        Claude Code            tree-sitter
        (LLM extract)         (deterministic)
              │                    │
              └──────┬─────────────┘
                     ▼
              comparators
              (10 enforced
               artifact kinds)
                     │
                     ▼
                Violation[]
                (category:
                 contract-drift)
                     │
                     ▼
              LATEST.json
              (existing baseline,
               diffed by --diff)
```

**One concept** — violations.
**Two sources** — rules (deterministic engine) and contract drift (this framework).
**One output** — `truecourse analyze` and `truecourse analyze --diff`.

---

## What's already built (Phases 1–5)

The verification half is complete and lives in
`packages/contract-verifier/`. Tests in `tests/contract-verifier/` —
**41 passing, 0 false positives on the planted-bug fixture**.

### Artifact catalog

13 artifact kinds defined; **10 enforced** (have a comparator):

| Enforced               | What it catches                                          |
|------------------------|----------------------------------------------------------|
| `Operation`            | status codes · headers · body shape · forbid clauses     |
| `Entity`               | immutable-field reassignments · missing normalize        |
| `StateMachine`         | illegal transitions · unguarded terminal regression      |
| `ErrorEnvelope`        | non-standard error response shape                        |
| `PaginationContract`   | forbidden query params · missing limit clamp             |
| `IdempotencyContract`  | routes lacking `Idempotency-Key` header handling         |
| `AuthRequirement`      | routes outside auth middleware chain                     |
| `AuthorizationRule`    | missing per-row authz predicate                          |
| `EffectGroup`/`Effect` | missing emission · forbidden emission on failure paths   |
| `Formula`              | wrong operator on threshold · unused inputs              |

Modeled but not enforced (by design):

| Not enforced             | Why                                                    |
|--------------------------|--------------------------------------------------------|
| `Enum`                   | type-only; consumed by other artifacts                 |
| `Effect` (standalone)    | sub-artifact of `EffectGroup`                          |
| `UnenforceableObligation`| explicit slot for spec sentences with no encoding form |

### Pipeline (verifier half)

```
.tc files ─▶ parser ─▶ resolver ─▶ lifters ─▶ ResolvedArtifact[]
                                               (typed contracts)
                                                      │
                                                      ▼
src/**/*.ts ─▶ tree-sitter ─▶ extractors ─▶ ExtractedOperation[]
                                              + AuthPresence
                                              + IdempotencyPresence
                                                      │
                                                      ▼
                                              comparators
                                                      │
                                                      ▼
                                              ContractDrift[]
```

### Fixture & test gate

`tests/fixtures/sample-js-project-il/` — realistic Express order-management
service with **18 planted bugs** (`// IL-DRIFT:` markers). The end-to-end
test asserts:

1. Every planted bug produces drift.
2. Set of drifts emitted ⊆ set of expected drifts (hard 0% FP gate).

---

## Surface (locked)

```
truecourse contracts generate              # specs → .tc (LLM, cached)
truecourse contracts generate --diff       # dry run, show what would change
truecourse contracts generate              # auto-bootstraps specs.yaml on first run
                                           # (no separate --bootstrap flag — the
                                           #  flow detects missing config and
                                           #  proposes inline)

truecourse contracts list                  # later: enumerate current .tc artifacts
truecourse contracts validate              # later: parse + resolve check

truecourse analyze                         # rules + verify (drifts as violations)
truecourse analyze --diff                  # diffed against LATEST.json
```

**Removed:** `truecourse verify` (we built it as a stepping stone; verification
now runs only as a stage inside `analyze`).

---

## How `analyze` integrates contracts

```
truecourse analyze
  │
  ├─ 1. extract step  (cached; runs only on spec content-hash change)
  │     spec slices ─▶ Claude Code subprocess pool ─▶ fragments
  │     fragments    ─▶ layered merge by rank      ─▶ .truecourse/contracts/*.tc
  │
  ├─ 2. verify step   (deterministic, fast)
  │     .tc + code   ─▶ comparators                ─▶ ContractDrift[]
  │     drifts       ─▶ adapter                    ─▶ Violation[]
  │                                                   (category: 'contract-drift')
  │
  ├─ 3. rules step    (existing engine)            ─▶ Violation[]
  │                                                   (category: 'rule')
  │
  └─ 4. write LATEST.json (single combined list)
```

`--diff` works with no changes to the diff layer — it already operates on
`Violation[]` from `LATEST.json`.

---

## Multi-spec layering (override semantics)

```yaml
# .truecourse/specs.yaml
specs:
  - file: SPEC.md
    rank: 0                # lowest — base spec
  - file: docs/adr/*.md
    rank: 1                # ADRs override base
  - file: docs/rfc/2026-q1.md
    rank: 2                # latest RFC wins over both
```

**Rules:**
1. Higher rank overrides lower for the same `(ArtifactKind, identity, obligationKey)`.
2. Same-rank conflicts are surfaced as diagnostics — never silently picked.
3. Every artifact carries a stack of `origin` lines (one per layered fragment),
   so any field's winning source is traceable.

---

## Progressive parsing

```
Spec slicing (markdown headings, default H2):

  SPEC.md
  ├── # Operations
  │   ├── ## POST /api/orders          ◀── slice 1
  │   ├── ## GET /api/orders           ◀── slice 2
  │   └── ## GET /api/orders/{id}      ◀── slice 3
  ├── # Entities
  │   └── ## Order                     ◀── slice 4
  └── # Authentication                 ◀── slice 5

Slice id = sha256(spec_path + heading_path + slice_text)
```

**Cache layout:**

```
.truecourse/spec-cache/                    (gitignored)
├── slices/<SliceId>.json                  fragments per slice
├── manifest.json                          (spec, heading) → SliceId
└── merge.json                             last layered-merge result
```

**Invalidation** is content-addressed: same hash → cache hit; different hash
→ one LLM call. Cost in steady state ≈ $0; cost on spec edit ≈ one call per
edited slice.

---

## LLM execution model

**Provider:** Claude Code CLI subprocess. No API key juggling — uses the
user's existing `claude` auth.

**Concurrency:** capped by `TRUECOURSE_MAX_CONCURRENCY` (defaults to
`min(os.cpus().length, 4)`). Slices are independent; we parallelize
cache-misses up to the cap.

**Per-slice call:**

```
spawn:  claude -p "<prompt>" --output-format json
        --append-system-prompt "<schema + few-shot>"
        --setting-sources project
```

**Output (JSON, Zod-validated):**

```ts
{
  fragments: [
    {
      kind: "Operation",
      identity: "POST /api/orders",
      tcSource: "operation POST \"/api/orders\" { … }",
      origin: { source: "SPEC.md", section: "POST /api/orders", lines: [120, 135] },
      obligationKeys: ["response.201", "response.201.headers.location", "response.400"]
    },
    {
      kind: "UnenforceableObligation",
      identity: "encryption.at-rest",
      tcSource: "unenforceable-obligation encryption.at-rest { … }",
      origin: { … },
      reason: "no structural encoding for at-rest encryption"
    }
  ]
}
```

`obligationKeys` matters — it's what the merger keys field-level layering on.

---

## Validation gate (catch bad LLM output)

Before writing anything to `.truecourse/contracts/`:

1. **Parse** the merged `.tc` — must succeed.
2. **Resolve** the corpus — every cross-reference must point to a known artifact.
3. **Identity uniqueness** — no duplicates after merge.
4. **Zod-validate** every fragment shape.

If any check fails: don't write. Surface the offending slice + the LLM's raw
output to the user. **Never let a bad LLM call corrupt the contract corpus.**

---

## Bootstrap flow (first run, no `specs.yaml`)

```
$ truecourse contracts generate

No .truecourse/specs.yaml found.
Scanning the repo for candidate spec documents…

Found:
  README.md                  → likely "overview" (excluded)
  SPEC.md                    → looks like a base spec
  docs/adr/0001-…0007-*.md   → ADR sequence (date-ordered)
  docs/rfc/2026-q1-orders.md → RFC superseding 2 ADRs
  CHANGELOG.md               → release notes (excluded)

Proposed specs.yaml:
  - file: SPEC.md                     rank: 0
  - file: docs/adr/*.md               rank: 1
  - file: docs/rfc/2026-q1-orders.md  rank: 2

Reasoning:
  - SPEC.md establishes the base service contract.
  - ADRs typically refine or amend the base spec; date-ordered.
  - The RFC explicitly references ADR-0006 as superseded.

Write this config? [Y/n/edit]
```

Under the hood: one Claude Code call. Walk repo → collect markdown
candidates → send list + first ~200 lines of each → ask LLM to classify and
propose ranks.

No skill, no separate command — the flow is inline in `contracts generate`.

---

## Phasing

| Phase | Scope                                                                    | Status |
|-------|--------------------------------------------------------------------------|--------|
| **1** | Parser, resolver, Operation slice (vertical end-to-end)                  | DONE   |
| **2** | Cross-cutting: ErrorEnvelope, Pagination, AuthRequirement                | DONE   |
| **3** | Entity, StateMachine                                                     | DONE   |
| **4** | AuthorizationRule, EffectGroup, Formula                                  | DONE   |
| **5** | IdempotencyContract (lifter + presence detector + comparator)            | DONE   |
| **6** | Violation schema: add `category`; map `ContractDrift → Violation`        | DONE   |
| **7** | Wire verify into `analyze` pipeline; remove `truecourse verify` command  | DONE   |
| **8** | `truecourse contracts generate` (single-spec, slice cache, Claude Code subprocess pool) | DONE |
| **9** | `truecourse contracts generate --diff` (dry run vs on-disk `.tc`)        | DONE   |
| **10**| Bootstrap flow (auto-propose `specs.yaml` when missing)                  | DONE   |
| **11**| Multi-spec layering by rank; origin-trail stacking                       | DONE   |
| **12**| Conflict surfacing (same-rank disagreements as diagnostics)              | DONE   |
| **13**| `truecourse contracts list` / `validate` subcommands                     | DONE   |

---

## Phase 6 — Violation schema unification

**Goal:** drifts and rule violations share one type, one storage, one diff path.

Changes:
- `packages/shared/` — add `category: 'rule' | 'contract-drift'` to the
  `Violation` schema. Optional `subcategory` (artifact kind) for filtering.
- `packages/contract-verifier/` — keep `ContractDrift` as the internal
  shape; add an adapter that maps it to `Violation`.
- `LATEST.json` — no schema break: `Violation[]` is already the storage
  shape; existing entries default to `category: 'rule'`.

Acceptance: existing tests pass; new test confirms a `ContractDrift` round-trips
through the adapter and matches the `Violation` Zod schema.

---

## Phase 7 — Integrate verify into analyze; remove `verify` command

**Goal:** `truecourse analyze` becomes the only verification entrypoint.

Changes:
- `packages/core/src/lib/pipeline.ts` (or equivalent) — add a verify stage
  that runs `verify({ contractsDir, codeDir })`, maps drifts to violations,
  and merges into the analyze output.
- `tools/cli/src/index.ts` — remove the `verify` command registration and
  its handler (`tools/cli/src/commands/verify.ts`).
- Update tests / docs / fixture instructions referring to `truecourse verify`.

Acceptance: `truecourse analyze` on the fixture produces the 18 contract
drifts as violations alongside any rule violations; `truecourse analyze
--diff` shows them as new/resolved deltas.

---

## Phase 8 — `contracts generate` (single-spec, no layering)

**Goal:** SPEC.md → `.truecourse/contracts/*.tc` end-to-end.

Modules:
- `packages/contract-extractor/` (new package)
  - `slicer.ts`         — markdown → slices with content hashes
  - `cache.ts`           — read/write `.truecourse/spec-cache/slices/*`
  - `claude-runner.ts`   — subprocess pool, concurrency cap
  - `prompt.ts`          — system prompt + few-shot
  - `merger.ts`          — fragments → grouped by `(kind, identity)`,
                            no layering yet (single spec)
  - `validator.ts`       — parse + resolve dry run; reject on failure
  - `writer.ts`          — write `.tc` files with `origin` lines
  - `index.ts`           — orchestrator
- `tools/cli/src/commands/contracts.ts` — `generate` subcommand
- `tools/cli/src/index.ts` — register `contracts` command group

Acceptance: deleting the fixture's `.truecourse/contracts/` and running
`truecourse contracts generate` reproduces the same `.tc` corpus that the
verifier consumes. Subsequent runs hit cache (zero LLM calls).

---

## Phase 9 — `contracts generate --diff`

Dry run: re-slice, re-extract cache misses, merge, validate, **diff against
on-disk `.tc`**, render the diff, **don't write**.

Output mirrors a unified diff with artifact-level granularity:

```
M orders/operations/post-orders.tc   response.201 (was 200)
+ orders/refund.tc                   new operation from rfc-q1.md
- billing/invoice.tc                 spec removed in rfc-q2.md
```

---

## Phase 10 — Bootstrap flow

Inline in `contracts generate`. Detects missing `specs.yaml`, walks repo,
sends candidates to one Claude Code call, proposes config with per-entry
reasoning, writes on approval. Falls back to a deterministic heuristic
(`bootstrap.ts`) when `claude` is unavailable, the call fails, or the
output fails Zod validation — so the flow always lands on a usable
proposal.

---

## Phase 11 — Multi-spec layering

- `specs.yaml` rank-aware loader (glob expansion, explicit ordering).
- Merger gains rank-based override per `(kind, identity, obligationKey)`.
- `.tc` artifacts gain stacked `origin` lines (one per fragment that
  contributed; winners marked).

---

## Phase 12 — Conflict surfacing

Same-rank fragments touching the same `obligationKey` with different content
emit `SpecConflict` diagnostics in the verify output. They block writing
unless the user resolves (edits a spec, bumps a rank, or marks one as
authoritative in `specs.yaml`).

---

## Phase 13 — `contracts list` / `validate`

Convenience subcommands; no new mechanism, just expose existing capabilities
to the CLI.

---

## Open questions (non-blocking)

- **Spec file types** — markdown-only at first. Confluence / Google Docs via
  fetch step is later.
- **Slicing granularity** — H2 default; configurable per spec in
  `specs.yaml` later.
- **Origin stacking grammar** — current parser allows one `origin` line per
  artifact; needs to allow multiple before Phase 11.
- **What happens when a spec is removed?** Fragments invalidated, artifacts
  may become orphaned → render as removals in the diff and require approval.

---

## Triggers — when each step runs

| Event                | extract                | verify   | rules   |
|----------------------|------------------------|----------|---------|
| spec edited          | ✓ (cache miss on slice)| ✓        | —       |
| code edited          | —                      | ✓        | ✓       |
| `.tc` edited by hand | — (extract is skipped) | ✓        | —       |

The verifier is the cheap deterministic step — runs every analyze. The
extractor is gated by spec content hash — runs only when a slice's text
actually changed.
