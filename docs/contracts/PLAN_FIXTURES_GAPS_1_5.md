# PLAN — Fixture extension for gaps 1–5

Status: DONE (implemented 2026-05-26, il-framework branch). All gaps 1–5 are wired into `tests/fixtures/sample-js-project-il/` and `verify-end-to-end.test.ts` is green (drift set ↔ marker set, both directions). Gap-5 engine (PLAN_GAP_5_ARCHITECTURE_DECISION.md) is implemented and green.
Tracking: depends on gap-5 implementation (PLAN_GAP_5_ARCHITECTURE_DECISION.md). The fixture for gap 5 was built BEFORE the engine implementation, so the gap-5 tests are the TDD harness.

## Goal

Extend the verifier's existing IL fixture (`tests/fixtures/sample-js-project-il/`) so it exercises every drift kind the engine emits across gaps 1–5. Use the existing `// IL-DRIFT:` marker pattern: each planted bug is annotated with a comment giving the exact drift key it expects to fire. `verify-end-to-end.test.ts` already enforces drift-set ↔ marker-set equality (both directions), so adding markers automatically tightens coverage.

## Why this fits in one fixture

`sample-js-project-il/` is the only place we run multi-artifact end-to-end verification today. The marker-equality test assertion at `tests/contract-verifier/verify-end-to-end.test.ts:72-73` enforces that every fired drift has a marker AND every marker has a fired drift — meaning we get false-positive AND false-negative protection by adding markers.

22 markers exist today covering older artifact kinds (Operation, Entity, AuthRequirement, AuthorizationRule, ErrorEnvelope, PaginationContract, IdempotencyContract, EffectGroup, Formula, StateMachine). Zero markers exist for the gap-1-5 artifact kinds.

## Drift-key format

The test extracts marker text after `// IL-DRIFT:` and compares to `${type}:${identity} / ${obligationKey}` for each drift. Examples already in the fixture:

```
// IL-DRIFT: AuthRequirement:auth.bearer.api / POST /api/customers/unprotected
// IL-DRIFT: Formula:order.discount-cents / expression.threshold-operator.10000
// IL-DRIFT: PaginationContract:pagination.cursor.standard / GET /api/orders/forbid.query-param-offset
```

New markers follow the same shape.

## Scope decisions (locked)

- **Extend the existing fixture** — do NOT create a new dir. Same Order/Customer/LoyaltyTier domain, same test wiring.
- **Sampler approach for data adapters** — use ALL three (Knex, Prisma, raw-SQL) in different repo files so gap-1 fixtures exercise the full adapter contract.
- **One planted bug per drift-kind variant** — each comparator's drift-kind catalog gets at least one fixture firing. Multiple bugs only when shape variations matter (e.g., column-vs-literal vs column-vs-column for QueryRule).
- **Gap-5 fixtures land BEFORE the gap-5 engine work** — they serve as the TDD test set. Expected: tests RED until gap-5 implementation green.

## Required fixture additions

### Shared: add a data layer

The fixture currently uses an in-memory `Map` (`code/src/repos/orders.repo.ts`). Replace internals of the existing repos to use real DB adapters so QueryRule has something to bind to. Three repo files, three adapters:

- `code/src/repos/orders.repo.ts` — convert to **Knex**: `db('orders').where(...)`
- `code/src/repos/customers.repo.ts` — convert to **Prisma**: `prisma.customer.findMany({where: {...}})` (add a `prisma/schema.prisma`)
- `code/src/repos/loyalty.repo.ts` — NEW file, uses **raw SQL**: `db.raw("SELECT … FROM loyalty_tiers WHERE …")`

Public API surface (the functions controllers call) stays the same. Drift only at the implementation level inside each repo.

This also gives gap 5 (data-store detection) something to detect: package.json gains `pg` + `@prisma/client` + Prisma schema declares `provider = "postgresql"`.

### Gap 1: QueryRule (5 drift-kind variants × 1+ each)

Add reference contracts under `reference/contracts/orders/queries.tc` and `reference/contracts/customers/queries.tc`:

```
query-rule orders-list.tenant-scope {
  origin SPEC.md "Orders queries" 200..220
  entity Entity:Order
  required { eq orders.tenantId "<param>" }     // any tenant param
}

query-rule orders-list.date-anchor {
  entity Entity:Order
  date-range-binding column orders.placedAt    // <-- code WRONG: uses createdAt
}

query-rule orders-list.no-soft-deleted-included {
  entity Entity:Order
  forbidden { is-null orders.deletedAt }       // <-- code WRONG: filters them out
}

query-rule customers-list.status-allowlist {
  entity Entity:Customer
  required { in customers.status ["active", "pending"] }  // <-- code: ["active"] only → value-mismatch
}

query-rule loyalty-tiers.allowed-tiers {
  entity Entity:LoyaltyTier
  required { in tiers.code ["bronze", "silver", "gold"] }
}
```

Planted bugs (with markers):

```ts
// code/src/repos/orders.repo.ts
// IL-DRIFT: QueryRule:orders-list.tenant-scope / query.predicate.missing.tenantId.eq
// IL-DRIFT: QueryRule:orders-list.date-anchor / query.date-binding.column-mismatch
// IL-DRIFT: QueryRule:orders-list.no-soft-deleted-included / query.predicate.forbidden-present.deletedAt.is-null
const rows = db('orders')
  .where('createdAt', '>=', from)        // wrong date column
  .where('createdAt', '<', to)
  .whereNull('deletedAt');               // forbidden: excludes the soft-deleted rows
```

```ts
// code/src/repos/customers.repo.ts (Prisma)
// IL-DRIFT: QueryRule:customers-list.status-allowlist / query.predicate.value-mismatch.status.in
return prisma.customer.findMany({
  where: { status: { in: ['active'] } },  // missing 'pending'
});
```

```ts
// code/src/repos/loyalty.repo.ts (raw SQL)
// IL-DRIFT: QueryRule:loyalty-tiers.allowed-tiers / query.unparseable
return db.raw(`
  SELECT * FROM loyalty_tiers
  WHERE EXISTS (SELECT 1 FROM tier_constraints WHERE …)  -- sub-query: unparseable
`);
```

### Gap 2: Enum.triggerSubsets (5 drift-kind variants)

Existing fixture has `OrderStatus` enum. Extend `reference/contracts/orders/order-status.tc`:

```
enum OrderStatus {
  values [placed, paid, shipped, delivered, cancelled]
  trigger-subset non-terminal [placed, paid, shipped]
  trigger-subset refundable   [paid, shipped]
}
```

Code side: add named sets with intentional drift:

```ts
// code/src/types.ts
// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.non-terminal.missing-value.placed
const NON_TERMINAL_STATUS = new Set(['paid', 'shipped']);          // missing 'placed'

// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.subset.refundable.extra-value.placed
const REFUNDABLE_STATUS = new Set(['placed', 'paid', 'shipped']);  // extra 'placed'

// IL-DRIFT: Enum:OrderStatus / enum.OrderStatus.extra-value.archived
type OrderStatus = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'archived';
```

(The original code in the fixture has `type OrderStatus = 'placed' | 'paid' | ...`. Add `'archived'` for the extra-value variant. The `missing-value` variant comes from a stricter spec list — already handled by `extra-value` here since both directions diff.)

Add a separate reference enum with a `missing-value` flavor:

```
enum CustomerTier {
  values [bronze, silver, gold, platinum]   // <-- code-side missing 'platinum'
}
```

```ts
// IL-DRIFT: Enum:CustomerTier / enum.CustomerTier.missing-value.platinum
type CustomerTier = 'bronze' | 'silver' | 'gold';   // platinum missing
```

`no-code-counterpart` flavor: declare a spec enum with no matching code-side at all (info-level drift):

```
enum ShippingCarrier {
  values [ups, fedex, usps]
}
```

### Gap 3: ForbiddenArtifact (5 drift variants — 4 categories + Operation out-of-scope)

Add reference contracts under `reference/contracts/_shared/forbidden.tc`:

```
forbidden-artifact legacy-uploader {
  category file-glob
  pattern "code/src/legacy/**"
  reason "Legacy uploader is out of scope per ADR-003"
}

forbidden-artifact prod-debug-env {
  category env-var
  pattern "PROD_DEBUG"
  reason "Spec forbids any debug env-var in production"
}

forbidden-artifact deprecated-http-client {
  category dependency
  pattern "request"
  reason "Migrate to native fetch"
}

forbidden-artifact feature-experimental-export {
  category feature-flag
  pattern "FEATURE_EXPORT_V2"
  reason "Feature is GA-gated; flag must not appear in any config"
}
```

Planted bugs:

```ts
// code/src/legacy/uploader.ts — file should not exist
// IL-DRIFT: ForbiddenArtifact:legacy-uploader / forbidden.file-glob.code/src/legacy/**.present
export function legacyUpload() {}
```

```ts
// code/src/services/debug.service.ts
// IL-DRIFT: ForbiddenArtifact:prod-debug-env / forbidden.env-var.PROD_DEBUG.present
const debugMode = process.env.PROD_DEBUG === 'true';
```

```json
// code/package.json — gains the forbidden dep
{
  "dependencies": {
    "request": "^2.88.0"
  }
}
```
Plus marker placed at the top of a code file referencing the package.json:
```ts
// code/src/legacy/http.ts
// IL-DRIFT: ForbiddenArtifact:deprecated-http-client / forbidden.dependency.request.present
```

```json
// code/config/features.json
{
  "FEATURE_EXPORT_V2": false  // <-- merely present is the drift
}
```
Marker placed adjacent in a TS file:
```ts
// code/src/services/features.service.ts
// IL-DRIFT: ForbiddenArtifact:feature-experimental-export / forbidden.feature-flag.FEATURE_EXPORT_V2.present
```

Operation out-of-scope variant: declare an existing operation with `status out-of-scope` in the reference contract, leave the code's matching route intact:

```
operation GET "/api/orders/{id}/export" {
  status out-of-scope
  ...
}
```

```ts
// code/src/routes.ts (route exists, but spec marks it out-of-scope)
// IL-DRIFT: Operation:GET /api/orders/{id}/export / forbidden.operation.GET /api/orders/{id}/export.present
router.get('/orders/:id/export', exportController);
```

### Gap 4: NamedConstant (2 drift variants)

Add reference contracts under `reference/contracts/orders/constants.tc`:

```
constant DiscountTiers {
  type object
  expected-value {
    bronze: 5
    silver: 10
    gold: 20
  }
}

constant MAX_RETRY {
  type number
  expected-value 3
}

constant ApiVersion {
  type string
  expected-value "v2"
}
```

Planted bugs:

```ts
// code/src/services/pricing.service.ts
// IL-DRIFT: NamedConstant:DiscountTiers / constant.DiscountTiers.value-mismatch
const DiscountTiers = { bronze: 5, silver: 10, gold: 25 };  // gold drifted

// IL-DRIFT: NamedConstant:MAX_RETRY / constant.MAX_RETRY.value-mismatch
const MAX_RETRY = 5;  // spec says 3
```

`no-code-counterpart` (info-level):

```ts
// ApiVersion not declared anywhere in code
// IL-DRIFT: NamedConstant:ApiVersion / constant.ApiVersion.no-code-counterpart
```

### Gap 5: ArchitectureDecision — TDD harness (3 drift variants)

This block lands BEFORE gap-5 implementation; tests RED until done.

1. Add ADR files under `tests/fixtures/sample-js-project-il/docs/adr/`:

   - `ADR-001-data-store.md` — "We use Postgres. Rejected: MongoDB, MySQL."
   - `ADR-002-communication.md` — "REST API. Rejected: gRPC, GraphQL."
   - `ADR-003-messaging.md` — "Kafka for inter-service messaging."

2. Update `reference/specs/` so the consolidator includes the new ADRs.

3. Reference contracts:

   ```
   architecture-decision data-store.postgres {
     origin ADR-001-data-store.md "Decision" 10..15
     category data-store
     chosen postgres
     reason "Full-text search via tsvector required across all queries"
   }

   architecture-decision communication.rest {
     category communication-pattern
     chosen rest
     reason "Existing client library reuse"
   }

   architecture-decision messaging.kafka {
     category messaging
     chosen kafka
     reason "Strict ordering + replay required"
   }
   ```

4. Planted drifts:

   - **unmet-choice**: code package.json declares Kafka in the messaging ADR's reference contract, but the fixture's `package.json` doesn't import `kafkajs`. So spec asserts kafka, code has none → drift.
     ```ts
     // code/src/services/orders.service.ts
     // IL-DRIFT: ArchitectureDecision:messaging.kafka / architecture.messaging.unmet-choice
     ```

   - **forbidden-alternative**: code package.json gains `mongoose` while spec asserts data-store=postgres → drift.
     ```json
     // code/package.json
     { "dependencies": { "mongoose": "^7.0.0" } }
     ```
     ```ts
     // code/src/repos/customers.repo.ts
     // IL-DRIFT: ArchitectureDecision:data-store.postgres / architecture.data-store.forbidden-alternative
     ```

   - **inconclusive**: declare a spec architecture-decision in a category where the fixture has no signals at all.
     ```
     architecture-decision build-system.vite {
       category build-system
       chosen vite
       reason "Hot-module replacement required"
     }
     ```
     ```ts
     // No vite/webpack/turbopack config in fixture
     // IL-DRIFT: ArchitectureDecision:build-system.vite / architecture.build-system.inconclusive
     ```

When gap 5 is built, all 3 should fire. Until then, the test fails — which is the TDD signal.

## Implementation order

1. ✅ This plan
2. ✅ Convert repos to use real adapters (Knex / Prisma / raw-SQL sampler)
3. ✅ Add Prisma schema + package.json deps (this also seeds the gap-5 data-store detection)
4. ✅ Add reference contracts for gaps 1–4 (positive cases — no drift expected)
5. ✅ Plant bugs + markers for gaps 1–4 (run tests → verify green for already-shipped engine)
6. ✅ Add ADR files + reference contracts for gap 5 + plant gap-5 bugs (run tests → expected RED)
7. ✅ Implement gap 5 (PLAN_GAP_5_ARCHITECTURE_DECISION.md) — green; the gap is verifiably done

## Tests to update

- `tests/contract-verifier/verify-end-to-end.test.ts` — main marker-equality test. May need to extend `driftKey()` if gap-5 produces identity shapes not yet handled.
- `tests/contract-verifier/parser.test.ts` — auto-discovers `.tc` files; new contracts get parser-tested for free.
- `tests/contract-verifier/operation-lifter.test.ts` — focused on Operations; may need a sibling `gap-5-lifter.test.ts` for ArchitectureDecision lifting.

## Out of scope

- Python signals in the fixture (entire fixture is TS/JS — Python deferred per gap-1 plan)
- Multi-repo / monorepo fixture (existing fixture is single-package; architecture-style detection of `microservices` won't be exercised — that's a future fixture)
- Real database connections (Knex/Prisma calls are static AST patterns; no runtime queries needed)
- Drift-history fixtures (separate plan)
- Frontend-component fixtures (JSX presence — gap-3 missed findings were JSX-shaped; future work)

## Success criteria

After this fixture work + gap-5 implementation:

- `verify-end-to-end.test.ts` runs against `sample-js-project-il/` and asserts ~40 distinct drifts (22 existing + ~18 new across gaps 1-5).
- Each gap has at least one fixture for every drift kind its comparator emits.
- The `// IL-DRIFT:` marker count matches the verifier's drift count exactly (no false positives, no false negatives).
- A new dev can plant a bug, write a marker, run the test, and see immediately whether the engine catches it.
