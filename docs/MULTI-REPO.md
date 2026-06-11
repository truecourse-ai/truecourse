# Multi-Repo Workspaces & Cross-Repo Violations

Design doc for Phase 38. The Phase 38 entry in `PLAN.md` is the implementation tracker; this document is the source of truth for the design decisions, terminology, and trade-offs.

**Terminology.** Cross-repo defects are *workspace violations* — they show up in the same violations stream as per-repo violations, distinguished by a `scope: 'workspace'` field and a `kind` namespaced under `workspace.*`. There is no separate "drift" concept.

---

## 1. Problem

Per-repo analysis catches *internal* inconsistency. The drifts that hurt teams in practice live across repo boundaries:

- The frontend calls `POST /api/users` and reads `{ user_id }`. The backend exposes `POST /users` and returns `{ userId }`. Both repos pass their own tests.
- Service A and service B both write to the `users` table. A says `email NOT NULL`, B happily inserts NULL.
- Half the backend services use Drizzle, the other half use Prisma — no one ever decided, it just happened.
- The order-service publishes to topic `order.created`. The notification-service subscribes to `orders.created`. Nobody notices for two months.
- The frontend expects HTTP 201 on create. Three months ago somebody changed the backend to return 200. The error-banner only fires on 4xx, so nothing alarms.

These all fit one shape: **two repos disagree on a contract neither one fully owns.** The contract is implicit, the drift is silent, and the only way to find it is to look at both sides at once.

TrueCourse is currently single-repo. This phase makes it multi-repo.

## 2. Core concept

Two new primitives.

### 2.1 Workspace

A **workspace** is a named set of N member repos. It is the unit of cross-repo analysis. A user can have multiple workspaces (e.g. `acme-prod`, `side-project`) and a repo can belong to multiple workspaces.

Storage:

```
~/.truecourse/workspaces/<id>/
  workspace.json         # name, members[], hostMap, sharedDatabases, runtime config
  cross-repo.json        # latest cross-repo analysis (workspace violations, links, system graph)
  history.json           # append-only summaries of past cross-repo runs
  logs/
```

Each member repo gets a small breadcrumb so the CLI can resolve "which workspace does this repo belong to?" without searching:

```
<repo>/.truecourse/workspace-link.json   # gitignored — local-only
```

This is gitignored because workspace membership is a property of the *engineer's machine*, not of the repo. Two engineers may organize their workspaces differently. Cloud sync (38.12) is where workspace membership becomes a shared, server-side concept.

### 2.2 Interface surface

A **per-repo, language-agnostic export of every cross-process boundary the repo participates in.** Cross-repo analysis is a pure function over N of these.

```
<repo>/.truecourse/interface-surface.json   # committable, like LATEST.json
```

Schema (sketch):

```ts
type InterfaceSurface = {
  schemaVersion: 1;             // monotonic integer; see §3.1
  repo: { name: string, root: string };
  git: { branch: string, commit: string };  // captured by per-repo analyze; cross-repo runs read these to label what's being compared
  http: {
    routes: HttpRoute[];   // server-side: I expose this endpoint
    calls:  HttpCall[];    // client-side: I call this endpoint
  };
  messaging: {
    publishers: Publisher[];
    consumers:  Consumer[];
  };
  database: {
    schemas: DbSchema[];   // ORM models / migrations
  };
  schemaFiles: SchemaFile[]; // openapi/graphql/proto/asyncapi where present
};

type HttpRoute = {
  method: 'GET' | 'POST' | ...;
  pathPattern: string;          // canonical form, see §4.2
  statusCodes: number[];        // declared / inferred
  requestSchema?: TypeRef;      // best-effort schema, may be opaque
  responseSchemaByStatus?: Record<number, TypeRef>;
  anchor: { file: string, line: number };
  framework?: string;           // express, fastify, fastapi, ...
  visibility?: 'public' | 'internal';  // public = reachable from outside the workspace (mobile, third parties); see §4.8
};

type HttpCall = {
  method: string;
  urlTemplate: string;          // canonical form
  bodyShape?: TypeRef;          // inferred from local data flow
  responseShape?: TypeRef;      // inferred from how result is destructured
  handledStatusCodes?: number[];
  anchor: { file: string, line: number };
  client?: string;              // fetch, axios, requests, httpx, ...
};
```

The surface is the unifying abstraction. Each per-repo analyzer (TS/JS today, Python, eventually Go/C#) emits one. Cross-repo logic operates only on surfaces — never re-parses other repos' code. This keeps the cross-repo path fast, language-agnostic, and trivially cacheable.

## 3. Architecture

```
┌─────────────────────────┐    ┌─────────────────────────┐
│  repo A (.truecourse/)  │    │  repo B (.truecourse/)  │
│   LATEST.json           │    │   LATEST.json           │
│   interface-surface ───┐│    │┌─── interface-surface   │
└─────────────────────────│    │─────────────────────────┘
                          ▼    ▼
                    ┌──────────────────┐
                    │ Workspace        │
                    │ cross-repo       │
                    │ analysis         │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ workspace-level  │
                    │ violations +     │
                    │ system graph     │
                    └──────────────────┘
```

**Code lives in `packages/core/`.** The workspace concept is core, not CLI-only and not dashboard-only — both adapters consume it. Specifically:

- `packages/core/src/services/workspace/` — workspace store, member registry, hostMap, sharedDatabases config.
- `packages/core/src/services/workspace/cross-repo/` — matchers + violation rules.
- `packages/core/src/services/workspace/migrations/` — schema-version migrators (§3.1).
- `packages/analyzer/src/interface-surface/` — the per-repo extractor. Runs at the end of `analyze` and writes `interface-surface.json` next to `LATEST.json`.
- `tools/cli/src/commands/workspace/` — CLI surface.
- `apps/dashboard/server/src/routes/workspace.ts` — HTTP routes.
- `apps/dashboard/client/src/components/workspace/` — system-level graph + workspace violations UI.

### 3.1 Persisted artifact versioning

Every persisted JSON artifact carries a top-level `schemaVersion: number` field. This applies to:

- `interface-surface.json`
- `workspace.json`
- `cross-repo.json`
- `history.json`

**Read path:**

- `schemaVersion > current` → hard error: "this file was written by a newer truecourse — upgrade." No silent fallback.
- `schemaVersion < current` → run the migration chain `vN → vN+1 → ... → current` in order, then read.
- `schemaVersion == current` → read directly.

**Write path:** writers always emit the latest version.

**Migrators** live at `packages/core/src/services/workspace/migrations/<artifact>/vN-to-vN+1.ts`. Each exports `migrate(input: vN): vN+1` — pure function, no I/O. The reader composes the chain at load time. Migrators must never be edited after release; once `v2-to-v3.ts` ships, fixing it would silently change interpretation of files already on disk.

**Day one** ships every artifact at `schemaVersion: 1` with an empty migration chain. The framework is the point — adding `v2` later is a single migrator file plus a writer update.

**Tests:** round-trip (write v1, read v1) + cross-version (write v1 fixture, read at v3 through the chain, assert shape) once we have multiple versions.

## 4. Cross-repo detection targets

### 4.1 HTTP route ↔ HTTP call (the killer feature)

The dominant case. Every workspace will have it.

**Server side.** Reuse existing route detection. Extend with:
- request schema (TS types / Zod / Pydantic / decorator metadata)
- response schemas keyed by status code (return statements + framework idioms)
- declared error responses

**Client side.** New extractor for `fetch` / `axios` / `got` / `ky` / native `http` / `requests` / `httpx` / `aiohttp`. For each call site, capture method, URL template, body shape, response handling.

**Inference scope.** Local data flow only. We don't try to follow values across files for v1; a call site's body is what's literally constructed at the call site. This keeps FP rate manageable; we can extend later.

### 4.2 Path canonicalization

Every path goes through canonical form before matching:

- Lowercase host
- Strip trailing slash
- Normalize all parameter syntaxes to `:name` — `:id`, `{id}`, `$id`, `<int:id>`, `[id]` all become `:id`
- Param names are not part of identity. `:userId` and `:id` match. (Path matching only cares about *position*; param naming is a stylistic choice.)
- Query string is metadata, not URL identity.

### 4.3 Host identity

The hardest sub-problem. How do we know `https://api.example.com` corresponds to repo Y?

**Tiered resolution:**

1. **Explicit `hostMap` in `workspace.json`** (the source of truth):
   ```json
   "hostMap": {
     "https://api.example.com": "backend-api",
     "http://localhost:3000": "backend-api",
     "${process.env.API_URL}": "backend-api"
   }
   ```
2. **Inferred from env-var parsing**: if call sites use `process.env.API_URL` and a member repo's README/`.env.example` defines `API_URL=...`, propose a hostMap entry.
3. **Heuristic** (low confidence): same-name service. E.g. `notification-service.local` matches member `notification-service`.
4. **LLM disambiguation** (off by default, opt-in): for low-confidence cases, ask the model.

Calls that don't resolve to any workspace member are *external* and excluded from cross-repo violation rules (per-repo analysis still reports them as today).

### 4.4 Queue / messaging

Detect producers/consumers for Kafka, Redis pub/sub, RabbitMQ, SQS, NATS. Match by topic name (after normalization — same canonical-form treatment as paths). Violations: orphan-producer, orphan-consumer, payload-schema-mismatch.

### 4.5 Shared database

The workspace declares which databases are shared:

```json
"sharedDatabases": {
  "userdb": { "members": ["api", "worker"], "driver": "postgres" }
}
```

For each shared DB, compare ORM schemas / migrations across members. Violations: column type mismatch, NOT NULL disagreement, missing/extra columns, FK target divergence, index disagreement.

### 4.6 Schema-file ground truth

When a member ships an explicit schema file (`openapi.yaml`, `*.proto`, `schema.graphql`, `asyncapi.yaml`), treat it as authoritative for that side of the contract. Violations: route-not-in-schema, schema-route-not-implemented, client-uses-undeclared-field, generated-stub-out-of-date.

### 4.7 Workspace homogeneity

The "different framework / different ORM" case isn't a contract violation — it's a consistency one. Express it as workspace-level rules with explicit expectations:

```json
"homogeneity": {
  "framework": "express",
  "orm": "drizzle",
  "logger": "pino"
}
```

Members violating any of these are flagged. When Phase 37 (Invariants) resumes, this collapses into workspace-scoped invariants.

### 4.8 Public-route exposure & unintended-public-route detection

A route's `visibility` is `'public'` if it's intended to be reachable from outside the workspace (mobile clients, third parties), `'internal'` otherwise. Two consequences:

- **No false `orphan-route` alarm for public routes.** `workspace.http.orphan-route` only fires for `visibility: 'internal'` routes that no member calls.
- **Dashboard surfaces public routes explicitly.** Each route in the system graph carries a public/internal badge so the engineer can see at a glance which surface is exposed.

**Source of `visibility`:**

1. Explicit per-route declaration in `workspace.json` (`"publicRoutes": ["GET /api/health", "POST /webhooks/*"]`).
2. Heuristic — path conventions: `/admin/*`, `/internal/*`, `/_*` default to `internal`; everything else under `/api/*` defaults to `public` if there is no internal-only auth middleware in the route's call chain.
3. Inference from auth middleware (`requireInternalAuth`, `internalOnly`) when present.

**New rule: `workspace.http.unintended-public-route`** — flags routes that appear publicly reachable but look like they shouldn't be:

- Heuristic signals: path contains `admin|internal|debug|_dev|test`; route handler calls privileged operations (drop table, bulk delete, secret export); route lacks any auth middleware.
- Severity: high — this is a security finding, not a stylistic one.
- Confidence tiers: deterministic-high (path + no auth), heuristic-medium (path or behavior alone), LLM-low (model thinks the handler does sensitive work). Path heuristics ship in v1; LLM tier is opt-in.

This rule is what turns the public/internal distinction from documentation into an active check.

## 5. Workspace violation schema

Workspace violations extend the existing per-repo violation type with a `scope` discriminator and a workspace-namespaced `kind`. Same downstream lifecycle (open / dismissed / fixed), same dashboard, same store conventions.

```ts
type WorkspaceViolation = {
  id: string;                    // stable, content-addressed across runs
  scope: 'workspace';            // distinguishes from per-repo (scope: 'repo')
  kind: 'workspace.http.orphan-call'
      | 'workspace.http.orphan-route'
      | 'workspace.http.method-mismatch'
      | 'workspace.http.status-uncovered'
      | 'workspace.http.request-schema-mismatch'
      | 'workspace.http.response-schema-mismatch'
      | 'workspace.http.unintended-public-route'
      | 'workspace.queue.orphan-producer'
      | 'workspace.queue.orphan-consumer'
      | 'workspace.queue.payload-mismatch'
      | 'workspace.db.column-type'
      | 'workspace.db.nullability'
      | 'workspace.db.column-missing'
      | 'workspace.db.fk-mismatch'
      | 'workspace.homogeneity.framework'
      | 'workspace.homogeneity.orm'
      | 'workspace.schema.route-not-in-schema'
      | 'workspace.schema.client-undeclared-field'
      | ...;
  severity: 'high' | 'medium' | 'low';
  confidence: number;            // 0..1
  sites: {
    a: { repo: string, branch: string, commit: string, file: string, line: number, snippet?: string };
    b?: { repo: string, branch: string, commit: string, file: string, line: number, snippet?: string };
  };
  details: Record<string, unknown>;  // kind-specific payload
};
```

**ID stability.** Content-addressed on `(kind, normalized sites, normalized details)`. The site normalization strips the line number and snippet — a refactor that moves the call site five lines down must not break identity. Branch and commit are recorded for context but excluded from the identity hash so a violation is the same violation across branches.

## 6. UX

### 6.1 CLI

```bash
truecourse workspace init <name>             # create workspace
truecourse workspace add <repo-path>         # register a repo as a member (no analysis)
truecourse workspace remove <repo-path>      # unregister
truecourse workspace list                    # list workspaces / members
truecourse workspace status                  # per-member freshness report
truecourse workspace analyze                 # cross-repo analysis over existing surfaces
truecourse workspace dashboard               # open dashboard at workspace view
```

**The flow is deliberately layered:** per-repo `analyze` is a per-repo concern; the workspace layer never silently triggers it.

1. **In each member repo**, the engineer runs `truecourse analyze` normally. This produces `LATEST.json` + `interface-surface.json` for that repo.
2. **`truecourse workspace add <path>`** registers the repo as a workspace member. Cheap: validates the path is a directory, writes a `workspace-link.json` breadcrumb, appends the member to `workspace.json`. No analysis. No waiting. If the target has no `interface-surface.json` yet, `add` succeeds and prints a hint: "no analysis yet — run `truecourse analyze` in <path> before `workspace analyze`."
3. **`truecourse workspace analyze`** reads each member's `interface-surface.json`, runs matchers and rules, writes `cross-repo.json`. Behavior on imperfect inputs:
   - **Missing surface** (member never analyzed, or pre-Phase-38 install): hard fail with `Member "<name>" has no interface surface — run \`truecourse analyze\` in <path> first.` No magic.
   - **Stale surface** (older than the member's git HEAD commit, or older than 24h, whichever): warn + proceed. Staleness recorded in `cross-repo.json` metadata and surfaced as a dashboard banner. The user decides when to re-analyze.
4. **`truecourse workspace status`** is the freshness reporter: per member, prints last-analyzed timestamp, the commit it was on, current HEAD, and whether the surface is stale. Pure read; no side effects.

There is intentionally no `--refresh` flag — coupling cross-repo analysis to per-repo re-runs reintroduces the implicit "workspace analyze did stuff in my other repos" behavior this layering exists to avoid.

### 6.2 Dashboard

New top-level view at `/workspace/<id>` parallel to the existing single-repo dashboard:

- **System graph**: services as super-nodes; HTTP/queue/DB edges between them; workspace-violation badges on edges; per-route public/internal pill so exposed surface is visible at a glance.
- **Violations panel**: filter by kind / severity / member-pair / scope. Workspace and per-repo violations share one stream, distinguished by `scope`.
- **Violation detail**: side-by-side anchored code — route definition (siteA) vs call site (siteB) — reusing the existing code viewer.
- **Member switcher**: jump to any member's per-repo dashboard.
- **Public-surface view**: a filter that lists every route with `visibility: 'public'` across all members, plus the `unintended-public-route` findings on top — gives the engineer an explicit "this is what the outside world can hit" surface.

The single-repo dashboard stays unchanged. The workspace view is additive.

## 7. Sub-phases

Each sub-phase is a separate `STATUS:` line in `PLAN.md` so progress can be tracked there.

### 38.1 Workspace scaffolding
CLI commands (`init`, `add`, `remove`, `list`, `status`), storage layer, `workspace.json` schema, `workspace-link.json` breadcrumb, hostMap, sharedDatabases config, freshness reporter. No analysis yet — `workspace analyze` lands in 38.4.

### 38.2 Interface surface — HTTP
Per-repo extractor for HTTP routes (extend existing) and HTTP calls (new). TS/JS first; Python in 38.11.

### 38.3 Cross-repo HTTP matcher
hostMap resolution, path canonicalization, confidence tiers, optional LLM tiebreaker.

### 38.4 HTTP violation rules
The six contract rules in §5 plus `workspace.http.unintended-public-route` from §4.8. Public/internal visibility resolution lives here too.

### 38.5 Workspace dashboard
System graph, violations panel (workspace + per-repo unified), side-by-side violation viewer, public-surface filter.

### 38.6 Queue / messaging support
Kafka / Redis / RabbitMQ / SQS / NATS extractors + matcher + 3 violation rules.

### 38.7 Shared database violations
sharedDatabases config, ORM schema comparison, 4 violation rules.

### 38.8 Workspace homogeneity rules
Framework / ORM / logger / error-handling homogeneity. Eventually merges into Phase 37 invariants when 37 resumes.

### 38.9 Schema-file ground truth
OpenAPI / GraphQL / gRPC / AsyncAPI ingestion + validation against extracted surfaces.

### 38.10 Workspace violation lifecycle
Apply the existing per-repo violation lifecycle (open / dismissed / fixed) to `scope: 'workspace'` violations.

### 38.11 Cross-language coverage
Python interface-surface emitter. Surface is already language-agnostic; this is just an emitter port.

### 38.12 Cloud workspace sync `STATUS: BACKLOG`
Workspace lives in TrueCourse cloud. Each repo's CI pushes `interface-surface.json` on PR. PR check fails if a PR breaks a contract another member depends on. Depends on Phase 15.

## 8. Sequencing

Shortest path to user-visible value: **38.1 → 38.2 → 38.3 → 38.4 → 38.5**. After that point the engineer has a workspace, can `analyze`, and sees frontend↔backend violations in a graph. Everything else (queues, DB, homogeneity, schema files, multi-language) extends the same plumbing.

Testing strategy: a `tests/fixtures/sample-workspace/` containing 2–3 small member repos with intentionally drifting contracts. Used end-to-end across 38.2–38.5 and as the base for queue/DB scenarios.

## 9. Decisions & open questions

**Resolved (recorded for posterity):**

- **Layered flow.** Per-repo `analyze` is a per-repo concern; the workspace layer never triggers it. The engineer runs `analyze` in each repo, then `workspace add`, then `workspace analyze`. (See §6.1.)
- **`workspace add`.** Registration only. No analysis, no waiting. If the target has no `interface-surface.json` yet, succeeds and prints a hint to run `analyze` first.
- **`workspace analyze` on imperfect inputs.** Missing surface → hard fail with an actionable message. Stale surface → warn + proceed; staleness shown in `cross-repo.json` metadata and the dashboard. No `--refresh` flag.
- **`workspace status`.** Separate read-only command for per-member freshness reporting.
- **Workspace lock.** Yes — `~/.truecourse/workspaces/<id>/.lock`, mirroring per-repo `.analyze.lock`.
- **Persisted artifact versioning.** Every persisted JSON has `schemaVersion: number`. Read path runs migration chain `vN → ... → current`; write path emits the latest. Migrators at `packages/core/src/services/workspace/migrations/<artifact>/`. Day one ships at v1 with empty chain. (See §3.1.)
- **Workspace violation identity.** Workspace violations live in the same stream as per-repo violations, distinguished by `scope: 'workspace'` and `kind: 'workspace.*'`. Same lifecycle. (See §5.)
- **Branch awareness.** Per-repo `analyze` records `git: { branch, commit }` into `interface-surface.json`. Cross-repo runs read those fields and label what's being compared. The branch is whatever the member was on when its last `analyze` ran.
- **External callers.** Routes carry a `visibility: 'public' | 'internal'` flag. `orphan-route` only fires for `internal`. Public routes are surfaced explicitly in the dashboard, and a new `workspace.http.unintended-public-route` rule flags routes that look publicly reachable but shouldn't be (path heuristics + missing-auth detection). (See §4.8.)

**Still open:**

1. **Body / response shape inference depth.** First-version proposal: local-only — the body shape is what's literally constructed at the call site (e.g. `{ name, email }` next to the `fetch`). Cross-file flow (`const payload = buildUserDTO(...)` defined elsewhere) is more accurate but expensive and FP-prone. Lean: ship local-only, let real-codebase battle testing in 38.4 tell us when cross-file earns its keep. **Confirm or push to cross-file from day one?**

## 10. Out of scope (for this phase)

- Runtime / deployment-time drift (what's actually deployed vs what the code says). That's a future phase, possibly tied to OpenTelemetry traces.
- Cross-org workspaces (repos from different GitHub orgs in one workspace). Possible technically; deferred until cloud (38.12).
- Auto-generated client SDKs. We *consume* schema files (38.9) but we don't generate or update SDKs.
- Migration co-ordination ("if you change column X in repo A, here is the order to deploy" — Phase 19 ADR territory, not 38).
