# EE AI Observability — LLM Trace Store

## Goal

Give the hosted (EE) deployment a durable, queryable record of **every LLM call**
the pipeline makes — the full prompt, the full output, the model, token usage,
latency, status, and rich context tags (stage, slice, repo, job) — so we can
answer "**what did the AI do, and why**" without re-running anything.

The immediate motivating problem: the contract corpus intermittently fails with
duplicate-artifact-identity collisions because the model returns **different,
non-identical outputs for the same input** across (and within) runs. We have no
way to *see* that today — the LLM is a black box between prompt and parsed result.
A trace store makes the non-determinism observable: group calls by prompt and you
see, directly, "the model was handed the identical slice and answered three
different ways." That single view is the difference between guessing and knowing.

This is also the foundation for cost/latency analytics, regression triage, and
(optionally) capturing the model's own reasoning.

## Constraints (locked)

- **EE-only.** The tracing *feature* — capture, storage, dashboard — lives
  entirely in `ee/`. OSS is not touched. (The one allowed exceptions are
  type-only additions to `packages/shared`, exactly as `jobs.ts`/`ee.ts`/the
  `Capability` union already do for other EE features — these are the shared
  client⇄server contract, not OSS logic.)
- **No new heavy dependencies.** No Langfuse, no ClickHouse, no external
  collector. We reuse what EE already has: Postgres (`ee-db`), the `BlobStore`
  seam (`ee-storage`), the `PgBlob*Store` pattern (`ee-data-store`), the AI SDK
  (`ee-llm`), and the EE server/client.
- **Self-hostable.** Trace payloads ride the existing `BlobStore`, whose backend
  is env-selected (`azure | s3 | postgres | fs`) — Postgres-bytea / filesystem
  for local dev, S3 (AWS/MinIO/R2) or Azure (native) in cloud. Same code, zero
  change per environment.

## Why this is trivial to capture (the seam already carries it)

Every EE LLM call funnels through **one function** — the AI-SDK transport that EE
installs process-wide via `setDefaultTransport`:

`ee/packages/llm/src/transport.ts:45`
```ts
return async (req) => {
  const run = (model) =>
    generateText({ model, system: req.system, prompt: req.user, abortSignal: signal });
  return (await run(primary)).text;   // <-- only .text is used today
};
```

At this single point we already have **both halves** of a trace:

- from `req` (`LlmRequest`, `packages/shared/src/llm/transport.ts:27`):
  `id` (= `<stage>:<sliceId>`, e.g. `contract.extract:<sliceId>`), `stage`
  (`contract.extract` / `spec.claimExtract` / `spec.conflict` / `contract.repair` /
  …), `system`, `user`, `model`.
- from the AI SDK result (currently discarded): `usage` (prompt/completion/total
  tokens), `finishReason`, `reasoning` (when thinking is on), `response.modelId`.

So instrumenting this one wrapper traces **every stage** — spec consolidation
*and* contract extraction *and* the repair pass — in one shot. No per-call-site
work, no OSS edits. `req.id`/`req.stage` give us `sliceId`+`stage` for free; org /
jobId / repo come from an ambient EE context (below).

> **Note — cache hits are intentionally not traced.** The slice cache
> short-circuits *before* the transport, so a trace exists **iff** a real LLM call
> happened (= real cost + latency). "What happened this run, including cache hits"
> is the job/step-tracker's job, not the trace store's.

## Where it's stored (same split the EE store already uses)

Mirrors `PgBlobContractStore` / `PgBlobVerifyStore` / `PgBlobAnalysisStore`
exactly — small queryable metadata in Postgres, heavy bodies in the BlobStore:

- **Metadata → Postgres** (`ee-db`, new `llm_traces` table): the filterable/
  aggregatable columns (org, stage, sliceId, model, tokens, latency, status,
  timestamps, prompt hash, blob keys). Lean, so list/aggregate queries never
  touch the big strings.
- **Payloads → BlobStore** (`ee-storage`): the full system+user prompt, the raw
  output, and (optional) reasoning. Content-addressed keys (sha256) so identical
  prompts/outputs are stored once. Backend is env-selected — Postgres-bytea
  locally, S3/Azure in cloud.

---

## Data model — `llm_traces`

`ee/packages/db/src/schema/traces.ts` (new), exported from `schema/index.ts`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `workspaceOrgId` | text, indexed | the tenant; null only for non-workspace calls |
| `traceId` | text, indexed | groups all calls of one logical operation (one baseline run / one sync) — = the jobId when run from a job |
| `parentId` | text, null | sub-call nesting (a repair call → its source extraction) |
| `stage` | text, indexed | `req.stage` |
| `callId` | text | `req.id` |
| `sliceId` | text, null | parsed from `req.id` |
| `module` | text, null | optional (see Decision 4) |
| `topic` | text, null | optional (see Decision 4) |
| `model` | text | the model actually used (primary vs fallback) |
| `status` | text | `ok` \| `error` |
| `errorMessage` | text, null | on `error` |
| `promptHash` | text, indexed | **sha256(system+user)** — powers the same-prompt→divergent-output view |
| `promptTokens` / `completionTokens` / `totalTokens` / `reasoningTokens` | int, null | from `result.usage` |
| `latencyMs` | int | wall time of the call |
| `finishReason` | text, null | |
| `usedFallback` | boolean | primary failed → fallback answered |
| `promptBlobKey` / `outputBlobKey` / `reasoningBlobKey` | text (last null) | BlobStore keys |
| `metadata` | jsonb | extra tags: jobId, repoFullName, commitSha, artifactKind (repair), provider |
| `createdAt` | timestamptz | |

Indexes: `(workspaceOrgId, createdAt desc)`, `(traceId)`, `(workspaceOrgId, stage)`,
`(workspaceOrgId, promptHash)`. Migration generated via the existing drizzle-kit
flow, committed under `ee/packages/db/drizzle/`.

---

## Components

### 1. Schema + migration — `ee-db`
New `schema/traces.ts` + export + generated SQL migration.

### 2. Store — `ee/packages/data-store/src/trace-store.ts` (new) `PgBlobTraceStore`
Mirrors `PgBlobContractStore`. Constructed `(db, blob)`.
- `record(input)` — content-addressed `put` of prompt/output/(reasoning) to the
  BlobStore, then `insert` the metadata row. **Never throws to the caller** (a
  trace-write failure must not break the LLM call — caught + logged).
- `list(org, filters)` — metadata only (no blobs): filter by stage, status,
  promptHash, traceId, time range, free-text; cursor-paginated.
- `get(org, id)` — metadata + hydrates prompt/output/reasoning from blob.
- `listByPromptHash(org, hash)` — the divergence view ("same prompt → N outputs").
- `stats(org, range)` — per-stage aggregates (count, tokens, avg/p95 latency,
  error rate) for the overview.
- `gc(org, { olderThanDays | maxRows })` — retention (mirrors `contract-gc.ts`).

### 3. Trace context (ALS) — `ee/packages/llm/src/trace-context.ts` (new)
`AsyncLocalStorage<TraceContext>` carrying `{ org, jobId, traceId, repoFullName,
commitSha }` — the EE-only facts the `req` doesn't have. `runWithTrace(ctx, fn)` +
`currentTrace()`. The EE **worker** wraps each task body in `runWithTrace(...)`;
the transport reads `currentTrace()` to enrich. Pure EE — the worker sets it, the
transport reads it, OSS never sees it. ALS propagates across the concurrent slice
awaits, so all of one run's calls share a `traceId`.

### 4. Capture — instrument `ee/packages/llm/src/transport.ts`
A minimal `TraceRecorder` interface (`{ record(input): Promise<void> }`) is
defined in `ee-llm` (keeps `ee-llm` decoupled from `ee-data-store`).
`createAiSdkTransport(cfg, { recorder? })` wraps the existing `run()`:
- time the call; on success capture `result.text/usage/finishReason/reasoning`;
  on throw capture the error; either way build a `TraceInput` from `req` +
  `currentTrace()` and `recorder.record(...)` it (fire-and-forget, guarded).
- also set `experimental_telemetry: { isEnabled: true, functionId: req.stage,
  metadata }` on the `generateText` call (see Decision 1) — the AI SDK's native
  OTel emission, free, future-proofing.
- `ee-server` injects the recorder (a `PgBlobTraceStore`) at boot, where the
  provider cfg, `eeDb`, and `blob` are all in scope.

### 5. Routes — `ee/packages/server/src/traces/` (new router, auth-gated, org-scoped)
- `GET /api/ee/traces?stage=&status=&promptHash=&traceId=&q=&cursor=` → list.
- `GET /api/ee/traces/:id` → detail (with payloads).
- `GET /api/ee/traces/by-prompt/:hash` → divergence view.
- `GET /api/ee/traces/stats?range=` → per-stage aggregates.
Registered after `eeDb` in `ee/packages/server/src/index.ts`; adds a `traces`
capability.

### 6. Client — `ee/packages/client`
- `TracesPage.tsx` — filterable list (time, stage, slice/callId, model, tokens,
  latency, status); click → detail.
- `TraceDetailView` — context tags, system+user prompt, raw output, reasoning,
  tokens, timing; a **"compare same-prompt runs"** affordance that opens the
  `by-prompt/:hash` divergence view (the duplicate-variant debugger).
- Route + nav item (gated on `traces`), registered in `index.tsx`.

### 7. Shared types — `packages/shared/src/types/traces.ts` (type-only)
`TraceSummary`, `TraceDetail`, `TraceStats`, filter + divergence types. Plus
`'traces'` added to the `Capability` union. Same type-only precedent as `jobs.ts`.

---

## Decisions to confirm

**1. Capture mechanism — direct result capture (recommended) vs pure OTel pipeline.**
The AI SDK emits traces as OpenTelemetry; consuming them needs an OTel
TracerProvider + a custom SpanProcessor that parses `ai.*`/`gen_ai.*` span
attributes into our table. That's the "purest" use of the SDK's mechanism and
gives free export to any OTel backend later — **but** those attribute names are
`experimental_` and shift between SDK versions, and it adds OTel-pipeline
plumbing. The AI SDK **result object** (`{ text, usage, finishReason, reasoning }`)
is a *stable, typed* API at the exact same call site. So: **capture directly from
the result for our durable store, and also flip `experimental_telemetry` on** —
the latter costs nothing, keeps us OTel-standard, and lets us bolt on a
Langfuse/Phoenix/Sentry exporter later as a config flip with zero re-instrumentation.
Best of both, least brittleness, no new dependency.

**2. Reasoning capture — native vs prompted.** "Ask the AI to write reasoning."
*Native:* enable provider thinking on the EE transport and store
`result.reasoning` — **EE-only, no OSS/schema change**, but costs reasoning tokens
and changes latency, so make it a per-stage config toggle, **off by default**.
*Prompted:* add a `reasoning` field to the extractor's JSON schema — richer/
structured but that schema is **OSS**, so it's out of scope for an EE-only feature.
Recommend native, opt-in.

**3. Scope.** Instrumenting the transport captures **all** stages at once, so
Phase 1 already covers spec consolidation + extraction + repair. No reason to
scope narrower. (Confirm.)

**4. module/topic columns.** `sliceId` + `stage` + `promptHash` already cover the
duplicate-variant debugging. Clean `module`/`topic` *columns* would need a small
optional `meta?` field on the shared `LlmRequest` (OSS annotating its own request,
EE-agnostic). Recommend **defer** — add only if filtering by module/topic proves
needed. (Confirm.)

**5. Retention + privacy.** Traces grow unbounded and contain customer spec text.
Include `gc()` (TTL or per-org cap) from Phase 1, and a config flag to disable
input/output capture (à la the AI SDK's `recordInputs/recordOutputs`) for
privacy-sensitive deploys. Payloads are org-scoped, behind the auth gate, in the
deploy's own blob backend.

---

## Phasing

- **Phase 1 — Capture + store. ✅ DONE (uncommitted).** Schema (`llm_traces`) +
  migration `0003_oval_cloak.sql`; `LlmTraceInput`/`LlmTraceRecorder`/view types
  in `packages/shared`; `trace-context.ts` (ALS) + transport instrumentation in
  `ee-llm`; `PgBlobTraceStore` (record/list/get/listByPromptHash/stats/gc) +
  `traceObjectKey` in `ee-data-store`; boot wiring (`storage.ts` returns the
  store → `registerLlmProviders` recorder; worker wraps each task in
  `runWithTrace`). Tests: `tests/ee-data-store/trace-store.test.ts` (7) +
  `tests/ee-llm/transport-trace.test.ts` (5), both green; full build 17/17;
  suite 4531 pass (3 pre-existing analyzer failures only). NOTE: server changes
  need a `pnpm dev` reload; not yet exercised against a live provider.
- **Phase 2 — Admin console (operator-only). ✅ DONE (uncommitted).** Reframed
  from a per-tenant page to a **cross-org operator console** (us = all
  workspaces; a granted customer = own org, later). **Operator identity:** a
  WorkOS user `metadata.role === 'operator'` (org-independent → user metadata,
  not the per-org WorkOS role; the customer tier will use the WorkOS `role`),
  derived in `auth.ts` → `AuthUser.isOperator`. **Gate:** `requireOperator`
  (403) on `/api/ee/admin/*`. **Cross-org reads:** `PgBlobTraceStore.list/get/
  stats/listByPromptHash` take an OPTIONAL `org` (omit = all) + `listOrgs()`;
  `JobStore.listAll` + `workspaceOrgId` on `JobView`. **Routes:** `GET
  /api/ee/admin/traces` (+ `/orgs`, `/stats`, `/by-prompt/:hash`, `/:id`) and
  `/jobs`. **Client:** `AdminPage` (AI Traces + Jobs tabs, org filter, detail
  panel, same-prompt divergence view); nav/route gated per-user via a new
  `requiresOperator` on `EeNavItem`/`EeRoute` (filtered in `EePageShell` +
  `EeNavSlot` against `useEeAuth().user.isOperator`; the page self-guards on the
  server 403). NOT a deployment capability (so it's not advertised publicly).
  Tests: `tests/ee-server/admin-route.test.ts` (6). Build 17/17; full suite
  green except the 3 pre-existing analyzer fails + the known `repo-conflict-
  remerge` load-flake (passes in isolation).
- **Phase 3 — Reasoning (optional).** Per-stage native thinking + `result.reasoning`
  capture; `experimental_telemetry` exporter hook if/when an external backend is
  wanted.
- **Phase 4 — Analytics (optional).** Stats overview (tokens/latency/error by
  stage), cost rollups, retention UI.

## Verification

- **Unit (`tests/ee-server/` + `tests/ee-data-store/`):** `PgBlobTraceStore`
  round-trips (record → list/get/by-prompt), `gc()` prunes; the transport wrapper
  records on success *and* error and **never** lets a recorder failure break the
  call; ALS context flows into the recorded row; trace routes are org-scoped +
  auth-gated.
- **Full suite:** `pnpm test 2>&1 | tee /tmp/test-output.txt` — no regressions
  (note the 3 known pre-existing analyzer failures).
- **Live (user runs `pnpm dev`):** run a real baseline → `llm_traces` fills; open
  the dashboard, filter to `contract.extract`, open the divergence view for a
  colliding slice's prompt hash and **see the divergent outputs** that cause the
  duplicate-identity failure.

## Out of scope (noted)

External OTel backend wiring (kept as a future exporter, not built); streaming/
token-by-token traces; per-call sampling; UI-driven re-run-from-trace; tracing the
local OSS/CLI path (EE-only by design).
