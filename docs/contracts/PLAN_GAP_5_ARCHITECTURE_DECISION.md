# PLAN — Gap 5: ArchitectureDecision comparator

Status: DONE (implemented 2026-05-26, il-framework branch). New `ArchitectureDecision` artifact kind + `.tc` grammar + lifter, all 10 category detectors over shared package.json / import / config-file signal collectors, the comparator (unmet-choice / forbidden-alternative / inconclusive), orchestrator wiring in `verify.ts`, and the LLM extractor prompt section are implemented. Verified end-to-end on `sample-js-project-il/` plus per-detector / lifter / comparator unit tests.
Fixture set: ADRs in the target repo + spec sections describing platform / framework / data / messaging choices. No pre-existing audit bucket — this gap reads contracts that the audit didn't probe (ADRs were extracted into spec slices but not asserted against code by the previous engine versions).

## Goal

Make the verifier catch drift between an architectural decision the spec/ADR asserts (e.g., "we use Postgres", "REST not GraphQL", "Kafka for inter-service messaging") and what the code actually does.

These are **system-wide invariants** — claims about the whole codebase, not about a specific endpoint or entity. They show up most often in ADRs but also appear in PRDs ("Technical Notes: no backend infrastructure", "Tech Stack: claude-sonnet-4-6 via Anthropic SDK") and READMEs.

## Why this isn't expressible with existing artifacts

`ForbiddenArtifact` covers the negative half: "the openai package must NOT exist." But ADRs usually phrase the positive choice: "we use the Anthropic SDK." The engine today has no way to express "the codebase MUST use X." Compose-with-existing would force every ADR to enumerate its rejected alternatives — clunky and incomplete.

## Scope decisions (locked)

- **Single artifact kind `ArchitectureDecision`** with a categorical `category` enum + a `chosen` value. The IL stores the positive choice; the comparator's category-detector knows the closed set of alternatives.
- **Detection signals — three layers per category:**
  1. `package.json` (dependencies / devDependencies / peerDependencies / optionalDependencies)
  2. Characteristic imports in TS/JS source files
  3. Config files (Dockerfile, docker-compose.yml, prisma/schema.prisma, vite.config.ts, next.config.js, serverless.yml, wrangler.toml, deno.json, fly.toml, k8s manifests, etc.)
  
  Each per-category detector picks the right signal mix.
- **Semantics — positive choice + auto-derived alternatives:**
  Spec says `data-store: postgres` → engine asserts BOTH (a) Postgres signals are present AND (b) no alternative signals (MongoDB, MySQL, etc.) are present. Drift on either side. The IL does NOT require the spec to enumerate rejected alternatives.
- **Categories — 10 from day one** (see §6).
- **JS/TS only** for import-based detection; package.json + config-file detection works regardless of language.

## IL artifact shape

```ts
export interface ArchitectureDecisionContract {
  category: 
    | 'data-store'
    | 'communication-pattern'
    | 'messaging'
    | 'architecture-style'
    | 'auth-strategy'
    | 'frontend-framework'
    | 'runtime'
    | 'deployment-platform'
    | 'package-manager'
    | 'build-system';
  /**
   * The positive choice the spec asserts. Value space depends on
   * category — each category defines a closed enum of valid choices,
   * declared in the detector module. See §6 below.
   */
  chosen: string;
  /**
   * Free-form prose from the ADR / spec — the WHY behind the choice.
   * Surfaced in drift messages so the dev sees the rationale, not
   * just "spec said postgres."
   */
  reason: string;
  /**
   * Optional: spec may declare specific alternatives it explicitly
   * REJECTED. These compound with the auto-derived alternatives —
   * the detector flags either set if found in code.
   */
  rejectedAlternatives?: string[];
  /**
   * Optional: when the architectural claim only applies to a part of
   * the repo (e.g., "frontend uses React, backend uses Express"), a
   * scope selector narrows where the detector runs.
   */
  scope?: { pathGlob: string };
}
```

## .tc grammar

```
architecture-decision storage.postgres {
  origin SPEC.md "Data Store" 30..45
  category data-store
  chosen postgres
  reason "Spec mandates Postgres; full-text search via tsvector relied on across all queries"
  rejected-alternatives [mongodb, mysql]
}

architecture-decision messaging.kafka {
  origin ADR-007.md "Inter-service messaging" 1..20
  category messaging
  chosen kafka
  reason "Strict ordering per partition + replay required for audit"
}

architecture-decision frontend.react {
  origin README.md "Stack" 10..15
  category frontend-framework
  chosen react
  reason "Existing component library reuse"
  scope { path-glob "app/**" }
}
```

## Categories, alternative sets, detection signals

Each category's detector lives in its own file and knows three things:
the closed enum of valid `chosen` values, the detection signals per
value, and how to disambiguate when multiple are present.

### `data-store`
**Alternatives:** `postgres` | `mysql` | `mongodb` | `sqlite` | `dynamodb` | `redis-primary` | `bigquery` | `cassandra` | `cockroachdb`

| Choice | Package signals | Import signals | Config signals |
|---|---|---|---|
| postgres | `pg`, `postgres`, `node-postgres`, `@prisma/client` | `import { Pool } from 'pg'`, `from 'postgres'` | `prisma/schema.prisma` `provider = "postgresql"`, `DATABASE_URL=postgres://...` |
| mysql | `mysql`, `mysql2` | `from 'mysql2'`, `from 'mysql'` | `provider = "mysql"` |
| mongodb | `mongoose`, `mongodb` | `from 'mongoose'`, `from 'mongodb'` | `provider = "mongodb"` |
| sqlite | `better-sqlite3`, `sqlite`, `sqlite3` | — | `provider = "sqlite"` |
| dynamodb | `@aws-sdk/client-dynamodb`, `dynamoose` | — | — |
| redis-primary | `ioredis`, `redis`, `@upstash/redis` | — | Disambiguate cache vs primary via usage pattern (writes vs `SETEX`) |
| bigquery | `@google-cloud/bigquery` | — | — |

### `communication-pattern`
**Alternatives:** `rest` | `grpc` | `graphql` | `trpc` | `message-queue-primary`

| Choice | Package signals | Import signals | Config signals |
|---|---|---|---|
| rest | `express`, `fastify`, `koa`, `hapi`, `@nestjs/core` | route declarations (`app.get`, `@Controller`) | OpenAPI spec files |
| grpc | `@grpc/grpc-js`, `grpc-tools`, `nice-grpc` | — | `*.proto` files present |
| graphql | `apollo-server`, `graphql-yoga`, `@nestjs/graphql`, `mercurius` | — | `*.graphql`, `*.gql` files |
| trpc | `@trpc/server`, `@trpc/client` | `import { router } from '@trpc/server'` | — |

### `messaging`
**Alternatives:** `kafka` | `rabbitmq` | `sqs` | `nats` | `eventbridge` | `gcp-pubsub` | `azure-servicebus` | `redis-pubsub` | `none`

| Choice | Package signals |
|---|---|
| kafka | `kafkajs`, `@kafkajs/confluent-schema-registry` |
| rabbitmq | `amqplib`, `amqp-connection-manager` |
| sqs | `@aws-sdk/client-sqs` |
| nats | `nats` |
| eventbridge | `@aws-sdk/client-eventbridge` |
| gcp-pubsub | `@google-cloud/pubsub` |
| azure-servicebus | `@azure/service-bus` |
| redis-pubsub | `ioredis`/`redis` + subscribe call patterns |
| none | absence of all of the above |

### `architecture-style`
**Alternatives:** `monolith` | `modular-monolith` | `microservices` | `serverless`

| Choice | Signals |
|---|---|
| monolith | Single `package.json`, single deploy target, no workspace config |
| modular-monolith | Monorepo (pnpm/yarn workspaces, nx, turborepo) but single deploy |
| microservices | Multiple `package.json` under `services/*` or `packages/*` each with own Dockerfile, separate deploy artifacts |
| serverless | `serverless.yml`, `sam.yaml`, CDK with Lambda constructs, `*.handler` exports |

### `auth-strategy`
**Alternatives:** `session-cookie` | `jwt` | `oauth2` | `auth0` | `clerk` | `supabase` | `cognito` | `api-key` | `none`

(Package signals: `express-session`, `jsonwebtoken`, `passport-oauth2`, `@auth0/*`, `@clerk/*`, `@supabase/supabase-js`, `amazon-cognito-identity-js`, etc.)

### `frontend-framework`
**Alternatives:** `react` | `vue` | `svelte` | `angular` | `solid` | `htmx` | `none`

(Package signals + framework-specific config files.)

### `runtime`
**Alternatives:** `node` | `bun` | `deno` | `cloudflare-workers` | `edge`

| Choice | Signals |
|---|---|
| node | `package.json` `engines.node`, `.nvmrc`, no other runtime markers |
| bun | `bun.lockb`, `engines.bun` |
| deno | `deno.json`, `deno.lock`, import maps |
| cloudflare-workers | `wrangler.toml` |
| edge | `next.config.js` with `runtime: 'edge'` |

### `deployment-platform`
**Alternatives:** `aws` | `gcp` | `azure` | `vercel` | `netlify` | `cloudflare` | `fly` | `railway` | `render` | `heroku` | `self-hosted-k8s` | `self-hosted-docker`

(Mostly config-file based: `serverless.yml provider: aws`, `vercel.json`, `netlify.toml`, `fly.toml`, `Procfile`, k8s manifests, etc.)

### `package-manager`
**Alternatives:** `npm` | `yarn` | `pnpm` | `bun`

(Lock-file presence: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`.)

### `build-system`
**Alternatives:** `vite` | `webpack` | `turbopack` | `esbuild` | `rollup` | `bun-bundler` | `parcel` | `tsc-only`

(Config files: `vite.config.*`, `webpack.config.*`, `turbo.json` + Next.js Turbopack flag, etc.)

## Code-side detector output

```ts
export interface DetectedArchitectureChoice {
  category: ArchitectureDecisionContract['category'];
  /**
   * The choice the detector observed. Multiple values can appear if
   * the codebase legitimately uses several (e.g., redis as cache + 
   * postgres as primary store) — the detector returns all of them
   * and the comparator decides whether that matches the spec.
   */
  observed: Array<{
    value: string;
    signals: DetectionSignal[];
  }>;
  /**
   * Whether the detector found enough signal to make a determination.
   * `inconclusive` when no signals from any alternative were found —
   * comparator emits an `info` drift rather than a false-positive.
   */
  confidence: 'high' | 'medium' | 'low' | 'inconclusive';
}

export interface DetectionSignal {
  kind: 'package' | 'import' | 'config-file' | 'usage-pattern';
  source: SourceLocation;
  detail: string;
}
```

## Comparator drift kinds

```
architecture.${category}.unmet-choice           critical    spec asserts X, X NOT detected in code
architecture.${category}.forbidden-alternative  critical    spec asserts X, alternative Y also detected
architecture.${category}.inconclusive           info        detector found no signals either way
```

Severity: critical by default — architecture decisions are usually high-blast-radius. Comparator allows per-rule severity overrides.

## Adapter contract

```ts
// One detector per category, all conforming to:
export interface ArchitectureDetector {
  category: ArchitectureDecisionContract['category'];
  /** The closed enum of valid choices. */
  alternatives: readonly string[];
  detect(opts: { codeDir: string; scope?: { pathGlob: string } }): Promise<DetectedArchitectureChoice>;
}
```

The dispatcher `extractor/architecture/index.ts` runs ONLY the detectors needed for the spec's `ArchitectureDecision` artifacts (no point detecting the data store if the spec makes no claim about it). Detectors are cached per-codeDir for a single verify run so two `data-store` rules don't double-scan.

## Detector file layout

```
packages/contract-verifier/src/extractor/architecture/
├── index.ts                      ← dispatcher + caching
├── types.ts                      ← DetectedArchitectureChoice, DetectionSignal, ArchitectureDetector
├── shared/
│   ├── package-json.ts           ← parse package.json, detect dep presence (shared by every detector)
│   ├── characteristic-imports.ts ← tree-sitter scan for `from 'X'` (shared)
│   └── config-files.ts           ← read+parse named config files (shared)
├── data-store.ts
├── communication-pattern.ts
├── messaging.ts
├── architecture-style.ts
├── auth-strategy.ts
├── frontend-framework.ts
├── runtime.ts
├── deployment-platform.ts
├── package-manager.ts
└── build-system.ts
```

Each category file is a thin composition over the shared signal-collection utilities.

## Comparator behaviour

For each `ArchitectureDecision` artifact:

1. Look up the detector for the category.
2. Run the detector, get observed choices + signals.
3. **Unmet-choice check:** if `chosen` is NOT in `observed`, emit critical drift.
4. **Forbidden-alternative check:** for each observed value that isn't `chosen`, check if it's in (auto-derived alternatives ∪ explicit `rejectedAlternatives`). If so, emit critical drift.
5. **Inconclusive case:** confidence=inconclusive → info drift, the spec's claim wasn't testable from current signals.

## LLM extractor prompt

New prompt section telling Claude:

- Recognise ADR phrasings: "we chose X", "decision: use Y", "rejected: Z because", "Tech Stack:", "Stack:", "Data Store:".
- One `architecture-decision` per decision recorded in the ADR.
- Map prose → category. Provide a category lookup table in the prompt.
- Map prose → `chosen` value. The category's valid-value enum lives in the prompt for the LLM to match against.
- Capture the `reason` verbatim from the ADR's "context" or "consequences" section.

## Implementation order

1. ✅ Plan (this doc).
2. ✅ IL kind + lifter + `.tc` grammar (new ArtifactKind `ArchitectureDecision`).
3. ✅ Shared detector utilities (`package-json.ts`, `characteristic-imports.ts`, `config-files.ts`, plus `detect.ts` composition helper).
4. ✅ First three category detectors: `data-store`, `communication-pattern`, `messaging`.
5. ✅ Comparator + orchestrator wiring.
6. ✅ Remaining 7 category detectors (`architecture-style`, `auth-strategy`, `frontend-framework`, `runtime`, `deployment-platform`, `package-manager`, `build-system`).
7. ✅ LLM prompt section (`packages/contract-extractor/src/prompt.ts`).
8. ✅ Tests (per-detector unit + lifter + comparator + end-to-end fixture).
9. End-to-end on Compliance (its ADRs are sparse — main signal will be README "Tech Stack" and "no backend" PRD claims, the same ones that gap-3 partially covered via forbidden-presence). — NOT YET (separate eval target; the `sample-js-project-il` fixture is the regression harness).

## Out of scope

- Architectural patterns that aren't dep/config-detectable (e.g., "hexagonal architecture", "ports and adapters", "CQRS as a code-organization principle"). These are layering / dependency-direction claims; detecting them needs whole-codebase dependency-graph analysis we don't have.
- Custom alternative values outside the category's closed enum. The LLM is told to map to known values or emit `unenforceable-obligation` instead.
- Cross-decision consistency (e.g., "if data-store=postgres then auth-strategy can't be cognito-via-aws-only"). v1 evaluates each decision independently.
- Python-specific signals (Python `requirements.txt` reading, Python imports). The shared detector utilities are designed to add this when Python verifier work lands.
- Runtime feature flags or feature-gate-style decisions ("we use feature-X experimentally") — covered by ForbiddenArtifact `feature-flag`.

## Success criteria

When this gap ships, an ADR like:

```markdown
# ADR-007: Use Kafka for inter-service messaging

## Context
We need ordered, replayable events for the audit pipeline.

## Decision
Adopt Kafka.

## Rejected
- RabbitMQ — no replay support without plugins
- SQS — at-least-once but no strict ordering per key
```

…should produce an `architecture-decision messaging.kafka { ... }` contract during `contracts generate`, and `truecourse verify` should emit a `architecture.messaging.unmet-choice` drift if the code only uses `amqplib`, or a `forbidden-alternative` drift if both `kafkajs` and `amqplib` appear.
