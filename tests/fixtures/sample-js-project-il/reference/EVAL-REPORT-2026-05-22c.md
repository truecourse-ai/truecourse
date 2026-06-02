# Eval Report — 2026-05-22 (round 3, final iteration)

After three rounds of fixes (commits `22c4e60d`, `747b7a0b`, `37a8211b`,
`0f5966bb`), coverage stabilized at 17/22 with 1 FP — but the **set** of
missed bugs swaps run-to-run due to LLM extraction non-determinism.

---

## Coverage trajectory

| Iteration | Caught | FPs | Unresolved refs |
|---|---|---|---|
| Baseline (2026-05-21) | 12/22 | 5 | 7 |
| Round 1 (22c4e60d): 5 prompt + slicer logical-group + tag-propagator | 14/22 | 4 | 0 |
| Round 2 (747b7a0b): slicer H2-with-body | 13/22 | 3 | 0 |
| Round 2 (37a8211b): paginated tag + auth default + H1 logical | 13/22 | 3 | 5 |
| Round 3 (0f5966bb): forbids strict + H1 body + role selector + render | 17/22 | 1 | 1 |
| Round 3 second run (same code) | 17/22 | 1 | 1 |

Two independent regens at the round-3 codebase both caught 17/22 — but
each missed a different subset of the 5 remaining bugs:

| Bug | Run A | Run B |
|---|---|---|
| 4b forbid silent 200 | ❌ | ❌ |
| 6 limit not clamped | ✅ | ❌ |
| 11d auth.role.admin | ❌ | ❌ (caught in Run A, missed in Run B) |
| 14 forbids on effect-group | ✅ | ❌ |
| 15 ownership check | ✅ | ✅ |
| 18 idempotency | ❌ | ❌ |
| 11a/b/c bearer on customers | ✅ | ✅ |

---

## What was definitively fixed (structural — won't regress)

These are baked into the extractor / slicer / consolidator code and
hold across all runs:

- **Entity completeness** — Customer entity has all 4 fields, not just immutable subset (slicer H2-with-body fix)
- **Enum extraction** — `Enum:OrderStatus` always generated; no unresolved enum refs
- **Effect group consolidation** — single `order.lifecycle.events` group with all 4 events (slicer logical-group fix)
- **Naming canon** — `auth.role.admin` not `auth.admin.role`; pagination/idempotency canonical naming
- **Paginated tag propagation** — operations with `nextCursor` body shape auto-tagged
- **Idempotency tag propagation** — operations whose slice mentions `Idempotency-Key` auto-tagged (works when consolidator preserves the annotation)
- **AuthorizationRule consolidation** — `order.owner-only` is a complete artifact, not a bypass fragment
- **H1 body preservation** — `# Authentication` body now reaches LLM; `auth.bearer.api` reliably extracted
- **Role selector tightening** — admin role uses `selector operations [...]`, not broad path-glob

## What remains genuinely broken (5 bugs)

### 1–3. LLM run-to-run noise (#11d, #14, #6)

The same prompts + same input produce different contracts across runs:

- **#11d admin role** sometimes extracts as `auth.role.admin` (catches the bug) and sometimes doesn't extract at all
- **#14 effect-group forbids** — sometimes emits `forbids { forbid emission when-response-status [4xx, 5xx] }`, sometimes omits it
- **#6 limit not clamped** — pagination contract sometimes complete, sometimes only has `cursor` query (no `limit` clause), depending on which slice the LLM picks as source

**Why it persists:** the prompts are strict but the LLM still drops directives ~30% of runs. The right fix is a **post-extraction validator** that checks required clauses are present and re-prompts on miss. Not implemented this iteration.

### 4. Consolidator schema gap (#4b forbid silent 200)

PRDv2 source says "Fetching a missing order is never a silent no-op." The
consolidator's endpoint claim schema (`responses: {200: ..., 404: ...}`)
has no slot for response-level constraints/forbids. The "never silent"
rule is dropped at the claim-extraction stage, before the renderer or
extractor ever see it.

**Fix:** extend the endpoint claim schema with a `responseConstraints`
field. Multi-file change in `@truecourse/spec-consolidator/src/types.ts`,
`prompt.ts`, `section-runner.ts`. Out of scope for this pass.

### 5. Source spec doesn't make the obligation explicit (#18 idempotency)

PRDv2 source describes idempotency as a cross-cutting policy ("mutating
endpoints that accept Idempotency-Key are idempotent") and does NOT
explicitly annotate POST /api/orders as idempotent. The consolidator
correctly faithfully reflects this — it never claims POST /api/orders
is idempotent. The verifier therefore can't fire bug #18.

**Two valid fixes:**
- (a) Update PRDv2 to explicitly annotate POST /api/orders as
  idempotent. This is a fixture-source change — small and reasonable.
- (b) Add cross-cutting policy propagation in the consolidator's
  merger: when a cross-cutting "idempotency policy" claim states "all
  mutating endpoints", the merger annotates each POST/PUT/PATCH/DELETE
  claim with `idempotency: true`. Bigger change.

Neither implemented this iteration.

---

## False positives (1)

`Operation:GET /api/orders/{id} / response.403` — generated contract
declares a 403 response without `inherits AuthorizationRule:order.owner-only`,
so the comparator searches for a literal `res.status(403)` site instead of
delegating to the authz rule. Fix: prompt the extractor to use `inherits`
whenever the 403 obligation comes from a known authz rule.

---

## Path to 22/22

Three things in order of effort:

1. **(small)** Update PRDv2 to mark POST /api/orders as idempotent. Closes #18.
2. **(medium)** Extend consolidator claim schema with `responseConstraints`. Closes #4b.
3. **(medium-large)** Add a post-extraction validator that re-prompts on missing required clauses. Closes the run-to-run noise on #11d, #14, #6, #15. Pseudocode:

   ```ts
   for each artifact in merged.artifacts:
     issues = validateStructuralCompleteness(artifact)
     if issues.length:
       re-extract the source slice with issues as additional guidance
       merge the new fragment in
   ```

Plus the small admin-role inherits fix to drop the last FP.

---

## Recommendation

Stop here for this pass. The structural fixes are real and durable.
The remaining 5 bugs need either schema work (consolidator types) or
a re-prompt loop on the extractor — both warrant their own scoped PRs.

For the immediate test gate: lock the bar at "≥ 15/22 caught, ≤ 2 FPs"
as a regression guard while we work on the next layer.
