# How contract generation and verification work

A walkthrough of the pipeline that turns prose specs into structural contracts and checks code against them. Intended for someone who's never read the code — by the end of this doc you should be able to point at any stage and explain what it does and why.

---

## 1. The problem this solves

Specs are written in prose. Code is written in code. Drift between the two — the spec says "endpoint X requires auth" but the code's route has no auth middleware on it — is the kind of thing humans miss during PR review. The engine here exists to catch that drift mechanically.

It does it by translating prose into a **structural contract** — a small typed representation of what the spec claims — and then comparing the contract against what the code actually does. Anywhere those diverge is a **drift**.

---

## 2. The pipeline at a glance

```
   spec docs (.md)                code (.ts / .js / .py)
        │                                  │
        ▼                                  │
  ┌─────────────────┐                      │
  │  spec scan      │  LLM extracts        │
  │  (claims)       │  claims from prose   │
  └────────┬────────┘                      │
           │                               │
           ▼                               │
  ┌─────────────────┐                      │
  │  spec scan      │  conflict resolution │
  │  (consolidate)  │  across docs         │
  └────────┬────────┘                      │
           │                               │
           ▼                               │
  ┌─────────────────┐                      │
  │  contracts      │  LLM emits typed     │
  │  generate       │  .tc artifacts       │
  └────────┬────────┘                      │
           │                               │
           ▼                               ▼
       .tc files            ┌──────────────────────────┐
           │                │  code-side extractors    │
           │                │  (operations, queries,   │
           │                │   enums, env vars, …)    │
           │                └──────────────┬───────────┘
           │                               │
           └───────────┬───────────────────┘
                       ▼
            ┌─────────────────────────┐
            │  verify                 │
            │  (parser + resolver +   │
            │   comparators)          │
            └────────────┬────────────┘
                         ▼
                   verify-state.json
                   (drifts list)
```

Four CLI commands map to four pipeline stages:

| Command | Stage | Outputs |
|---|---|---|
| `truecourse spec scan`      | Spec scan      | `.truecourse/specs/claims.json` |
| `truecourse spec resolve`   | Conflict resolution | `.truecourse/specs/decisions.json` |
| `truecourse contracts generate` | Contract generation | `.truecourse/contracts/**/*.tc` |
| `truecourse verify`         | Verification   | `.truecourse/.cache/verifier/verify-state.json` |

You only need to run a stage when its inputs change. Caches preserve work across re-runs.

---

## 3. Stage 1 — Spec scan

**Inputs:** `.md` files anywhere in the repo (docs/, README, PRDs).
**Outputs:** `.truecourse/specs/claims.json` — a structured tree of "claims" the docs assert.
**Implementation:** `packages/spec-consolidator/`

The scanner walks markdown files, splits each into sections (by heading), and routes each section to an LLM with a topic-specific prompt that asks "what claims does this section assert?" The topics are a fixed enum:

```
auth | endpoints | data | errors | effects | overview
```

Claims for one (module, topic) pair are merged across multiple docs that talk about the same thing. The output is a tree keyed by `module → topic → claim`, where each claim has its source doc + line range + raw quote.

Why this stage exists separately: it gives every downstream consumer (the generator, the dashboard, future tools) a single canonical view of spec content, even when the same fact appears in 5 different files.

---

## 4. Stage 2 — Conflict resolution

**Inputs:** `claims.json`
**Outputs:** `.truecourse/specs/decisions.json` (and updates to `claims.json`)

When two docs assert the same subject with different content (e.g., one PRD says response status 200, another says 201), the consolidator flags it as a conflict. The user resolves it via the dashboard or `truecourse spec resolve --all-defaults`.

Decisions persist across re-scans — re-running `spec scan` doesn't re-ask about already-resolved conflicts.

---

## 5. Stage 3 — Contract generation

**Inputs:** `claims.json` + the LLM prompt (`packages/contract-extractor/src/prompt.ts`)
**Outputs:** `.truecourse/contracts/**/*.tc`
**Implementation:** `packages/contract-extractor/`

This is where prose becomes typed contracts. It's the most complex stage, so this section is long.

### 5.1 Slices

Generation works one slice at a time. A slice is one (module, topic) pair from claims.json — e.g., `(infractions, data)`. Each slice gets its own LLM call.

Why slice? Two reasons:
- LLMs aren't great at producing structurally-correct output across long contexts. A focused 1k–10k-token slice is reliable; a 100k-token whole-spec call isn't.
- Caching. Each slice's LLM result is cached on disk keyed by `(slice content + prompt + model args)`. Change one slice → only that slice re-runs. Change the prompt → all slices re-run.

There are typically 15–30 slices per real repo. Most cold runs take 5–10 minutes total.

### 5.2 The prompt

`packages/contract-extractor/src/prompt.ts` is one large string (~900 lines today). It tells the LLM:

1. **What to do.** "You produce contract fragments from a spec slice."
2. **What output shape.** A JSON envelope: `{ fragments: [{ kind, identity, tcSource, origin, obligationKeys }] }`.
3. **The artifact catalog.** A closed list of `ArtifactKind` values — Operation, Entity, Enum, AuthRequirement, QueryRule, ForbiddenArtifact, … (full list in §6).
4. **The `.tc` grammar.** A worked example showing the syntax for every artifact kind, with comments explaining what each block means.
5. **Identity rules.** How to name each artifact (canonical paths, identity uniqueness, cross-reference format).
6. **Per-kind guidance sections.** "When you see prose X, emit artifact Y" — one section per artifact kind, with concrete trigger phrasings.

The prompt is the highest-leverage knob in the whole system. Adding a new artifact kind almost always means adding a new prompt section telling the LLM when to emit it.

### 5.3 The Claude call

For each slice:

1. Build the full prompt: system instructions + the slice's claims + "return only JSON, no prose."
2. Invoke Claude (via the `claude` CLI binary, default model controlled by `~/.truecourse/config.json`).
3. Parse the response as JSON.
4. Validate each fragment against a Zod schema.
5. Cache the (slice-id → fragments) mapping on disk.

Failure modes:
- **JSON parse error.** Claude sometimes returns prose ("Looking at this spec…") instead of JSON. The slice is marked failed. Retrying the run re-invokes Claude; sometimes the retry succeeds.
- **Schema validation error.** Fragment shape is wrong. Goes through a "repair" pass that re-prompts Claude with the specific error.
- **Timeout.** Default 600s per slice. Long prompts + complex slices can hit it.

### 5.4 Merging

Once every slice has been processed (or failed), the merger collects fragments across slices and groups them by `(kind, identity)`. The same artifact can be partially defined in multiple slices — e.g., `Entity:Order` might pick up fields from `data` and constraints from `effects`. The merger combines them into a single artifact.

### 5.5 Validation gate

Before any `.tc` files are written, the merged artifacts go through a validation pass:

1. **Parse.** Each artifact's `tcSource` is parsed by the verifier's parser (`packages/contract-verifier/src/parser/`). Syntax errors → HARD validation issue.
2. **Resolve.** The parsed artifacts go through the resolver (`packages/contract-verifier/src/resolver/`). Duplicate identities → HARD. Cross-references that don't resolve to any known artifact → SOFT (unresolved refs don't block, but are surfaced).

Artifacts with HARD issues are dropped; the rest are written. Soft issues (unresolved refs) are reported to the user but the rest of the corpus still ships. This is intentional — one bad LLM artifact shouldn't kill an otherwise-good batch of 100.

### 5.6 Writing

Valid artifacts are written to `.truecourse/contracts/<artifact-folder>/<identity>.tc`. The folder structure groups related artifacts (e.g., `contracts/no-payment-collected/` contains all artifacts about that one endpoint).

### 5.7 Repair (optional)

If validation fails on cross-refs, the repair pass tries to re-prompt the LLM for the missing artifacts. Disabled by default in some flows for speed.

---

## 6. The IL (intermediate language)

The IL is the typed shape of a contract. It's defined in `packages/contract-verifier/src/types/index.ts`. There are ~16 artifact kinds today; each has its own typed Contract shape.

| Kind | What it models | Where the bulk of behavior lives |
|---|---|---|
| Operation | An HTTP endpoint (method, path, request, responses) | comparator/operation.ts |
| Entity | A domain entity (fields, types, mutability) | comparator/entity.ts |
| Enum | A closed value set + named subsets that trigger behavior | comparator/enum.ts |
| StateMachine | Legal transitions on an entity's state field | comparator/state-machine.ts |
| AuthRequirement | "These endpoints require this auth scheme" | comparator/auth-requirement.ts |
| AuthorizationRule | Per-row authz predicate (e.g., "owner-only") | comparator/authorization-rule.ts |
| ErrorEnvelope | Standard error response body shape | comparator/error-envelope.ts |
| PaginationContract | How list endpoints paginate | comparator/pagination.ts |
| IdempotencyContract | Routes that must read an idempotency key | comparator/idempotency-contract.ts |
| EffectGroup | Events that must (or must-not) fire on a code path | comparator/effect-group.ts |
| Formula | A business-logic calculation (formula + threshold) | comparator/formula.ts |
| QueryRule | Predicates a data-fetching query must / must not include | comparator/query-rule.ts |
| ForbiddenArtifact | A file / env-var / dep / flag that must not exist | comparator/forbidden-artifact.ts |
| NamedConstant | A literal value the spec asserts (identifier → expected value) | comparator/named-constant.ts |
| ArchitectureDecision | A system-wide platform/framework/data choice (Postgres, REST, Kafka) | comparator/architecture-decision.ts + extractor/architecture/ |
| UnenforceableObligation | A spec sentence with no structural encoding | (not compared) |

Adding a kind = (1) extend `ArtifactKind` union in types/index.ts, (2) add a lifter in resolver/lifters/, (3) add a prompt section, (4) add a comparator. Done in 4 PR-sized chunks.

---

## 7. Stage 4 — Verification

**Inputs:** `.truecourse/contracts/**/*.tc` + the code directory (`codeDir`)
**Outputs:** `.truecourse/.cache/verifier/verify-state.json`
**Implementation:** `packages/contract-verifier/`

This stage answers one question per artifact: does the code do what this contract says?

### 7.1 Spec side: parse + resolve

1. **Parse.** Each `.tc` file goes through the parser. Comments, blocks, references, and lists become a typed statement tree.
2. **Lift.** Each statement tree gets lifted into a typed `ResolvedArtifact{kind, ref, contract}` — kind-specific lifters produce the contract bodies.
3. **Resolve.** Build an index keyed by `<Kind>:<identity>`. Every cross-reference (e.g., `Entity:Order` referenced from `Operation:"POST /api/orders"`) is checked against this index.

The output is a `Map<refKey, ResolvedArtifact>` — every contract, typed and ready.

### 7.2 Code side: extractors

Code-side extractors live in `packages/contract-verifier/src/extractor/`. Each extracts one kind of structural fact from JS/TS code, producing artifacts in the **same shape** the spec-side lifter produces. The comparator then doesn't care which side came from where — it just diffs two `OperationContract` values, or two `EnumContract` values.

| Extractor | What it produces | How |
|---|---|---|
| `operation.ts` | Operations from Express-style routes (`router.get(...)`) | tree-sitter walk |
| `file-based-routes.ts` | Operations from Next.js / Astro / SvelteKit conventions | filesystem walk |
| `mount-graph.ts` | Cross-file router mount chains (`app.use('/api', router)`) | combines info across files |
| `auth-presence.ts` | Whether each route's handler chain passes through known auth middleware | name-resolution |
| `idempotency-presence.ts` | Whether each route reads `Idempotency-Key` header | handler body walk |
| `query/knex.ts` | Knex chained-builder queries (`db('jobs').where(...)`) | AST walk |
| `query/prisma.ts` | Prisma queries (`prisma.user.findMany({where:{...}})`) | AST walk |
| `query/raw-sql.ts` | SQL strings passed to `.raw()`, sql\`...\`, top-level SQL consts | regex over extracted strings |
| `enum/ts-enums.ts` | TS unions, ts enums, Zod enums, `as const` objects, named sets/arrays | AST walk |
| `forbidden/index.ts` | File presence (glob), env-var reads, package.json deps, feature flags | mix of fs walk + AST + JSON read |
| `constant/ts-constants.ts` | Top-level const literals, object properties, default args | AST walk |
| `architecture/` | The platform/framework/data choices the code actually makes | per-category detectors (see §7.6) |

Each extractor scans the whole `codeDir` once at the start of `verify` and produces a list of typed artifacts. The orchestrator then dispatches each spec contract to the right comparator.

### 7.3 Comparators

A comparator is a function:
```ts
compareX(input): ContractDrift[]
```
It takes the spec contract + the code-side observations, and returns zero or more `ContractDrift` records describing how they diverge. Each drift includes:
- `obligationKey`: stable string identifying what's wrong (e.g., `response.201.body.shape`, `query.predicate.missing.warranty_id.is-null`)
- `severity`: critical / high / medium / low / info
- `filePath`, `lineStart`, `lineEnd`: where in the code
- `message`: human-readable summary
- `specSide`, `codeSide`: side-by-side fragments for the dashboard

Severities are picked by the comparator based on impact. An auth-missing on a real route is critical; a date-binding mismatch on an analytics query is medium; an unparseable predicate is info.

### 7.4 Drift output

All drifts get collected into a single `verify-state.json`:
```json
{
  "verifiedAt": "...",
  "contractsDir": "...",
  "codeDir": "...",
  "artifactCount": 247,
  "extractedOperationCount": 38,
  "drifts": [ { id, type, artifactRef, obligationKey, severity, filePath, lineStart, lineEnd, message, specSide, codeSide }, ... ],
  "resolverErrors": [...],
  "unresolvedRefs": [...]
}
```
The dashboard reads this file directly. The CLI prints a summary table from it.

### 7.5 Dedup

Two dedup passes happen during verification:
1. **Within-comparator dedup.** Each comparator dedupes its own emissions by `(obligationKey, file, line)`. Without this, e.g., raw-SQL CTE splitting produces the same warranty-flag drift once per CTE.
2. **Cross-rule dedup.** In the orchestrator: when multiple rules of the same kind share an obligation key + file + line, keep the first.

Without dedup the verify-state.json would have ~10,000 entries on a real repo; with it, ~150.

### 7.6 ArchitectureDecision — a different shape of detector

Most artifacts diff one spec contract against one code-side counterpart of the same shape (two `OperationContract`s, two `EnumContract`s). `ArchitectureDecision` is different: there's no single code object to extract. The claim is **system-wide** — "we use Postgres", "REST not GraphQL", "Kafka for messaging" — so the code side is *evidence gathered across the whole repo*, not one declaration.

Implementation lives in `packages/contract-verifier/src/extractor/architecture/`.

**Categories.** Each decision has a `category` from a closed enum (`data-store`, `communication-pattern`, `messaging`, `architecture-style`, `auth-strategy`, `frontend-framework`, `runtime`, `deployment-platform`, `package-manager`, `build-system`) and a `chosen` value from that category's known set (`data-store → postgres | mysql | mongodb | …`). There's one **detector** per category (`data-store.ts`, `messaging.ts`, …).

**Three signal layers.** Detectors don't parse one file — they compose three shared signal collectors over the whole `codeDir`, built once per verify run into a `CodebaseScan`:

1. `shared/package-json.ts` — declared dependencies across every `package.json` (`pg`, `mongoose`, `kafkajs`, …).
2. `shared/characteristic-imports.ts` — module specifiers in TS/JS (`import { Pool } from 'pg'`, `from '@trpc/server'`).
3. `shared/config-files.ts` — presence and content of named config files (`vite.config.ts`, `prisma/schema.prisma` with `provider = "postgresql"`, `serverless.yml`, lockfiles, …).

Each detector declares, per choice, which of these signals prove it (see `shared/detect.ts`, which turns a list of `ChoiceSpec`s into a `DetectedArchitectureChoice`). The dispatcher runs **only** the detectors the spec's `ArchitectureDecision` artifacts actually ask for, and caches the result per `(category, scope)` so two `data-store` rules don't double-scan.

**The drift trichotomy** (`comparator/architecture-decision.ts`):

| Drift | When | Severity |
|---|---|---|
| `architecture.${category}.unmet-choice` | the `chosen` value isn't among the observed choices | critical |
| `architecture.${category}.forbidden-alternative` | a *different*, signal-backed choice is in use (e.g. spec says postgres, but `mongoose` is also present) | critical |
| `architecture.${category}.inconclusive` | no signal from any alternative was found — the claim isn't testable from current signals | info |

**The absence sentinel.** The tricky part is telling "we looked and there's definitely none of it" apart from "we can't tell." A detector can record an **absence observation** — a choice with *empty signals* — for categories where absence is itself an answer (messaging `none`, runtime `node`). The comparator treats an empty-signal observation as evidence for `unmet-choice` but **never** as a forbidden alternative. So:

- messaging with no broker client ⇒ observes `none` (determinate) ⇒ a spec asserting Kafka is `unmet-choice`.
- build-system with no `vite.config`/`webpack.config`/`tsconfig` at all ⇒ *no* observation ⇒ `inconclusive` (we genuinely can't tell), not a false `unmet-choice`.

This is exercised end-to-end in `tests/fixtures/sample-js-project-il/` (ADRs in `docs/adr/`, contracts in `reference/contracts/_shared/architecture.tc`): one fixture each for `unmet-choice`, `forbidden-alternative`, and `inconclusive`, plus a satisfied `communication.rest` positive control that fires no drift.

---

## 8. The .tc grammar

`.tc` files are written by the LLM (during `contracts generate`) and read by the verifier's parser. The syntax is block-structured with curly braces:

```
operation POST "/api/orders" {
  origin SPEC.md "POST /api/orders" 100..115
  status shipped
  request {
    header content-type required value "application/json"
    body {
      subtotalCents: integer >= 0
      customerId: uuid references Entity:Customer
    }
  }
  response 201 on success {
    body Entity:Order
    header location required format "/api/orders/{id}"
    effect emits Effect:order.placed
  }
  response 401 inherits AuthRequirement:auth.bearer.api
}
```

Key syntax rules:

- **Comments** start with `//`.
- **Cross-references** are single tokens: `Entity:Order`, `Operation:"POST /api/orders"`. Quoted form for identities with special characters.
- **Lists** use `[a, b, c]` (commas required).
- **Block contents** are one statement per line (no commas between statements).
- **Path params** are RFC 6570 form: `{name}`, not `:name`.

The parser is tolerant of whitespace and order — only structural requirements (block presence, identifier types) are enforced. The lifter converts a parsed tree into a typed contract.

---

## 9. Where files live (storage layout)

```
.truecourse/                              ← per-repo, mostly gitignored
├── specs/                                 ← Stage 1+2 output
│   ├── claims.json                        ← all extracted claims, keyed module → topic
│   └── decisions.json                     ← user conflict resolutions (committable)
├── contracts/                             ← Stage 3 output (committable)
│   ├── core/
│   │   ├── core.jobs.tc
│   │   └── core.invoices.tc
│   ├── infractions/
│   │   └── infractions.detection.events.tc
│   └── _shared/
│       └── auth.bearer.api.tc
└── .cache/                                ← machine-generated, gitignored
    ├── extractor/                         ← per-slice LLM result cache
    │   ├── manifest.json
    │   └── slices/<sliceId>.json
    ├── consolidator/                      ← scan state + conflict state
    │   ├── scan-state.json
    │   ├── conflict-resolutions.json
    │   └── ...
    └── verifier/
        └── verify-state.json              ← Stage 4 output, latest verify run
```

A few notes:

- **`contracts/` is checked into git.** That way, a fresh clone or worktree inherits the canonical contracts without having to re-run `generate` (and pay the LLM cost).
- **`.cache/extractor/slices/` is large** — one JSON per slice, sometimes hundreds. Always gitignored.
- **`verify-state.json` is overwritten every verify run.** No history today (see `PLAN_VERIFIER_DRIFT_HISTORY.md` for the planned change to a `LATEST.json`-like structure).

The dashboard reads from these same paths — it doesn't have its own database.

---

## 10. Glossary

- **Artifact** — a typed contract entity. Each .tc declaration becomes one artifact (or sometimes several, for compound kinds like EffectGroup).
- **Claim** — a single assertion the spec scanner extracted from prose. Pre-contract; lives in `claims.json`.
- **Comparator** — a function that diffs one artifact's spec side against the code side.
- **Drift** — one specific divergence between a spec contract and the code. The unit the dashboard surfaces.
- **Extractor** — code that reads the source repo and produces typed observations (operations found, queries seen, enums declared).
- **Fragment** — what the LLM produces during contract generation. Pre-merge; one slice can emit many fragments. The merger turns fragments into artifacts.
- **IL** — intermediate language, i.e., the typed Contract shapes in `types/index.ts`.
- **Lifter** — code that takes a parsed `.tc` statement tree and produces a typed Contract value.
- **Obligation key** — stable string identifying a specific drift kind (e.g., `response.401`, `query.predicate.missing.warranty_id.is-null`). Used for stable drift identity across runs.
- **Resolver** — the pass that builds the artifact index, checks cross-references, and produces `ResolvedArtifact[]` for downstream comparators.
- **Slice** — one (module, topic) chunk of `claims.json`. The unit of LLM extraction.

---

## 11. How a change to the engine flows through

If you're adding a new artifact kind (or extending one), the standard 6-step flow:

1. **Add the type.** New `ArtifactKind` value + new `*Contract` interface in `packages/contract-verifier/src/types/index.ts`.
2. **Add the lifter.** New file in `packages/contract-verifier/src/resolver/lifters/`. Register in `resolver/index.ts`'s dispatch.
3. **Add the comparator.** New file in `packages/contract-verifier/src/comparator/`. Export from `comparator/index.ts`.
4. **Add the code-side extractor.** New folder in `packages/contract-verifier/src/extractor/` (queries, enums, forbidden each have their own subdir).
5. **Wire the orchestrator.** Add a per-artifact loop in `verify.ts` that dispatches to your comparator with the extractor's output.
6. **Add a prompt section.** In `packages/contract-extractor/src/prompt.ts`, describe when the LLM should emit this kind and give a worked example.

Tests live in `tests/contract-verifier/` (one file per concern: parser, lifter, comparator, extractor, end-to-end). The standard pattern is: synthetic fixtures in TS strings for unit tests, real-repo `verify()` calls for end-to-end.

---

## 12. What the engine can't do today

For honesty:

- **Python parsing.** All extractors are JS/TS only. Python files in the codebase are skipped during extraction.
- **Cross-language references.** A Python infraction-detection script that produces results consumed by a TS API can't be tracked end-to-end.
- **Behavioral predicates.** "The handler must call `audit.log()` somewhere" works for emits/effects (via EffectGroup); "the database must be read-only" doesn't (no model for "write-operation absent").
- **Drift history.** verify-state.json is overwritten every run; no time series, no diff-vs-baseline. See `PLAN_VERIFIER_DRIFT_HISTORY.md`.
- **Required-presence inverse.** ForbiddenArtifact catches "X exists but shouldn't"; ArchitectureDecision adds the symmetric "the codebase must use X" for system-wide platform/framework/data choices (`unmet-choice`), and Operations get `implementation.missing`. But there's still no general "this specific file/dependency/symbol must exist" for arbitrary non-Operation artifacts.

These are all known and tracked in the gap analysis (`GAP_ANALYSIS_VERIFIER_COVERAGE.md`).
