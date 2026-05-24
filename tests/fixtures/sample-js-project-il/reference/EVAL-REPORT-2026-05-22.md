# Eval Report — 2026-05-22

Generated specs (`.truecourse/specs/`) and contracts (`.truecourse/contracts/`)
produced by the dashboard, compared against the reference ground truth.

**Method:** ran the verifier directly against the generated contracts and
diffed the resulting drift set against the 22 `// IL-DRIFT:` markers
planted in the fixture code.

---

## Headline

- **Planted bugs caught: 12 / 22** (54.5%)
- **False positives: 5** (3 are mirrors of correctly-caught bugs under a renamed artifact id)
- **Resolver errors: 0**
- **Unresolved refs: 7** (all `Enum:OrderStatus` — see below)

Compared with the 2026-05-21 baseline (12/22 → 11/18 catchable with the
old marker counting): roughly the same coverage, but the gaps are now
clearly enumerated by marker.

---

## What was caught (12)

| # | Drift | Caught as |
|---|---|---|
| 1 | POST /api/orders → 201 | `Operation:POST /api/orders / response.201` |
| 3 | GET /api/orders bare array | `Operation:GET /api/orders / response.200.body.shape` |
| 4a | GET /api/orders/{id} → 404 | `Operation:GET /api/orders/{id} / response.404` |
| 6 | limit not clamped | `PaginationContract:.../limit.max-50-not-clamped` |
| 7 | shipped→cancelled illegal | `StateMachine:Order.status / transition.illegal.shipped-to-cancelled` |
| 8 | terminal regression to paid | `StateMachine:Order.status / transition.unguarded-terminal-regression.to-paid` |
| 11a | POST /api/customers unprotected | `AuthRequirement:auth.bearer.api / .../POST` |
| 11b | GET /api/customers unprotected | `AuthRequirement:auth.bearer.api / .../GET` |
| 11c | GET /api/customers/{id} unprotected | `AuthRequirement:auth.bearer.api / ...` |
| 12 | Error envelope wrong shape | `ErrorEnvelope:.../POST /api/orders/response.400.shape` |
| 16 | Discount threshold operator | `Formula:order.discount-cents / expression.threshold-operator.10000` |
| 17 | Tax inputs unused | `Formula:order.tax-cents / inputs.discountCents.unused` |

## What was missed (10)

| # | Drift | Root cause in generated output |
|---|---|---|
| 4b | `forbid status 200 when resource-missing` on GET /api/orders/{id} | Contract has no `forbid` clause on the 404 response |
| 5a | offset query param forbidden | `pagination.cursor.standard.tc` has no `forbids` block |
| 5b | page query param forbidden | same — `forbids` block missing |
| 9 | Order.placedAt immutability | Generated `entity Order` declares `placedAt` as `server-assigned` + `computed-at order-creation` but **not `immutable`** |
| 10 | Customer.email lowercase | Generated `entity Customer` only has 2 fields (`id`, `createdAt`) — missing `email`, `name`, `loyaltyTier` entirely |
| 11d | admin role on POST /api/customers | Contract exists but named `auth.admin.role` instead of canonical `auth.role.admin` — drift fires under wrong artifact id (counted as FP, see below) |
| 13 | order.cancelled missing emission | Effects fragmented into per-event groups (e.g. `order.cancelled.event`) instead of one `order.lifecycle.events` — fires under wrong group id |
| 14 | order.placed emitted on failure | Same fragmentation, plus no `forbids` block (only one event per group, no cross-cutting "forbid on 4xx/5xx") |
| 15 | Ownership check missing | `authorization-rule order.owner-only.admin-bypass` is a **fragment** — only declares the admin `except`, no `applies-to`, no `predicate`, no `on-violation`. Comparator has nothing to check. |
| 18 | POST /api/orders missing idempotency | `post-api-orders.tc` doesn't have `tags [idempotent]`, so the idempotency contract doesn't select it |

## False positives (5)

| Drift | Real issue |
|---|---|
| 3× `AuthRequirement:auth.admin.role / .../X/unprotected` | Mirror of #11d — same admin-role bug fires under the wrong artifact name |
| `EffectGroup:order.cancelled.event / Effect:order.cancelled / missing-emission` | Mirror of #13 — same missing-emission bug fires under the wrong group id |
| `Operation:GET /api/orders/{id} / response.403` | Generated contract adds a 403 response without an `inherits AuthorizationRule:order.owner-only` clause, so the comparator looks for a literal `res.status(403)` site on this endpoint and doesn't find one |

**If we count name-rename FPs as "caught but renamed":** effective coverage rises to **14/22** (still misses 4b, 5a, 5b, 9, 10, 14b, 15, 18).

## Resolver issues

7 unresolved refs, all `Enum:OrderStatus`. The enum is referenced from
the order entity, state machine, and 4 event contracts — but the
generated enum file is named `loyaltytier/loyaltytier.tc` and the
`order-status.tc` style file is **missing entirely**. Generated output
defines `Enum:LoyaltyTier` but not `Enum:OrderStatus`.

---

## Top problems in the generator

### 1. Entities are dropped/truncated

- `entity Customer` has only 2 fields (`id`, `createdAt`). Missing: `email`, `name`, `loyaltyTier`. Origin claims "Immutability" section — the LLM extracted only the immutability subsection and threw away the rest of the entity.
- `entity Order` is closer but missing the `immutable` marker on `placedAt`, `discountCents`, `taxCents`, `totalCents`. Uses `computed-at order-creation` as a proxy but it isn't the same — comparator looks for `immutable`.

### 2. OrderStatus enum missing entirely

- Origin specs (`modules/orders/data.md`) say "OrderStatus is an enum with values placed | paid | shipped | delivered | cancelled" — the consolidator captured this but the extractor produced no `enum OrderStatus` contract. 7 downstream artifacts reference it and unresolve.

### 3. AuthorizationRule extracted as a fragment

- `order.owner-only.admin-bypass.tc` contains only the `except { role admin }` clause. No `applies-to`, no `predicate`, no `on-violation`. The "admin bypass" is an exception **inside** the rule — not a standalone artifact.

### 4. EffectGroup fragmented per event

- 4 separate `effect-group order.X.event` contracts, each with one effect, no `forbids` block. The reference has one consolidated `order.lifecycle.events` group with `forbids emission when-response-status [4xx, 5xx]`.

### 5. Naming inconsistencies

- `auth.admin.role` vs `auth.role.admin` — verifier compares by full artifact id. Renamed contracts can't satisfy markers expecting the canonical name.

### 6. Pagination `forbids` block missing

- `pagination.cursor.standard.tc` has `scheme`, `query`, but no `forbids`. The "offset/page forbidden" rule is **explicit** in `shared/endpoints.md` ("Offset- and page-number-based pagination is forbidden across the entire surface") — the extractor missed it.

### 7. Idempotency tag not propagated to POST /api/orders

- The reference spec marks POST /api/orders "Idempotent under Idempotency-Key" in the section heading. The generated contract for POST /api/orders has no `tags [idempotent]`, so the idempotency contract's selector (`tag idempotent`) doesn't pick it up.

### 8. `forbid` clauses on responses missing

- Reference contract for GET /api/orders/{id} has `forbid status 200 when resource-missing` inside the 404 response. Generated contract omits the forbid clause.

---

## Verdict

**12/22 (54.5%) — needs work.** The major gaps are systemic, not random noise:

1. **Extractor truncates entities** — drops fields outside the focused subsection
2. **Missing enum extraction** for OrderStatus despite clear spec evidence
3. **Cross-cutting `forbids` blocks** (pagination, effects, operation responses) are systematically missed
4. **Authorization rules extracted as fragments** instead of complete artifacts
5. **Effect groups fragmented per event** instead of consolidated
6. **Tag propagation** from cross-cutting policies (idempotency) to specific operations doesn't happen

These are the same gaps as the 2026-05-21 report — confirming this isn't run-to-run noise but consistent prompt/algorithm shortcomings.
