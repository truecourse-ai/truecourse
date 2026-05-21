# Reference Eval Prompt

Use this prompt to evaluate the quality of LLM-generated specs and contracts for the
`sample-js-project-il` fixture against the hand-written reference ground truth.

Run this any time after regenerating `.truecourse/specs/` or `.truecourse/contracts/`.

---

## Prompt

You are evaluating the output of an LLM-based spec consolidator and contract extractor.
The fixture is a small orders + customers service. A set of bugs have been deliberately
planted in the code. The reference specs and contracts were written by hand as the ideal
output — the generated ones should match them closely enough to detect all the same bugs.

Read the following files and produce the evaluation report described below.

### Reference specs (ideal)

Read all files under `tests/fixtures/sample-js-project-il/reference/specs/`.

### Generated specs (to evaluate)

Read all files under `tests/fixtures/sample-js-project-il/.truecourse/specs/`.

### Reference contracts (ideal)

Read all files under `tests/fixtures/sample-js-project-il/reference/contracts/`.

### Generated contracts (to evaluate)

Read all files under `tests/fixtures/sample-js-project-il/.truecourse/contracts/`.

---

## Evaluation Report

Produce a report with the following sections.

### 1. Spec quality

For each item below, mark ✅ (present and correct), ⚠️ (present but incomplete/wrong),
or ❌ (missing).

| Claim | Status | Notes |
|-------|--------|-------|
| Auth scheme: Bearer JWT required on all `/api/*` endpoints | | |
| Auth: admin role required on POST /api/customers | | |
| Error envelope: `{ error: { code, message, details? } }` on all 4xx/5xx | | |
| Pagination: cursor scheme, limit 1–50 default 20, clamp not reject above max | | |
| Pagination: response shape `{ items, nextCursor }` | | |
| Pagination: offset/page forbidden | | |
| Idempotency: POST /api/orders requires Idempotency-Key | | |
| Order entity fields: id, status, subtotalCents, discountCents, taxCents, totalCents, customerId, placedAt, updatedAt | | |
| Order: placedAt is immutable after creation | | |
| Order lifecycle: allowed transitions placed→paid, placed→cancelled, paid→shipped, paid→cancelled, shipped→delivered | | |
| Order lifecycle: delivered and cancelled are terminal (no exit) | | |
| Order lifecycle: shipped→cancelled is NOT allowed | | |
| Customer entity: email normalized to lowercase on write | | |
| Customer entity: loyaltyTier enum (standard, silver, gold) | | |
| Pricing: discountCents = 10% of subtotalCents when loyaltyTier==gold AND subtotalCents > 10000 (strict greater-than) | | |
| Pricing: taxCents = 8% of (subtotalCents − discountCents) | | |
| Pricing: totalCents = subtotalCents − discountCents + taxCents | | |
| Effects: order.placed on POST /api/orders 201 only (not on 4xx) | | |
| Effects: order.paid, order.shipped, order.cancelled on respective 200 responses | | |
| Ownership rule: GET /api/orders/{id} and all transition endpoints require caller == order.customerId (admin bypass) | | |
| Out of scope: replace and refund endpoints excluded | | |

### 2. Contract quality

For each planted bug, mark ✅ (contract would catch it), ⚠️ (partial), or ❌ (missing/wrong).

| Bug | Contract detail needed | Status | Notes |
|-----|------------------------|--------|-------|
| #1 POST /api/orders returns 200 instead of 201 | operation POST /api/orders: response 201 | | |
| #2 POST /api/orders missing Location header | operation POST /api/orders: header location required on 201 | | |
| #3 GET /api/orders returns bare array | operation GET /api/orders: response body { items, nextCursor } | | |
| #4a GET /api/orders/{id} silent 200 on not-found | operation GET /api/orders/{id}: response 404 | | |
| #4b GET /api/orders/{id} forbid 200 on missing | operation GET /api/orders/{id}: forbid status 200 when resource-missing | | |
| #5 offset/page query params accepted | pagination-contract: forbid query-param offset, forbid query-param page | | |
| #6 limit not clamped to 50 | pagination-contract: max 50 with on-above-max clamp | | |
| #7 shipped→cancelled allowed | state-machine Order.status: shipped transitions only to delivered | | |
| #8 terminal regression to paid | state-machine Order.status: delivered and cancelled are terminal | | |
| #9 placedAt mutated on transitions | entity Order: field placedAt immutable | | |
| #10 email not lowercased | entity Customer: field email normalize lowercase | | |
| #11 customer endpoints unprotected | auth-requirement: selector covers /api/** (or all three customer paths) | | |
| #12 error envelope wrong shape on 400 | error-envelope: shape { error { code, message } } applies to 4xx/5xx | | |
| #13 order.cancelled event not emitted | effect-group: order.cancelled emits on POST /api/orders/{id}/cancel 200 | | |
| #14 order.placed emitted on validation failure | effect-group: forbid emission on 4xx/5xx responses | | |
| #15 ownership check missing on GET /api/orders/{id} | authorization-rule: applies to GET /api/orders/{id} | | |
| #16 discount threshold >= instead of > | formula order.discount-cents: condition subtotalCents > 10000 (strict) | | |
| #17 tax computed on wrong base | formula order.tax-cents: inputs include discountCents; expression (subtotalCents - discountCents) * 0.08 | | |
| #18 POST /api/orders no idempotency | idempotency-contract present + POST /api/orders tagged idempotent | | |

### 3. Summary

- Spec quality score: X / 21 claims correct
- Contract coverage: X / 18 bugs catchable
- Top gaps (if any): list the most critical missing or wrong items
- Overall verdict: **Ready** / **Needs work** / **Significant gaps**
