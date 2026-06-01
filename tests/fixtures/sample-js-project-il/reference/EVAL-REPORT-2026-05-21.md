# Eval Report — 2026-05-21

Generated specs (`.truecourse/specs/`) and contracts (`.truecourse/contracts/`) produced by the dashboard, compared against the reference ground truth.

---

## ⚠️ Eval-blocking issue first

The spec consolidator pulled `reference/specs/*.md` into its input set. Both `orders/module.yaml` and `customers/module.yaml` list reference paths in `sourceDocs`:

```yaml
# .truecourse/specs/modules/orders/module.yaml
sourceDocs:
  - README.md
  - docs/PRDs/orders_PRDv2.md
  - reference/specs/modules/orders/data.md       # ← contaminated
  - reference/specs/modules/orders/effects.md    # ← contaminated
  - reference/specs/modules/orders/endpoints.md  # ← contaminated
```

This means the LLM was reading the answers while taking the test. The output it produced is **better** than what we'd see on docs alone, and the gaps below are likely a **lower bound** on the real quality gap. The fixture's discovery layer needs to exclude `reference/` (and ideally `.truecourse/` itself).

---

## Spec Quality

| Claim | Status | Notes |
|-------|--------|-------|
| Bearer JWT on all `/api/*` | ✅ | `shared/auth.md` states it correctly |
| Admin role required on POST /api/customers | ⚠️ | Mentions "a subset of /api/* endpoints" but doesn't name which endpoints — too vague to be actionable. POST /api/customers admin requirement is lost. |
| Error envelope `{ error: { code, message, details? } }` | ⚠️ | `shared/errors.md` has `{ error: { code, message } }` — missing `details` field, missing the list of known error codes |
| Pagination: cursor, limit 1–50, clamp not reject | ✅ | Correct in `shared/endpoints.md` |
| Pagination: response shape `{ items, nextCursor }` | ✅ | Correct in `shared/endpoints.md` |
| Pagination: offset/page forbidden | ❌ | Not stated anywhere in generated specs |
| Idempotency: POST /api/orders requires Idempotency-Key | ❌ | Spec only mentions idempotency on `/pay` — POST /api/orders is not tagged idempotent anywhere |
| Order entity fields complete | ❌ | `data.md` describes them in prose; contract only has 6 fields (missing `status`, `subtotalCents`, `updatedAt`) all typed as `any` |
| POST /api/orders request body field name | ❌ | Spec says `totalCents` instead of `subtotalCents` — wrong field name propagated from the LLM's misreading |
| Order: placedAt immutable | ✅ | Stated in `data.md` and encoded in contract |
| Lifecycle transitions correct | ✅ | All 5 allowed transitions present |
| terminal: delivered and cancelled | ✅ | |
| shipped→cancelled NOT allowed | ✅ | |
| Customer: email normalized to lowercase | ✅ | |
| LoyaltyTier enum (standard, silver, gold) | ⚠️ | Values are right but generated `shared/data.md` reinterprets it as a `LoyaltyTier` with a `value` field — should be a flat enum |
| Pricing: discountCents — strict `> 10000` | ✅ | |
| Pricing: taxCents — base is `(subtotal - discount)` | ✅ | |
| Pricing: totalCents formula | ✅ | |
| Effects: order.placed on 201 only (not on 4xx) | ⚠️ | Per-event effect groups have no `forbids` block |
| Effects: all 4 events on correct responses | ✅ | |
| Ownership rule: correct operations list | ⚠️ | `auth.md` lists routes but the contract is just an `except` fragment — no `applies-to`, no `predicate`, no `on-violation` |
| Out of scope: replace and refund | ✅ | `module.yaml` has outOfScope entries |

**Score: 13 ✅ / 5 ⚠️ / 4 ❌ out of 22 (count is up by 1 — the `subtotalCents` field error is added)**

---

## Contract Bug Coverage

| Bug | Status | Notes |
|-----|--------|-------|
| #1 POST /api/orders → 201 | ✅ | Contract has `response 201` |
| #2 Location header missing | ✅ | `header location required` present (subsumed by #1) |
| #3 GET /api/orders bare array | ✅ | `items: array of Entity:Order` present — would catch the bare-array drift via shape comparison; `nextCursor` missing from contract but doesn't block this drift |
| #4a GET /api/orders/{id} → 404 | ✅ | `response 404` present |
| #4b forbid status 200 when resource-missing | ❌ | Not in generated contract |
| #5 offset/page forbidden | ❌ | `forbids` block missing from pagination contract |
| #6 limit not clamped | ✅ | `max 50` + `on-above-max clamp` present |
| #7 shipped→cancelled | ✅ | State machine correct |
| #8 terminal regression | ✅ | `terminal [delivered, cancelled]` |
| #9 placedAt mutability | ✅ | `immutable` on placedAt (even though field type is `any`, the `immutable` marker is what matters for the comparator) |
| #10 email not lowercased | ✅ | `normalize lowercase` present |
| #11 customer endpoints unprotected | ❌ | No `auth-requirement auth.bearer.api` contract generated — yet 4 operations reference it as `inherits AuthRequirement:auth.bearer.api`. The reference is unresolved. |
| #12 error envelope wrong shape | ❌ | No `error-envelope` contract generated — yet many operations reference `ErrorEnvelope:error.envelope.standard`. Unresolved reference. |
| #13 order.cancelled missing emission | ✅ | Separate effect-group contract present |
| #14 order.placed emitted on failure | ❌ | No `forbids` block on any effect group |
| #15 ownership missing on GET /api/orders/{id} | ❌ | `authorization-rule order.owner-only.admin-exception` is just an `except` fragment — no `applies-to`, no `predicate`, comparator won't fire |
| #16 discount threshold ≥ vs > | ✅ | Strict `>` in expression |
| #17 tax wrong base | ✅ | `(subtotalCents - discountCents)` in expression |
| #18 POST /api/orders no idempotency | ❌ | `post-api-orders.tc` missing `tags [idempotent]` so idempotency contract doesn't select it |

**Coverage: 12 ✅ / 6 ❌ — bugs #4b, #5, #11, #12, #14, #15, #18 missed (7 missed bugs)**

Wait — that's 12 + 6 = 18, but I count 7 ❌. Let me recount: #4b, #5, #11, #12, #14, #15, #18 = 7 misses. ✅ count: #1, #2, #3, #4a, #6, #7, #8, #9, #10, #13, #16, #17 = 12 hits. 12 + 7 = 19? No, #2 is subsumed but I still mark it ✅ — actual distinct drifts: 18. So 11 hits + 7 misses = 18.

**Net: 11 / 18 bug drifts catchable. (Bug #2 doesn't fire as a separate drift — subsumed by #1.)**

---

## Cross-Cutting Issues Beyond the Checklist

These don't map cleanly to a single planted-bug entry but affect verifier behavior:

1. **Unresolved references everywhere.** Operations reference `AuthRequirement:auth.bearer.api` and `ErrorEnvelope:error.envelope.standard` as inherited responses, but neither artifact is defined as a contract. The resolver will flag these as unresolved refs.

2. **POST /api/orders has wrong request field** (`totalCents` instead of `subtotalCents`). This is a real spec error, not just a contract gap.

3. **POST /api/orders missing 401 inherit** — has 201 and 400 but no auth response declared. The other operations that don't have this: get-api-customers, get-api-customers-id, post-api-orders-id-cancel.

4. **POST /api/customers missing 403 inherit** — declares auth.bearer.api but not auth.role.admin, so the admin requirement isn't structurally bound.

5. **Order entity is wildly incomplete** — only 6 fields, all typed as `any`. Missing `status`, `subtotalCents`, `updatedAt`. The reference has all 9 fields with proper types.

6. **Effect groups are fragmented** — 4 separate `effect-group order.X.event` contracts instead of one consolidated `effect-group order.lifecycle.events`. Each has only one effect, no cross-cutting `forbids` block.

7. **Authorization rule is a fragment** — `order.owner-only.admin-exception` only declares the admin exception, no `applies-to`, no `predicate`, no `on-violation`. Comparator won't trigger.

---

## Summary

**11 of 18 catchable bugs would fire. 7 missed.** Top gaps in priority order:

1. **No `auth-requirement` contracts generated** — both `auth.bearer.api` (referenced 4 times) and `auth.role.admin` are undefined. Misses bug #11 (4 unprotected customer drifts).
2. **No `error-envelope` contract generated** — referenced everywhere but undefined. Misses bug #12.
3. **`authorization-rule` extracted as just an `except` fragment** — missing `applies-to`, `predicate`, `on-violation`. Misses bug #15.
4. **Effect groups fragmented per event with no `forbids`** — misses bug #14 (order.placed emitted on validation failure).
5. **`pagination.cursor.standard` missing `forbids` block** — misses bug #5 (offset/page accepted).
6. **`post-api-orders.tc` missing `tags [idempotent]`** — misses bug #18.
7. **`get-api-orders-id.tc` missing `forbid status 200 when resource-missing`** — misses bug #4b.

**Plus eval-blocking contamination**: the spec consolidator read `reference/specs/` as input. The numbers above are a lower bound on the real quality gap.

**Verdict: Needs significant work.** Prompt improvements needed for:
- Auth-requirement extraction (must produce a structured contract, not just unenforceable obligations)
- Error-envelope extraction (must produce an artifact, not bury it in operations)
- Authorization-rule extraction (must produce the complete artifact with `applies-to` and `on-violation`)
- Effect-group consolidation (one per business domain with `forbids`, not one per event)
- Pagination contract `forbids` block extraction
- The `idempotent` tag propagation to operations covered by the cross-cutting idempotency policy

Plus a **fixture-discovery fix**: exclude `reference/` from spec consolidation input.
