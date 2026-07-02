# Contract-Generation Determinism — Fix Plan

STATUS: PROPOSED — not started.

This plan makes `contracts generate` (the corpus path) deterministic: editing one
doc should regenerate only the area that doc belongs to, and leave every other
`.tc` file byte-identical. The whole fix lives in the shared engine package
`packages/contract-extractor`, so it lands once for OSS and EE alike.

## 1. The problem

"Non-determinism" here means: the same corpus, generated twice, produces
different `.tc` output — different identities, different filenames, or a
different `origin` line inside otherwise-identical contracts. The visible symptom
is churn on unrelated changes: you edit a single doc in one area and the next
`contracts generate` rewrites almost the entire tree (observed as ~57 of 60
contracts changing). That defeats the whole point of committing `.tc` to git —
the OSS BL-Drift view diffs working-tree `.tc` against HEAD, and the EE PR gate
diffs the generated corpus, so spurious churn buries the one real spec change in
noise and makes every PR touching a doc look like it rewrote the world. Because
the CLI, the dashboard, and the EE GitHub App all call the same
`generateContractsFromCorpus`, they all inherit the same instability.

## 2. Root causes (confirmed)

### (a) Floating identity + two divergent slug functions

The artifact identity is whatever the LLM invents per fragment, and it is never
reduced to one canonical string. Three different code paths each re-normalize it
their own way, at different stages:

| Purpose | Where | What it does to the identity |
| --- | --- | --- |
| Merge / dedup / completeness match | `coverageKey` in `corpus-prompt.ts` | lowercases the kind, collapses whitespace, folds HTTP method + trailing slash + `:id`↔`{id}` — but does **not** slug the identity body |
| Deterministic id assignment (only `ForbiddenArtifact`, `QueryRule`) | `slug()` in `normalizer.ts` | `[^a-z0-9]+ → '-'` — collapses **dots to dashes** |
| `.tc` filename | `slugifyIdentity()` in `writer.ts` | spaces/slashes → `-`, then strips everything except `[a-z0-9.-]` — **preserves dots** |

`slug()` and `slugifyIdentity()` disagree on dots (and on any non-alphanumeric),
so the string used as the merge key, the string written into the `.tc` header,
and the string used for the filename are computed independently and can differ.
For the ~16 kinds that `assignDeterministicIdentities` leaves untouched, the body
token is just the raw LLM wording. The consequence: a one-word rewording from the
model ("bearer-jwt" vs "customer-bearer-jwt" vs "Bearer JWT") changes what dedups
against what, which file the artifact lands in, and the header text — all at once.

### (b) The global reconcile step busts unchanged areas via its cache key

`reconcileTargets` (`target-reconciler.ts`) runs one LLM clustering call over the
**entire cross-area target list** to collapse semantic duplicates
(`outbox-pattern` ≡ `transactional-outbox`). Its cache key is the whole list:

```
computeCacheKey → hash(PROMPT_FINGERPRINT + all-target-coverageKeys.sorted().join(','))
```

So adding, removing, or renaming a **single** target anywhere changes the global
material → cache miss → the reconcile call re-runs → the LLM can return a
different `merges` map → canonical identities for **unchanged** areas shift. Those
shifted ids then flow into `extractCacheKey` in `corpus-generate.ts` (which
includes `targetMaterial` = the area's reconciled coverageKeys), busting the
per-area extract cache and forcing a full regenerate of areas nobody touched.
This is the direct mechanism behind "one edit churns the whole tree."

### (c) Origin area is chosen by the first enumerator, so it flips on reorder

A cross-cutting target enumerated in several areas is generated exactly once, in
whichever area "won." `reconcileTargets` records that winner in `firstArea` as
the **first area in iteration order** (`byArea` order = `corpus.areas` order from
`readCorpusForGenerate`). The generated fragment's `origin` line points at that
area's doc. When a doc edit causes the corpus to re-group and area order shifts, a
different area becomes "first," a different doc becomes the origin, and the `.tc`
body changes even though the contract is semantically identical. The same
first-wins-on-tie instability exists in `repair.ts`: `findSliceForMissing` and
`sliceForArtifact` keep the first best-scoring slice (`!best || score > best.score`)
over slices in area order, so a re-prompted artifact's origin can flip on reorder
too.

## 3. The fix, phase by phase

### Phase 1 — One canonical identity, computed once at parse

**Idea, in plain terms.** Stop letting the identity float. The moment a target or
fragment comes back from the LLM, run it through a single canonicalizer and store
the result. From then on, that one string is the merge key, the filename slug, and
the `.tc` header token. Collapse the two slug functions into that one canonicalizer.

**What to change.**

- Add one exported function — call it `canonicalIdentity(kind, identity)` — in a
  single module (either a new `identity.ts` in `packages/contract-extractor/src`,
  or alongside `coverageKey` in `corpus-prompt.ts`, since it must fold the same
  benign drift). It absorbs everything `coverageKey` already does to the identity
  (whitespace, HTTP method, trailing slash, `:id`↔`{id}`) and, for the free-form
  "short slug" kinds, applies **one** kebab rule. It must preserve the structure
  downstream code relies on: Operation stays `METHOD /path` (the writer parses it
  in `inferOperationDomain`), Entity/Enum stay their type names, dotted identities
  keep their dots as segment separators.
- Apply it immediately after every LLM parse:
  - in `corpus-generate.ts`, right after `EnumerateResultSchema.parse` (enumerate)
    and after `ExtractionResultSchema.parse` (generate + the batch emit path), so
    every `TargetSpec.identity` and every `Fragment.identity` is already canonical
    before it enters dedup, reconcile, merge, or the completeness gate;
  - in `repair.ts`, on every fragment returned by `runFixOne`.
- Rewire the three consumers onto the one string:
  - `coverageKey` becomes a thin wrapper that keys on `kind + canonicalIdentity`
    (or is replaced by it), so matching and canonicalization can never diverge.
  - In `writer.ts`, `slugifyIdentity` calls the shared canonicalizer instead of
    its own regex (or is deleted in favor of the identity already being canonical).
    `pickFilePath`/`inferKindDomain`/`inferOperationDomain` keep working because
    the canonical identity preserves their expected shape.
  - In `normalizer.ts`, `assignDeterministicIdentities` (and its private `slug`)
    route through the same canonicalizer, so `ForbiddenArtifact`/`QueryRule` ids
    and the header text `renameHeader` writes agree with the filename.

**Sketch.**

```
before:  coverageKey(k,id)   slug(id)   slugifyIdentity(id)     ← 3 rules, drift
after:   canonicalIdentity(k,id)  ── used by ──► merge key, filename, .tc header
```

**Expected effect.** A given artifact has exactly one identity string across the
whole pipeline. LLM rewording that canonicalizes to the same token no longer
changes what dedups, where it's written, or what the header says. This is the
biggest, cheapest, guaranteed win — pure normalization, no LLM behavior change —
and it removes most of the churn on its own.

### Phase 2 — Deterministic + scoped reconcile

**Idea, in plain terms.** After Phase 1, exact duplicates collapse without any
LLM. Reserve the reconcile LLM for the residual case (genuinely different wordings
of the same thing) and, critically, cache that work **per candidate cluster**
instead of over the whole corpus — so touching one area can't bust the reconcile
result for the others.

**What to change (`target-reconciler.ts`).**

1. Deterministic common case. The existing `distinct` map already collapses exact
   `coverageKey` duplicates with no LLM; Phase 1 makes far more targets land on
   the same key, so most cross-area duplication is now handled deterministically.
   Keep that pass; it needs no LLM.
2. Scope the semantic pass. Only same-kind identities can merge (the prompt says
   so). Bucket the distinct targets by kind, then within a kind form small
   candidate **clusters** by a cheap deterministic similarity (e.g. shared head
   token / slug prefix). Run the LLM only on clusters with ≥2 distinct members.
3. Change the cache key from global to per-cluster. Today one entry is keyed on
   every target's id. Instead, cache each cluster's merge result under a key
   derived from **that cluster's own member ids**:

   ```
   before:  key = hash(PROMPT + all-distinct-coverageKeys.sorted())     // one entry, global
   after:   key = hash(PROMPT + this-cluster's-coverageKeys.sorted())    // one entry per cluster
   ```

   Adding or renaming a target only busts the cluster(s) that target joins. Every
   untouched cluster is a cache hit, so its members keep their canonical ids.

**Expected effect.** When one doc changes, only the clusters containing that doc's
targets re-run the reconcile LLM. Unchanged areas keep byte-identical reconciled
target lists, so their `extractCacheKey` (which folds `targetMaterial`) stays
stable → their per-area extract cache still hits → they are not regenerated. This
is the fix for the cross-area cascade in root cause (b).

### Phase 3 — Deterministic origin tie-break

**Idea, in plain terms.** When more than one area or slice could supply an
artifact, pick by a stable rule (sorted id), never by iteration order.

**What to change.**

- In `reconcileTargets`, when a target is enumerated in several areas, choose the
  origin area as the **lexicographically smallest `areaId`** among them rather
  than "first seen." Concretely, when populating `firstArea`, keep the min areaId
  for each coverage key instead of the first insertion.
- In `repair.ts`, make `findSliceForMissing` and `sliceForArtifact` break score
  ties deterministically — prefer the slice with the smallest `specPath`/`areaId`
  (stable sort by that key) instead of the current first-wins (`score > best.score`).

**Expected effect.** Which area generates a shared target, and which slice a
repair re-prompt anchors to, no longer depend on corpus/area ordering, so the
`origin` line stops flipping when areas re-group.

### Phase 4 (optional enhancement) — Anchor the changed area to its existing `.tc`

**Idea, in plain terms.** Even the one area that genuinely changed will re-run the
LLM, and the LLM is not byte-stable. When exactly one area changed, hand its
existing `.tc` bodies to the generate prompt as a **naming/format hint** so the
model reuses the same identities and wording where the spec is unchanged.

**What to change.** In `corpus-generate.ts`, for areas that `classifyAreas`
reports as `changed` (and where a prior `.tc` exists), pass the prior bodies into
`buildCorpusGenerateUserPrompt` as reference context: "the spec is the source of
truth; the existing contract is only a hint for how to name and format things you
still emit."

**Cautions (must hold).**

- Best-effort only — a missing or stale hint must never block or fail generation.
- Never entrench stale contracts: if the spec dropped an artifact, the hint must
  not resurrect it. The spec, not the hint, decides what exists.
- Do **not** fold the hint into `extractCacheKey`. The cache key must stay a pure
  function of the spec + reconciled targets + prompt; keying on prior output would
  create a feedback loop and defeat the cache.

**Expected effect.** Reduces churn *inside* the changed area's body too. It is not
required for the guardrail below (which only asserts unchanged-area stability), so
it can land last or be skipped.

## 4. The guardrail test

**Where.** A new `tests/contract-extractor/corpus-determinism.test.ts`, reusing
the stub-runner harness already in `corpus-generate.test.ts` (`areaInput`,
`entityFragment`, and injectable `enumerateRunner` / `generateRunner` /
`reconcileRunner`, plus a real temp `repoRoot` so the manifest + KV caches are
exercised).

**Fixture.** A small multi-area corpus — three areas, at least one target
enumerated in two areas so the reconciler's origin selection is exercised. Use
deterministic stub runners: the generate stub emits a fragment whose body embeds
its `origin` (source doc) so an origin flip shows up as a byte change. Wrap the
generate stub in a spy that records `area.areaId` per call.

**Steps.**

1. Run `generateContractsFromCorpus` once to disk (real writer, manifest written,
   `disableTargetReconciliation` off). Snapshot every `.tc` file's bytes.
2. Edit exactly one doc in exactly one area (mutate that area's doc content).
3. Run `generateContractsFromCorpus` again against the same `repoRoot`.

**Assertions.**

- Call scope: the generate spy's recorded areaIds on run #2 equal **only the
  edited area**. No generate call fires for any unchanged area (they must hit the
  extract cache).
- Byte identity: for every `.tc` file not produced by the edited area's targets,
  `after[path] === before[path]` byte-for-byte. The set of changed/added/removed
  files equals exactly the edited area's files.

```
before = snapshot(contractsDir)      // {relPath -> bytes}
editOneDoc(areaX)
run generate #2
after  = snapshot(contractsDir)
expect(generateSpy.areaIdsThisRun) === {areaX}
for p not in areaX's files: expect(after[p]) === before[p]
```

**Honest limit.** A brand-new area's body still varies until it is cached, because
the LLM is not byte-stable on first generation of new content — so the test does
**not** assert byte-stability of the edited area's body across runs. It proves the
concrete, checkable property that defines "fixed": every *unchanged* area stays
byte-identical and does zero LLM work.

## 5. Rollout order + risk

**Land order.** Phase 1 first — it is the cheapest, has no LLM-behavior change,
and removes most churn by itself. Then Phase 3 (pure determinism, tiny). Then
Phase 2 (the cache-scoping — the real cure for the cross-area cascade; ship the
guardrail test with it). Phase 4 optional, last.

**Backward-compat / one-time churn.** Collapsing the slug rules will change how
some identities slug, so a handful of already-committed `.tc` files may be renamed
on the first generate after Phase 1. Expect one large, mechanical diff (mostly
renames) on that first run. Land it as a deliberate one-time migration on `main`
(regenerate, commit) — per the repo convention of only committing generated
corpus artifacts after merge to `main` — and call it out in the PR so reviewers
know the churn is the migration, not a regression. After that single run, the
tree is stable.

**EE vs OSS coverage.** The entire fix is inside `packages/contract-extractor`
(`corpus-prompt`, `target-reconciler`, `corpus-generate`, `normalizer`, `writer`,
`repair`). The OSS CLI, the dashboard server, and the EE GitHub App + workspace
all reach it through `generateFromCorpusInProcess` → `generateContractsFromCorpus`,
and both the disk writer (`writeContracts`) and the EE in-memory
`composeContractFiles` share the same `pickFilePath`, so a single engine change
fixes every surface at once.
