# Contract Framework — Plan

Three independent modules turn scattered docs into verified intent, each
with its own CLI and dashboard UI. Code and prose stay in their own
worlds; the modules talk to each other via committable artifacts on disk.

```
docs/                   .truecourse/spec/      .truecourse/contracts/    drifts
─────────                ────────────────       ─────────────────────    ──────
PRDs, ADRs,    Module 1   modules/<m>/    Module 2   *.tc        Module 3
RFCs, tech ──▶ Spec    ──▶ module.yaml ─▶ Contract ─▶ (IL)   ──▶ Verify  ──▶ drift
specs,         Consol.    endpoints.md     Generation                     report
runbooks,      engine     auth.md
README,                   data.md
notes/*                   ...
                          decisions.json
                          shared/...
                          overview.md
                                                              code/        ▲
                                                              ─────────────┘
                                                              tree-sitter
                                                              + mount graph
```

**One product, three independent modules:**

| Module | Owns | CLI | UI |
|--------|------|-----|-----|
| **1. Spec Consolidation** | docs → `.truecourse/spec/` | `truecourse spec …` | "Spec" tab |
| **2. Contract Generation** | spec → `.truecourse/contracts/` (IL) | `truecourse contracts …` | "Contracts" tab |
| **3. Contract Verification** | IL + code → drifts | `truecourse verify …` | "Verification" tab |

Each module is shippable on its own. Each has its own caches, its own
LLM-call budget, and its own set of drift/diagnostic signals. They are
**not** routed through `truecourse analyze`. `analyze` continues to be
the rule-engine entrypoint and is unchanged by this work.

> **Reversal note:** an earlier draft of this plan folded verification
> into `analyze` (Phase 7, originally DONE). That decision is reversed —
> a separate command + UI for verification is the right product surface.
> The plumbing built in the original Phase 7 (the violation adapter, the
> `LATEST.json` integration) is preserved as an *optional* fan-out, not
> the canonical entrypoint.

---

## Module 1 — Spec Consolidation engine

**Job:** read every doc in the repo (any kind, any format), extract
**claims** about the system, merge them, surface conflicts to the user
for resolution, and emit a canonical, structured, **committable** spec
under `.truecourse/spec/`.

### Design decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Topic taxonomy | Broad: `auth`, `endpoints`, `data`, `errors`, `effects`, `overview` |
| 2 | What counts as a conflict | Any difference between claims on the same `(topic, subject)` — user confirms every one |
| 3 | Canonical markdown shape | Free-form prose (PRD-style), not structured blocks |
| 4 | LLM calls per doc section | One call does both classify + extract |
| 5 | Who writes the final markdown | LLM, from resolved claims (third call per section) |
| 6 | Where status lives | Both `module.yaml` (module-level) and per-operation (operation overrides module) |
| 7 | Default-pick policy | Engine pre-picks a default for every conflict; user reviews/overrides |
| 8 | Review surface | Dashboard-first; CLI keeps `--all-defaults`-style batch ops |
| 9 | Dashboard organization | Flat sortable/filterable list of conflicts |
| 10 | Default-pick rule | Newest source doc wins (git mtime) |
| 11 | Custom answers | Allowed — free-text override per conflict, treated as authoritative |
| 12 | Apply timing | Batch — resolutions stack in `decisions.json`; canonical regenerates only on explicit `spec apply` |
| 13 | Resolution persistence across re-scans | Past decisions stay valid; only new conflicts surface |

**Deferred (prototype with defaults, revisit after observation):**
- How `module.yaml.scope` is derived when not stated explicitly in the docs.
- What happens when a user manually edits a canonical spec file between consolidator runs.

### Design rule: claim-extraction, not document-classification

The engine has one pipeline regardless of doc kind:

```
doc → ingest → classify blocks → extract claims → merge with peers → emit canonical
```

Document kind (PRD, ADR, RFC, tech spec, runbook, README, design note,
unknown) is a **signal** that bends merge weights and prior probabilities
— it never gates which code path runs. New doc types onboard with zero
engine changes.

### Claim shape (the unit of consolidation)

```ts
interface Claim {
  id: string;
  topic: 'auth' | 'endpoints' | 'data' | 'errors' | 'effects' | 'rate-limits' | 'deps' | 'status' | 'overview';
  subject: string;        // "POST /orders", "global error envelope", "auth scheme"
  content: any;           // topic-specific shape (route, schema, rule)
  provenance: {
    file: string;
    line: number;
    quote: string;        // verbatim snippet for user review
  };
  metadata: {
    docKind: DocKind;     // hint, not gate
    status?: 'shipped' | 'planned' | 'deferred' | 'deprecated' | 'out-of-scope';
    version?: string;     // "v1", "v2" if detectable
    lastTouched: string;  // git mtime
    supersedes?: string[]; // claim IDs this overrides (set during merge)
  };
}
```

### Pipeline steps

1. **Ingest** — parse markdown, normalize headings, code blocks, tables,
   lists, front-matter. Carry git mtime + last-author signals.
2. **Classify blocks** — each section/block tagged with topics it
   touches (`auth`, `endpoints`, `data`, ...). A block can touch
   multiple topics; the LLM classifier returns a topic set.
3. **Extract claims** — structured assertions per block, schema above.
   Status markers (`Phase 1`, `V1 scope`, `Out of Scope`, `Future`,
   `Deprecated`) are preserved as `metadata.status`.
4. **Merge** — claims with same `topic + subject` collapse:
   - **Identical** → kept once.
   - **Compatible** (one subset of another) → richer wins, both kept as
     provenance.
   - **Conflicting** → emitted as a `Conflict` requiring user decision.
   Default merge weights bias toward newer mtime, higher version, and
   PRD/ADR/RFC over runbook/README — but the user always sees both in a
   conflict.
5. **Detect logical modules from spec content** — group claims by
   `subject` scope (path prefix, tag, theme). A coherent group becomes a
   module (e.g. `auth`, `memory`, `infractions`). Module names come from
   the docs' own headings when present; otherwise the LLM proposes one
   and the user confirms.
6. **Materialize** — write `.truecourse/spec/modules/<name>/` honoring
   `decisions.json`. Unresolved conflicts leave the section marked
   *partial* but never block other sections.

### Logical-module detection (spec-only, no code inputs)

The engine detects modules from **spec content alone**. It does not look
at `code/` to scaffold the spec layout — that would warp intent toward
deployment shape.

Each module declares its identity and how it claims surface area:

```yaml
# .truecourse/spec/modules/auth/module.yaml
name: auth
status: active
description: Wallet-based authentication and session management.
source-docs:
  - docs/API.md#authentication
  - docs/auth/wallet-flow.md
scope:
  paths:
    - /api/auth/**
  tags:
    - auth
last-reviewed: 2026-05-09
```

`scope` is what the verifier later uses to match this spec module to
code-side detected modules. Code-side detection runs independently in
the analyzer and stays unchanged.

### Conflict resolution UX

Same `decisions.json` is the canonical state — CLI and UI both read and
write it.

```ts
// .truecourse/spec/decisions.json
{
  conflicts: [
    {
      id: "conflict-auth-scheme-001",
      module: "auth",
      topic: "auth",
      subject: "POST /api/auth/wallet — auth scheme",
      candidates: [
        { source: "docs/PRDs/v1.md:42",  quote: "Session cookie", weight: "older" },
        { source: "docs/PRDs/v2.md:88",  quote: "Bearer JWT",     weight: "newer" }
      ],
      resolution: { pickedCandidate: 1, note: "v2 supersedes v1" },
      resolvedAt: "2026-05-09T12:00:00Z",
      resolvedBy: "user@example.com"
    }
  ]
}
```

**CLI:**

```
truecourse spec scan        # discover docs + run consolidator → produce conflicts
truecourse spec resolve     # interactive prompt walks pending conflicts
truecourse spec status      # what's resolved, what's pending, what changed
truecourse spec apply       # writes .truecourse/spec/ from current decisions
truecourse spec diff        # show unresolved drift between docs and canonical
```

**Dashboard UI:** a "Spec" tab — separate route from violations. Lists
pending conflicts with side-by-side quoted snippets, "pick A / B /
custom" buttons, write-back over WebSocket.

### Negative spec

Sections like `## Out of Scope` or `## Excluded from V1` produce
**negative claims**: "the following operations are explicitly NOT in
scope". The verifier later flags the *opposite* drift — code shipped
something the spec said is out of scope.

```yaml
# modules/infractions/module.yaml
out-of-scope:
  - id: missing-existing-motor-sn-photo
    reason: "SQL not yet written"
    source: "docs/PRDs/backend_PRDv2.md:142"
  - id: no-review-link-sent
    reason: "no send-event data"
    source: "docs/PRDs/backend_PRDv2.md:143"
```

### Version chain reconciliation

When discovery finds `backend_PRDv1.md` + `backend_PRDv2.md` (suffix
patterns, `Supersedes:` front-matter, sequential ADR numbers), the
engine surfaces a single conflict: "v2 supersedes v1?" Default proposal:
v2 wins. User can also pick "merge both" if they cover non-overlapping
surface — sub-conflicts then surface as content collisions.

### LLM cost and caching

Per-section LLM call (one section = one slice of the consolidator's
output). Cache key = `sha256(input docs hashes + topic + module-name)`.
Re-runs after doc edits invalidate only the touched sections.

```
.truecourse/.cache/consolidator/        (gitignored)
├── claims/<doc-hash>/<topic>.json      cached extracted claims per doc/topic
└── manifest.json                       what was cached for which inputs
```

---

## Module 2 — Contract Generation (IL)

**Job:** read `.truecourse/spec/`, produce `.truecourse/contracts/*.tc`
(the typed IL the verifier consumes).

This is the existing `contract-extractor` package, repurposed:

- **Input source changes** — reads `.truecourse/spec/modules/<name>/*.md`
  + `module.yaml`, not `specs.yaml` + raw docs.
- **Slicing changes** — the canonical spec is already structured; each
  section file is a natural slice. No more heading-walk over arbitrary
  prose.
- **Status awareness** — operations marked `status: planned | deferred
  | out-of-scope` get extracted but flagged so the verifier can suppress
  `implementation.missing` drifts on them.
- **Negative spec extraction** — `out-of-scope` lists become anti-spec
  artifacts the verifier checks for the opposite drift signal.

**CLI:**

```
truecourse contracts generate            # spec → IL
truecourse contracts generate --diff     # dry run, show what would change
truecourse contracts list                # enumerate current .tc artifacts
truecourse contracts validate            # parse + resolve check
```

**Cache:** `.truecourse/.cache/contracts/slices/<sliceId>.json` —
content-addressed by section-file hash. Re-runs only re-extract the
sections whose canonical-spec source changed.

`specs.yaml` becomes a legacy escape hatch — pointing the extractor at a
hand-crafted spec instead of the consolidator's output. Default path
ignores it.

---

## Module 3 — Contract Verification

**Job:** match spec modules to code modules, diff them, emit drifts.

The existing `contract-verifier` package, decoupled from `analyze`:

- **Input:** `.truecourse/contracts/*.tc` + code tree.
- **Match step:** for each spec module's `scope` selector, find code
  modules from the analyzer's detection that match by path prefix, tag,
  or explicit code-side annotation. Unmatched modules on either side
  surface as module-level drifts:
  - **`module.spec-without-impl`** — documented module nothing
    implements.
  - **`module.impl-without-spec`** — implemented module no spec
    describes.
- **Diff step:** within a matched pair, run the existing comparator
  suite — Operation, AuthRequirement, ErrorEnvelope, Pagination,
  Idempotency, Entity, StateMachine, AuthorizationRule, EffectGroup,
  Formula. Drifts now carry a `module` field for grouping.
- **Status-aware suppression:** `planned` / `deferred` operations don't
  produce `implementation.missing` drifts (known gap).
- **Negative-spec checks:** code shipping a route the spec says is
  out-of-scope produces a new `out-of-scope.implemented` drift.

**CLI:**

```
truecourse verify                        # IL + code → drift report
truecourse verify --diff                 # diff vs LATEST.verify.json baseline
truecourse verify --module <name>        # scoped to one module
truecourse verify --json                 # machine-readable output
```

**Storage:** drifts written to `.truecourse/verify/LATEST.json` (own
baseline, separate from `analyze`'s `LATEST.json`). The optional fan-out
to `analyze`'s `Violation[]` (the original Phase 7 adapter) becomes a
*publish* step — opt-in via `truecourse verify --publish-as-violations`.

---

## What's already built (the verifier half)

`packages/contract-verifier/` — **53 tests passing on the planted-bug
fixture, 0 FPs.** Recent work:

- **Cross-file mount-graph resolver** (replaces the cartesian
  prefix-cartesian hack) — resolves `app.use('/prefix', router)` across
  files via import/export tracking. 15 dedicated tests.
- **Per-slice timeout bump** (120s → 240s) for table-heavy spec
  sections.
- **EVAL_CODE harness env var** + **per-slice error surfacing** in eval
  reports — debug failures without re-running.

### Artifact catalog (unchanged)

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

### Verifier pipeline

```
.tc files ─▶ parser ─▶ resolver ─▶ lifters ─▶ ResolvedArtifact[]
                                               (typed contracts)
                                                      │
                                                      ▼
src/**/*.ts ─▶ tree-sitter ─▶ extractors ─▶ ExtractedOperation[]
                              + mount-graph    + AuthPresence
                                               + IdempotencyPresence
                                                      │
                                                      ▼
                                              comparators
                                                      │
                                                      ▼
                                              ContractDrift[]
```

### Validation gate (preserved)

Before writing anything to `.truecourse/contracts/`:
1. **Parse** the merged `.tc` — must succeed.
2. **Resolve** the corpus — every cross-reference points to a known
   artifact.
3. **Identity uniqueness** — no duplicates after merge.
4. **Zod-validate** every fragment shape.

If any check fails: don't write. Surface the offending slice + the LLM's
raw output. **Never let a bad LLM call corrupt the contract corpus.**

### Fixture & test gate

`tests/fixtures/sample-js-project-il/` — Express order-management
service with 18 planted bugs (`// IL-DRIFT:` markers). End-to-end test
asserts:

1. Every planted bug produces drift.
2. Set of drifts emitted ⊆ set of expected drifts (hard 0% FP gate).

---

## Storage layout (canonical)

```
.truecourse/                                 (per-repo)
├── spec/                                    ◀── canonical, committable
│   ├── overview.md                              cross-repo product summary
│   ├── shared/                                  cross-module rules
│   │   ├── auth-scheme.md
│   │   ├── error-envelope.md
│   │   ├── pagination.md
│   │   └── effects.md
│   ├── modules/
│   │   └── <module-name>/
│   │       ├── module.yaml                      identity + scope selector
│   │       ├── overview.md
│   │       ├── endpoints.md
│   │       ├── data.md
│   │       ├── errors.md
│   │       ├── effects.md
│   │       └── deps.md                          upstream contracts
│   └── decisions.json                           conflict resolutions
├── contracts/                               ◀── IL (.tc), committable
│   ├── _shared/                                 cross-cutting artifacts
│   ├── unenforceable/                           obligations with no encoding
│   └── <module-name>/
│       ├── operations/
│       ├── entities/
│       └── ...
├── verify/                                  ◀── verification baselines
│   └── LATEST.json                              drift report (committable)
├── .cache/                                  ◀── gitignored
│   ├── consolidator/                            spec consolidation cache
│   │   ├── claims/<doc-hash>/<topic>.json
│   │   └── manifest.json
│   └── contracts/                               IL extraction cache
│       ├── slices/<sliceId>.json
│       └── manifest.json
├── config.json                                  per-repo settings (committable)
└── .lock                                        transient
```

Global layout under `~/.truecourse/` is unchanged.

---

## CLI surface (locked)

```
truecourse spec scan                      # docs → claims → conflicts
truecourse spec resolve                   # interactive resolve
truecourse spec status
truecourse spec apply                     # write .truecourse/spec/
truecourse spec diff                      # docs vs canonical drift

truecourse contracts generate             # spec → IL
truecourse contracts generate --diff
truecourse contracts list
truecourse contracts validate

truecourse verify                         # IL + code → drift
truecourse verify --diff
truecourse verify --module <name>
truecourse verify --json
truecourse verify --publish-as-violations # opt-in fan-out to analyze

truecourse analyze                        # rules engine — unchanged by this work
truecourse analyze --diff
```

---

## Phasing

### Phase A — Verifier + IL extractor (DONE)

| Sub-phase | Scope                                                                | Status |
|-----------|----------------------------------------------------------------------|--------|
| **A.1** | Parser, resolver, Operation slice (vertical end-to-end)                | DONE   |
| **A.2** | Cross-cutting: ErrorEnvelope, Pagination, AuthRequirement              | DONE   |
| **A.3** | Entity, StateMachine                                                   | DONE   |
| **A.4** | AuthorizationRule, EffectGroup, Formula                                | DONE   |
| **A.5** | IdempotencyContract                                                    | DONE   |
| **A.6** | Violation schema unification (now becomes optional fan-out — see C.4) | DONE   |
| **A.7** | ~~Wire verify into analyze, remove `verify` command~~ — **REVERSED** in C | DONE→reversed |
| **A.8** | `truecourse contracts generate` (single-spec, slice cache, subprocess pool) | DONE   |
| **A.9** | `truecourse contracts generate --diff`                                 | DONE   |
| **A.10**| Bootstrap flow (auto-propose `specs.yaml` when missing)                | DONE   |
| **A.11**| Multi-spec layering by rank; origin-trail stacking                     | DONE   |
| **A.12**| Conflict surfacing (same-rank disagreements as diagnostics)            | DONE   |
| **A.13**| `truecourse contracts list` / `validate` subcommands                   | DONE   |
| **A.14**| Cross-file mount-graph resolver (Express sub-router stitching)         | DONE   |
| **A.15**| Eval harness: EVAL_CODE override + per-slice error surfacing           | DONE   |

### Phase B — Spec Consolidation engine (NEW)

| Sub-phase | Scope                                                                  | Status |
|-----------|------------------------------------------------------------------------|--------|
| **B.1**  | `packages/spec-consolidator/` package skeleton + `Claim` schema (Zod)  | DONE   |
| **B.2**  | Discovery — broaden doc detection (drop filename filter, classify all .md as candidates with `kind` + provenance) | DONE   |
| **B.3**  | Block slicer + per-block LLM extractor (collapsed B.4 per Q4: one call does both classify + extract) | DONE   |
| **B.4**  | (collapsed into B.3 per Q4 — single LLM call does classify + extract) | DONE   |
| **B.5**  | Merger — group claims by `topic + subject`; auto-merge identical, emit Conflict on any difference (Q2); decisions persist (Q13) | DONE   |
| **B.6**  | Module detector — derive module names from endpoint path prefixes; cross-cutting → `_shared`; manifests + scope selectors | DONE   |
| **B.7**  | Materializer — write `.truecourse/spec/modules/<name>/*.md` + `shared/*.md` from resolved claims; LLM-rendered prose (Q5); batch apply (Q12) | DONE   |
| **B.8**  | Version chain reconciliation — filename heuristic + `Supersedes:` header; surfaces as a single Conflict; resolution filters claims from non-winners before merge | DONE   |
| **B.9**  | Negative spec — out-of-scope claims emit on `module.yaml.outOfScope[]` (structural), filtered out of section prose | DONE   |
| **B.10** | Two-layer cache — `.truecourse/.cache/consolidator/{blocks,sections}/`, content-addressed | DONE   |
| **B.11** | `truecourse spec scan`                                                 | DONE   |
| **B.12** | `truecourse spec resolve` — `--all-defaults` batch path (interactive lives in the dashboard per Q8) | DONE   |
| **B.13** | `truecourse spec apply`                                                | DONE   |
| **B.14** | `truecourse spec status` / `spec diff` subcommands                     | DONE   |
| **B.15** | Dashboard "Spec" tab — pending-conflict list, side-by-side resolver UI, REST endpoints for scan/decisions/apply | DONE   |
| **B.16** | Validation gate — collapsed into `spec apply` chaining into Module 2; if IL extraction succeeds, the canonical is structurally valid. No separate gate to build. | DONE (collapsed) |
| **B.17** | Internal multi-doc fixture (`tests/fixtures/sample-multi-doc-spec/`) + end-to-end integration test with planted patterns | DONE   |

### Phase C — Module separation (CLI/UI/storage)

The original Phase 7 folded verification into `analyze`. Reversal:

| Sub-phase | Scope                                                                  | Status |
|-----------|------------------------------------------------------------------------|--------|
| **C.1**  | Restore `truecourse verify` as a top-level command (NOT removed)        | TODO   |
| **C.2**  | Module 2 reads `.truecourse/spec/` by default; `specs.yaml` falls back as escape hatch | TODO   |
| **C.3**  | Module 3 writes `.truecourse/verifier/LATEST.json` (own baseline) — full store mirror (runs/LATEST/history/diff) per `PLAN_VERIFIER_DRIFT_HISTORY.md` | DONE   |
| **C.4**  | Optional fan-out: `truecourse verify --publish-as-violations` adapts drifts into `analyze`'s `Violation[]` for users who want one combined view | TODO   |
| **C.5**  | Dashboard "Contracts" tab — IL browser, spec-vs-IL diff, regenerate trigger | TODO   |
| **C.6**  | Dashboard "Verification" tab — 3-column drifts page (stats · drifts · detail); git-based Normal/Git-Diff toggle in the header (branch + `isGitRepo` gating) mirroring analyze, showing added/resolved/unchanged vs committed `LATEST.json`; normal verify stashes (with confirm) like analyze. Module-level grouping still TODO | DONE (diff UX); module-grouping TODO |
| **C.7**  | Module-level matching: spec module `scope` → code-side detected module; emit `module.spec-without-impl` / `module.impl-without-spec` drifts | TODO   |
| **C.8**  | Status-aware suppression: `planned` / `deferred` ops don't fire `implementation.missing` | TODO   |
| **C.9**  | Negative-spec drift: `out-of-scope.implemented` when code ships something spec excluded | TODO   |
| **C.10** | Auth comparator: honor `except` clause (current FP source on Compliance eval) | TODO   |
| **C.11** | Auth-presence detector: walk mount graph upward to find ancestor middleware; recognize factory-call middleware (`buildAuthMiddleware()`, `auth(...)`, etc.) — closes 26 FPs on Compliance | TODO   |

---

## LLM execution model (shared across modules)

**Provider:** Claude Code CLI subprocess. No API key juggling — uses the
user's existing `claude` auth.

**Concurrency:** capped by `TRUECOURSE_MAX_CONCURRENCY` (defaults to
`min(os.cpus().length, 4)`). Slices/sections are independent; runners
parallelize cache-misses up to the cap.

**Per-slice call:**

```
spawn:  claude -p "<prompt>" --output-format json
        --append-system-prompt "<schema + few-shot>"
        --setting-sources project
        (timeout: 240s)
```

**Output:** Zod-validated JSON. Anything that fails validation gets
surfaced as a slice failure with the raw LLM text — never silently
dropped, never partially written.

---

## Open questions (non-blocking)

- **Spec file types beyond markdown** — Confluence / Google Docs / Notion
  exports via fetch step. Out of scope for B; revisit after the engine
  proves out on markdown.
- **Cross-repo specs** — a single product split across multiple repos.
  Out of scope for v1.
- **Spec source-of-truth in code** — TS interfaces / OpenAPI / GraphQL
  schemas as alternative inputs. Read-only for v1; let docs remain
  authoritative.
- **Skill vs subcommand for human-driven spec authoring** — the
  consolidator handles bulk import; users adding a new endpoint
  one-at-a-time should use a Claude Code skill that helps maintain the
  canonical format. Slot for it: post-B.15.

---

## Triggers — when each module runs

| Event                | spec consolidation | contracts gen | verify  | rules (analyze) |
|----------------------|--------------------|---------------|---------|-----------------|
| doc edited           | ✓ (cache miss)     | —             | —       | —               |
| `decisions.json` edit| ✓ (apply step)     | ✓ (re-extract)| ✓       | —               |
| `.truecourse/spec/` edit (manual) | —     | ✓             | ✓       | —               |
| `.tc` edited by hand | —                  | —             | ✓       | —               |
| code edited          | —                  | —             | ✓       | ✓               |

Each module runs only when its inputs changed. Caches are
content-addressed; nothing recomputes when nothing moved.
