# What we can learn from PR #95

PR: <https://github.com/truecourse-ai/truecourse/pull/95>
Context: take-home interview submission. Not a merge candidate; the value
is in surfacing ideas TrueCourse doesn't currently have.

The PR adds `truecourse analyze --spec-compliance` — a parallel pipeline
that reads PRDs / OpenAPI / YAML / Markdown, extracts code facts from 14
deterministic extractors (Express, Fastify, React Router, Prisma, Drizzle,
SQLAlchemy, Commander, Docker Compose, GitHub Actions, env vars, package
scripts, tests, JSX labels, auth), and matches them with a status enum
richer than ours.

Below is what's genuinely new or better, ranked by how much leverage
adopting it would give us.

---

## 1. `unverifiable` as a first-class status

The PR's status enum is `satisfied | missing | partial | conflicting |
ambiguous | unverifiable`. The interesting one is `unverifiable`: the
engine explicitly admits *"I have no matcher for this requirement kind"*
instead of silently dropping it.

Today, if a TrueCourse spec section says "encrypted at rest" or "must
handle 10k concurrent users," the IL extractor either fits it into
`UnenforceableObligation` (good) or just doesn't emit anything (silent
loss). The PR pattern is more honest: the requirement is surfaced in the
report with status `unverifiable` and the user knows the system saw it
but can't check it. Worth porting to `ContractDrift`.

## 2. Structured spec sources (OpenAPI / JSON / YAML) skip the LLM entirely

`packages/analyzer/src/spec-discovery/structured.ts` parses OpenAPI specs
directly into `Requirement` objects with `confidence: 1.0`. No LLM call.
Operation ID, method, path, status codes, request/response schemas,
security schemes — all extracted deterministically.

We treat everything as markdown and send everything through the LLM. For
any repo with an `openapi.yaml`, this is wasted spend and unnecessary
risk. The deterministic path should be the default whenever the input
shape allows it. Easy win for `spec-consolidator`.

## 3. RFC-2119 modality on every requirement

Each requirement carries `modality: 'must' | 'should' | 'may' |
'must_not'`. This is then used to derive severity — a missing `must` is
an `error`, a missing `should` is a `warning`, a missing `may` is `info`.

We have a binary "in spec / out of scope" today. The gradient is
materially more useful: "must" tells the user this is a hard requirement,
"should" tells them it's a recommendation, "may" tells them it's
optional. It also changes the failure mode of the verifier: today a drift
is a drift, no matter how important the spec language was.

`must_not` is interesting too — it's the per-requirement equivalent of
our module-level `out-of-scope.implemented` check, but at fine grain.

## 4. `partial` status with constraint-level granularity

A matcher can return `partial` when, e.g., the route exists and returns
200, but the spec said it should also return 400 and the implementation
never does. The finding includes which constraint was missing.

We're binary today: the route either matches the `Operation` artifact or
drifts. A `partial` status with the specific unmet constraint gives the
user a much smaller patch target than "this whole operation drifted."

## 5. Cache key includes promptVersion + schemaVersion + model

Their LLM cache key:

```
sha256(specFileHash, chunkHash, schemaVersion, promptVersion, model)
```

Our cache key is the content hash only. **This means if we bump the
extraction prompt in `spec-consolidator` or `contract-extractor`, stale
LLM outputs from the old prompt remain valid in cache.** That's a latent
correctness bug. Adding `promptVersion` and `model` to our cache keys is
a tiny change with real safety upside.

## 6. Secrets redaction before LLM

Regex-based redaction (auth tokens, API keys, password lines) runs on
every prose chunk before it hits the LLM. We don't do this. For
TrueCourse-as-a-service this is essentially a security requirement, and
it's cheap to add at the same call site that already builds prompts.

## 7. The 14-domain code-fact extraction surface

This is where the PR has the most code, and most of it is stuff our
analyzer doesn't cover:

| Extractor | What it pulls out |
|---|---|
| `express.ts` | routes, methods, status codes from `res.status()` / `res.sendStatus()`, handler names |
| `react-router.ts` | route paths from `<Route path=…>` and `createBrowserRouter` |
| `auth.ts` | JWT / session / permission middleware names |
| `schema.ts` | Prisma models, Drizzle tables, SQLAlchemy ORM classes |
| `cli.ts` | Commander programs, commands, options, arguments |
| `infra-config.ts` | Docker Compose services, GitHub Actions jobs |
| `env.ts` | `process.env.X` usage sites |
| `package-manifest.ts` | `package.json` scripts, bin entries |
| `jsx.ts` + `jsx-helpers.ts` | static text labels in JSX, composed strings |
| `static-values.ts` | hard-coded constants likely to be user-visible |
| `test-hints.ts` | test files referencing requirement IDs or acceptance text |

Even if we don't adopt the rest of the PR, this catalog should inform
which extractors `packages/analyzer/` is missing. The Prisma / Drizzle /
SQLAlchemy schema reader and the Commander CLI walker are the most
obvious gaps — neither has any TrueCourse equivalent today.

## 8. Tests as a compliance signal (`test-hints.ts`)

The clever one. The PR extracts string literals from test files and looks
for references to requirement IDs or to acceptance-criteria text. If
requirement `req_a1b2c3...` says "users can reset password" and a test
file contains the string "reset password" or `req_a1b2c3`, that test
counts as supporting evidence.

Imperfect (false matches are easy), but the principle is right: tests
ARE a compliance signal. We don't currently use them as one. The IL
verifier could plausibly raise drift confidence when a contract is
backed by a test, or lower it when nothing tests it.

## 9. The matcher `supports() → evaluate()` dispatch pattern

```ts
makeMatcher(
  'api.openapi_operation',
  (requirement) => requirement.kind === 'api' && hasConstraint(...),
  ({ requirement, facts }, metadata) => { ... return complianceResult(...) }
)
```

Our `contract-verifier/src/comparator/*.ts` files use one comparator per
artifact kind, dispatched via a switch on kind. Their pattern lets a
single requirement kind be handled by multiple specialised matchers, each
declaring its applicability. Better extensibility when we add new
specialised checks (e.g. an OpenAPI-specific operation matcher distinct
from a prose-derived one).

## 10. `acceptanceCriteria` distinct from `constraints`

Their `Requirement` has both:

- `constraints: Array<{type, value}>` — machine-checkable predicates
  (statusCode, fieldName, securityScheme, …)
- `acceptanceCriteria?: string[]` — natural-language "should also do X,
  Y, Z" that's intentionally not encoded

The split is honest: it preserves spec text that can't currently be
checked so it isn't lost from the artifact. We collapse this onto
`UnenforceableObligation` in IL, but at the artifact level rather than
per-operation. Per-operation acceptance criteria are more useful for
human reviewers.

## 11. `unspecified` finding kind

When the analyzer finds a route the spec never mentioned, it emits an
`unspecified` finding — *"this code is doing something nobody asked
for."* It's not a `must_not` violation (which would require an explicit
negative-spec entry), it's an information signal: maybe the spec is
incomplete, maybe the code is gold-plated.

We don't have this. Our `module.impl-without-spec` drift is the
module-level version; per-operation `unspecified` is finer-grained.

## 12. Mixed-domain fixtures

`tests/fixtures/spec-compliance-mixed-domain/` is one repo with:
Express server, OpenAPI spec, Prisma schema, React UI, Docker Compose,
GitHub Actions, Python SQLAlchemy model. The test asserts compliance
findings across all of them in a single run.

Our `sample-js-project-il/` is Express-only with planted bugs. The
mixed-domain fixture pattern is worth borrowing — it forces the test
suite to exercise the cross-domain interactions, not just one extractor
at a time.

## 13. Stable short-hash IDs (`req_a1b2c3d4e5f6`, `fact_...`)

Twelve-char prefixes of SHA-256, prefixed by type. Short enough to read
in logs, stable across runs (same input → same ID), namespaced enough
that you can grep for them. We hash too, but our IDs are either full
hashes or content-generated names; the short-prefix+type convention is
ergonomic.

## 14. Continuous confidence scores

Confidence is a `number` in `[0, 1]` on both `Requirement` and
`ComplianceResult`, propagated to findings. Users can filter by
confidence in the dashboard. Structured-source requirements get `1.0`;
LLM-extracted ones get a fractional score based on the LLM's
self-reported confidence.

We have provenance and `weight` (older/newer) but not a unified
confidence number flowing all the way through. Easy to add and useful
for UI filtering and CI gating ("only fail builds on findings with
confidence ≥ 0.8").

---

## What's NOT new (same gaps we already have)

- Single-shot LLM per chunk — no N-way agreement check.
- No semantic-equivalence merging — two different YAML keys naming the
  same thing produce different requirements.
- No counterexamples in findings.
- No suggested fixes.
- Tree-sitter / TS-compiler AST traversal style; no formal methods.

So the PR doesn't address any of the gaps we identified in
`COMPARISON.md` — it has the same weaknesses there. But on coverage and
expressiveness it pushes ahead of us in concrete ways.

## Suggested take-aways, ranked by leverage

1. **Add `unverifiable` and `partial` statuses to `ContractDrift`.**
   Smallest change, most honest reporting.
2. **Bump cache keys to include `promptVersion` + `model`.** Latent
   correctness bug; small fix.
3. **Adopt OpenAPI / YAML / JSON as deterministic spec sources** in
   `spec-consolidator` — skip the LLM whenever the input has structure.
4. **Add modality (`must / should / may / must_not`)** to the spec
   consolidator's claim shape, derive drift severity from it.
5. **Add secrets redaction** to both extractor LLM call sites.
6. **Backfill missing code-fact extractors** in `packages/analyzer/` —
   prioritise Prisma/Drizzle/SQLAlchemy schemas and Commander CLI.
7. **Adopt the mixed-domain fixture pattern** for verifier tests.
8. **Try tests-as-compliance-signal** in the IL verifier — even as a
   confidence modifier, not a hard pass/fail.

Everything in this list is independently shippable in `spec-consolidator`,
`contract-extractor`, `contract-verifier`, or `analyzer`. None of it
requires adopting the PR's parallel pipeline.
