# Eval Report — 2026-05-22 (after extractor fixes)

Second eval round after applying the 7-gap pass + follow-ups. Compares
the verifier's drift set (using freshly generated `.truecourse/contracts/`)
against the 22 `// IL-DRIFT:` markers planted in the fixture code.

---

## Headline

| Metric | Baseline (2026-05-21) | After fixes (2026-05-22) |
|---|---|---|
| Planted bugs caught | 12/22 | **13/22** |
| False positives | 5 | **3** |
| Resolver errors | 0 | 0 |
| Unresolved refs | 7 (all `Enum:OrderStatus`) | 5 (all `AuthRequirement:auth.bearer.api`) |
| Total drifts | 17 | 16 |

Modest improvement: +1 caught, -2 FPs, -2 unresolved refs. The
character of the gaps shifted — we closed Customer entity truncation,
enum extraction, effect-group consolidation, and tag propagation;
remaining misses are concentrated in LLM run-to-run variance and one
consolidator regression.

---

## Caught (13/22)

| # | Drift |
|---|---|
| 1 | POST /api/orders → 201 |
| 3 | GET /api/orders bare array |
| 4a | GET /api/orders/{id} → 404 |
| 6 | limit not clamped |
| 7 | shipped→cancelled illegal |
| 8 | terminal regression to paid |
| 9 | Order.placedAt mutability (**new — slicer fix**) |
| 10 | Customer.email lowercase (**new — slicer fix**) |
| 11d | admin role on POST /api/customers (**no longer renamed-FP — naming canon fix**) |
| 12 | Error envelope wrong shape |
| 13 | order.cancelled missing emission (**new — effect group consolidation**) |
| 16 | Discount threshold operator |
| 17 | Tax inputs unused |

## Missed (9/22)

| # | Drift | Why still missed |
|---|---|---|
| 4b | `forbid status 200 when resource-missing` on GET /api/orders/{id} | LLM still doesn't emit the `forbid` clause despite the new prompt guidance. Run-to-run noise. |
| 5a | offset query param forbidden | Pagination contract didn't emit `forbids` block this run (it DID in the previous run — LLM noise). |
| 5b | page query param forbidden | Same as 5a. |
| 11a/b/c | auth.bearer.api on customers (3 endpoints) | `AuthRequirement:auth.bearer.api` artifact wasn't generated this run despite the new mandatory-extraction directive. 5 unresolved refs. LLM noise. |
| 14 | order.placed emitted on failure (no `forbids`) | EffectGroup got consolidated but no `forbids` block (LLM omission). |
| 15 | Ownership check missing on GET /api/orders/{id} | The regenerated spec has a separate `## Admin role bypass` section listing the protected endpoints — LLM extracted it as a separate authorization-rule fragment again instead of as `except` clause. |
| 18 | POST /api/orders missing idempotency | **Consolidator regression**: the consolidator drops the "Idempotent under Idempotency-Key" annotation from POST /api/orders. The operation slice has no idempotency mention, so the tag-propagator can't fire. |

## False positives (3)

| Drift | Root cause |
|---|---|
| 2× `AuthRequirement:auth.role.admin / GET /api/customers/X/unprotected` | The auth.role.admin contract has `selector path-glob "/api/**"` — the LLM applied the admin selector too broadly. Should be `selector operations [Operation:"POST /api/customers"]`. |
| `Operation:GET /api/orders/{id} / response.403` | Generated contract declares a `403 on forbidden` response without an `inherits AuthorizationRule:...` reference, so the comparator looks for a literal 403 in code and doesn't find one. |

---

## What changed (commit lineage)

- **22c4e60d** — initial 7-gap pass: 5 prompt sections, slicer logical-group H2s, tag-propagator skeleton
- **747b7a0b** — slicer: emit H2 as one slice when it has prose body before first H3 (catches Customer entity, pagination forbids in the source spec)
- **37a8211b** — paginated-tag propagation, mandatory auth-requirement extraction, H1 logical groups

---

## Remaining issues by class

### Pure LLM run-to-run noise (5 bugs)

4b, 5a, 5b, 11a/b/c, 14 — the LLM emits the right contract some runs and not others. The prompt directives are correct; the LLM doesn't always follow them. Fixes:

- Stronger few-shot examples that show forbids blocks in context
- Validator that fails the run when known-required artifacts are missing (e.g., always-resolved `auth.bearer.api`)
- Re-prompt on missing required artifacts

### Authorization-rule extraction (1 bug)

15 — the regenerated spec has `## Admin role bypass` as a separate section, which the LLM treats as its own (unenforceable) artifact. The fix is in the **consolidator's rendering**: the admin bypass should remain a subsection of the ownership rule, not a top-level section.

### Consolidator regression (1 bug)

18 — the consolidator drops the idempotency annotation when rendering POST /api/orders. This is a claim-extractor or merger bug in `@truecourse/spec-consolidator`. Out of scope for the extractor.

### Selector over-broadening (FPs)

The 2 admin-role FPs come from `selector path-glob "/api/**"` instead of `selector operations [...]`. The new prompt's naming canon section didn't address selector scope tightly enough.

---

## Verdict

**13/22 (59%) — improved but not done.** The seven-gap pass closed
real structural problems (entity truncation, enum extraction,
authorization-rule fragments, naming inconsistencies, effect-group
fragmentation, tag propagation). The remaining 9 missed bugs split
roughly: 5 LLM noise, 1 consolidator regression, 3 prompt/selector
tightening.

To reach 22/22, next iteration should:

1. **Add a validator that fails the run when known-required artifacts
   are missing** (currently silent — `auth.bearer.api` just wasn't
   emitted and downstream broke)
2. **Add few-shot examples for forbids blocks** (offset/page, no event
   on 4xx/5xx, forbid silent 200)
3. **Fix the consolidator regression** that drops idempotency annotations
4. **Tighten admin-role selector** — should always be `selector operations
   [...]`, never `path-glob "/api/**"`
5. **Make the consolidator keep admin-bypass as a subsection** of
   ownership rather than promoting it to a sibling section
