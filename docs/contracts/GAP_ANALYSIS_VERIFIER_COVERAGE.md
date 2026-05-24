# Gap analysis — verifier coverage vs Compliance drift audit

Captured 2026-05-24 from the Compliance repo audit (86 critical+high findings across 19 spec docs). The engine caught 2 (2.3%). This doc maps the remaining 84 to concrete missing capabilities in the scan / generate / verify pipeline.

## Where today's coverage comes from

`packages/contract-verifier/src/types/index.ts` declares 12 artifact kinds. Two of them — `AuthRequirement` and `Operation.response.body.shape` — are doing 100% of the work that landed in the Compliance audit overlap:

| Engine drift kind | Audit C+H caught |
|---|---:|
| `AuthRequirement → ${op}/unprotected` (route handler chain misses auth middleware) | 1 (root cause × 28 routes) |
| `Operation → response.${status}.body.shape` (response envelope keys mismatch) | 1 |

Every other artifact kind in the IL (`Entity` mutability, `Formula` operator, `StateMachine` transitions, `PaginationContract` clamping, `IdempotencyContract`, `EffectGroup`, `ErrorEnvelope`, `AuthorizationRule` ownership) is wired in the type system but has not yet fired on a real-repo drift in this audit.

## Missed findings, bucketed by engine gap

| Bucket | # findings | crit | high | What's missing |
|---|---:|---:|---:|---|
| SQL-where / filter modeling | **36** | 1 | 35 | No SQL parser anywhere in the pipeline. Date-anchor cluster (`j.completedon` vs `i.createdon`), `WHERE skuid IN (...)` narrowing, `LEFT JOIN ... IS NULL` business-rule divergence, warranty-exclusion clauses. |
| Enum value-set comparator | **15** | 4 | 11 | `EnumContract` already has `values: string[]` in the IL but no comparator reads it. Signature classification (`PARTIAL` vs `INVALID`), `is_flagged` non-PASS set (drops `OUTLIER`), threshold→class mappings. |
| Named-constant / literal-value comparator | **11** | 4 | 7 | `Formula` checks operator polarity (`>` vs `>=`) but ignores absolute literal values. Tier weights `{3,2,1,1,1,0.5}` vs `{16,8,4,2,1,0}`, `LLM_MODEL = "claude-sonnet-4-6"` vs `"google/gemini-3-flash-preview"`, `_CROP_Y_ABOVE = 12` vs `80`, env-var identifier names. |
| Forbidden-presence comparator | **12** | 5 | 7 | Spec marks features `out-of-scope` (Operation.status already encodes this) or says "must not X", but no comparator flags **existing** code/routes/files that violate. ServiceTitan downloader, Late Signature infraction, "no auth required" but auth IS enforced, AUTH_BYPASS env-var path, "CSV-only" but full Postgres backend ships. |
| JWT claim reading + scope propagation | **4** | 0 | 4 | `AuthRequirement` proves "some auth middleware is on the chain"; `AuthorizationRule` checks a single `req.auth.*` ↔ resource-field comparison. Neither models reading a named claim (`accessible_tenants`, `ap_tenant`, `permissions`) and propagating it into a `WHERE tenant_id = $claim` query scope. |
| Frontend UI tree / component presence | **3** | 0 | 3 | No model for page-tree shape, navigation type, or "Component X must exist on Page Y." All Compliance findings here came from PRD_DATA_COMPLIANCE_V1. |
| Manifest / dependency comparator | **1** | 0 | 1 | No reader for `requirements.txt` / `package.json` / `Pipfile`. Spec says `depends on anthropic`, code depends on `openai`. |
| Test-coverage obligation | **1** | 0 | 1 | No model for "every spec'd route must have N tests." Needs a test-file scanner keyed by operation identity. |
| Spec-internal contradiction surfaced as a drift | **1** | 0 | 1 | Consolidator already detects conflicts during merge; today they pause for user resolution rather than emitting verifier drifts. Surface unresolved/resolved-as-contradiction conflicts as drifts in verify-state. |

**Total missed: 84 / 86 critical+high.**

## Per-bucket sketch — what would lift coverage

### 1. SQL-where / filter modeling (36 findings — by far the biggest gap)

**Where the gap lives:** all three pipeline stages.

- **spec-consolidator / contract-extractor**: today's `business-rule` and `required-filter` claims land as free-form prose under topic `data`. To compare against SQL, the IL needs a `QueryRule` artifact: `{ entity, dateAnchor (table.column), requiredPredicates, forbiddenPredicates, joinShape }`. The LLM extractor needs a prompt path that recognizes phrases like "scope by tenant", "exclude warranty jobs", "date range is invoice.createdon" and produces structured predicates.
- **contract-extractor (code side)**: needs a SQL-aware scanner. Two viable starting points:
  - Knex AST walk — `db('jobs').where(...)` is statically inspectable in TS without a SQL parser.
  - Raw-SQL extraction — find string literals passed to `.raw(...)` / `query(...)`, parse with a tolerant Postgres parser (e.g. `pg-query-emscripten` or `libpg_query`).
  - Both: extract `{tableAliases, joinedTables, whereClauses[], dateColumns[]}` keyed by operation identity (route → handler → query).
- **verifier**: new comparator that joins `QueryRule` ↔ extracted SQL by operation identity and reports `query.date-anchor.mismatch`, `query.missing-predicate.${name}`, `query.extra-predicate.${name}`.

**Why this is the priority lever:** 36 / 84 missed findings (43%), almost entirely the date-anchor cluster + infraction-detection business rules — the exact thing this codebase IS. Coverage hop from 2.3% → ~45% with one comparator family.

### 2. Enum value-set comparator (15 findings)

**Where the gap lives:** verifier only. `EnumContract.values: string[]` is already in the IL (`packages/contract-verifier/src/types/index.ts:222`); the extractor already collects them; nothing consumes them.

**What's needed:** a comparator that grabs every code-side enum / union-type / Zod `z.enum([...])` / Python `Literal[...]` / runtime `VALID_X = {...}` set keyed by the spec's enum identity, and reports:
- `enum.${name}.missing-value.${v}` (spec value not in code)
- `enum.${name}.extra-value.${v}` (code value not in spec)
- `enum.${name}.flagging-set-mismatch` (for "is_flagged includes X" — needs slightly richer modeling: which subset of the enum triggers a downstream boolean).

The signature-classification PARTIAL↔INVALID drift surfaced in 8 different audit docs from the same root-cause enum mismatch. A single comparator catches all 8 occurrences.

### 3. Named-constant / literal-value comparator (11 findings)

**Where the gap lives:** all three stages, but extractor is the hard part.

- **spec side:** add a `Constant` artifact: `{ identity, type ("numeric"|"string"|"identifier"), expectedValue, scope (filePath|module|env-var-name) }`. Extractor already pulls constants when they appear in `Formula` thresholds; needs a path that recognizes "TIER_WEIGHTS = {...}" tables and "the model is `claude-sonnet-4-6`" sentences as constants regardless of whether they appear inside a formula.
- **code side:** scan top-level `const`/`let`/Python module-level assignments, plus `process.env.X` and `os.getenv("X")` reads, keyed by identifier name.
- **verifier:** `constant.${name}.value-mismatch` reports `expected` vs `actual` verbatim.

Catches: tier weights, LLM model name, crop pixel constants, env-var identifiers (which currently look like enum-values but are actually `Constant` of type `identifier`).

### 4. Forbidden-presence comparator (12 findings — includes 5 of the 15 criticals)

**Where the gap lives:** verifier only. The IL already encodes `status: 'out-of-scope'` on operations (line in extractor types) and Operation has `forbids[]` on responses; neither extends to "file / route / dependency / config-flag MUST NOT exist."

**What's needed:** a `ForbiddenArtifact` kind: `{ category ("operation"|"file-glob"|"dependency"|"env-var"|"feature-flag"), pattern, reason }`. Verifier negates: if any matching artifact exists, emit `forbidden.${category}.${pattern}.present`.

Concrete examples this unlocks:
- "ServiceTitan downloader is out-of-scope" → file-glob `pipeline/signature_detection/st_downloader.py` should not exist.
- "AUTH_BYPASS not allowed" → env-var `AUTH_BYPASS` should not be read by the codebase.
- "Spec says no auth" → any operation matching `path-glob /**` MUST NOT pass through auth middleware (negation of `AuthRequirement`).
- "Spec says CSV-only" → file-glob `backend/src/**/*.ts` MUST NOT exist (extreme but real for the PRD_DATA_COMPLIANCE_V1 demo prototype).

This pairs naturally with the manifest-dependency comparator (next).

### 5. JWT claim reading + scope propagation (4 findings)

**Where the gap lives:** verifier needs a new sub-rule on `AuthRequirement` / `AuthorizationRule`.

- New IL field on `AuthRequirement`: `requiredClaims: string[]`.
- New IL artifact `ClaimScope`: `{ claim, mustScopeQuery: "tenant_id"|"user_id"|... }` — links a JWT claim to a query predicate.
- Code-side extractor: detect `req.auth.X` / `req.auth.claims["X"]` reads in each route handler.
- Verifier: emit `auth.claim.${name}.unread` and `auth.claim.${name}.not-scoped-into-query`.

Pairs with the SQL-where comparator (the scope check needs to see the query).

### 6. Frontend UI tree / component presence (3 findings)

**Where the gap lives:** all three stages. This is the largest scope expansion of the bunch — the engine has no frontend artifact model today.

- IL: `PageTree`, `Component`, `NavigationStructure` artifacts.
- Code-side extractor: file-based routing already exists for backend; extend to React Router / Next.js / Vite-React conventions and JSX trees.
- Verifier: page-presence, component-on-page-presence, navigation-shape comparators.

Only 3 findings unlocked. Lowest-priority bucket for the C+H goal even though it's the most architectural lift.

### 7. Manifest / dependency comparator (1 finding)

**Where the gap lives:** new artifact + tiny extractor.

- IL: `DependencyContract` per language ecosystem: `{ ecosystem ("npm"|"pip"|"cargo"), required: string[], forbidden: string[] }`.
- Code-side extractor: parse `package.json` deps, `requirements.txt`, `Pipfile`, etc.
- Verifier: trivial set diff.

Small footprint, catches the "anthropic vs openai" dep mismatch and any future "must depend on / must not depend on" assertions.

### 8. Test-coverage obligation (1 finding)

**Where the gap lives:** new extractor + new verifier rule.

- IL: a flag on Operation, e.g. `requiresTests: { happyPath: true, errorCases: number }`.
- Code-side extractor: discover test files by convention (`*.test.ts` / `*.spec.ts`), parse `describe`/`test` blocks, key them by operation identity (path string match or explicit `@operation` JSDoc).
- Verifier: `tests.${op.identity}.missing-happy-path` / `tests.${op.identity}.insufficient-error-cases`.

Niche but cheap.

### 9. Spec-internal contradiction surfaced as a drift (1 finding)

**Where the gap lives:** consolidator already produces these; verifier ignores them.

- spec-consolidator produces `Conflict` entries in `.truecourse/.cache/consolidator/conflict-resolutions.json`. Today, unresolved conflicts pause the pipeline for user resolution and resolved conflicts disappear.
- Verifier could pull unresolved + `resolved-as-contradiction` conflicts into `verify-state.drifts` as `spec.contradiction.${subject}` drifts so they show in the dashboard's drift view alongside code drifts.

Almost free — surface what's already computed.

## Prioritization

By unlock value (findings caught per implementation unit):

1. **SQL-where / filter comparator** — 36 findings, includes all 17 of the high-confidence date-anchor cluster. The single highest-leverage thing to build.
2. **Enum value-set comparator** — 15 findings, requires only verifier-side work (IL + extractor already produce the data).
3. **Forbidden-presence comparator** — 12 findings, contains 5 of the 15 criticals in this audit; verifier-only with a new IL artifact.
4. **Named-constant / literal-value comparator** — 11 findings, broadly useful well beyond this repo (tier weights, model IDs, magic numbers).
5. **JWT claim reading + scope propagation** — 4 findings, pairs with #1 (claim scope is enforced via SQL WHERE).
6. **Frontend UI tree** — 3 findings, biggest architectural expansion for the smallest C+H payoff. Defer.
7. Manifest-dep, test-coverage, spec-contradiction — 1 finding each; cheap one-shots that round out coverage.

Building items 1–4 in order should take the engine from 2 / 86 (2.3%) caught to ~74 / 86 (~86%) of critical+high audit findings, on this audit. Building 1–5 takes it to ~78 / 86 (~91%). The last ~10% is split across UI shape (3), spec contradictions (1), manifest (1), and test coverage (1).

## Note on scope

These numbers come from one repo's audit. The bucketing here describes capabilities the engine lacks, not a promise that adding them auto-catches similar drifts elsewhere — the SQL comparator in particular has to handle whatever query layer the next target uses (Knex here, Prisma / SQLAlchemy / raw SQL elsewhere). The numbers are real for this audit; the % coverage is illustrative for any other audit until we re-run.
