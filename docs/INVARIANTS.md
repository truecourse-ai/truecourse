# Invariants & Plugins — Framework Design

A self-sustained subsystem inside TrueCourse for catching **semantic** correctness defects. Plugins (shipped with TrueCourse) take a project's spec/requirements documents and code, generate Invariants — per-project facts that must always hold — and enforce them at analyze time. Violations land in TrueCourse's existing violations bucket alongside rule-based findings.

This document defines the framework. It is intentionally generic: no validation set, no specific bug catalog, no per-industry examples. The initial plugin catalog is a *starter set* — more plugin types will be added over time.

## The model in one picture

```
Inputs:   spec/requirements + code
              │
              ▼
          Plugins               (shipped; know how to read the inputs)
              │
              ▼
         Invariants             (per-project; generated, then reviewed)
              │
              ▼
    Enforce (code vs invariants) at analyze time
              │
              ▼
         Violations             (same bucket as static-rule violations)
```

Parallel to the existing path:

```
     Code → Static rules (shipped) → Violations
```

Two paths, one output. **Think of invariants as dynamic, per-project rules** — in contrast to TrueCourse's static, shipped rule catalog. Static rules fire on patterns the analyzer recognizes without project context. Dynamic rules (invariants) encode facts specific to this project, generated from its spec + code, and enforced every run.

The name stays **Invariant** — "Rule" would collide with the existing catalog — but the dynamic-rule framing is the right intuition.

## Why this exists

TrueCourse today catches **structural** defects well — dead wiring, missing guards that sibling code paths share, type and shape mismatches, orphaned producers, cross-route asymmetries. These are patterns the analyzer can recognize without project context.

TrueCourse does not catch **semantic** defects — bugs where the code is internally consistent but wrong relative to intent. Illegal state-machine transitions, broken ordering guarantees, spec drift, fairness violations, domain-specific contract breaks. These defects share a common shape: *the correctness statement is not in the code, it's a fact about the project the code must uphold.*

The missing capability is a per-project layer of **declared correctness** that TrueCourse generates from the project's own inputs (spec + code), the team confirms once, and the analyzer enforces on every run. Static rules alone can't express this — they're patterns, not facts about a particular project.

---

## Core concepts

### Invariant

A per-project fact that must always hold. Lives as a YAML file in `.truecourse/invariants/<slug>.yaml`. Committed to the repo. Binds to exactly one plugin via its `type:` field. The declaration is the canonical record — enforcement reads it literally.

Example (indicative):

```yaml
# .truecourse/invariants/state-machine__order-status.yaml
type: state-machine
plugin-version: 1
scope: Order.status
states: [draft, placed, paid, shipped, delivered, cancelled]
terminal: [delivered, cancelled]
transitions:
  - {from: draft,   to: placed}
  - {from: placed,  to: [paid, cancelled]}
  - {from: paid,    to: [shipped, cancelled]}
  - {from: shipped, to: delivered}
provenance:
  source: discovered
  inputs: [spec, code]
  timestamp: 2026-04-23
  signal: "matches PRD § 'order lifecycle'; 7 write sites under src/services/"
```

Invariants are reviewed like code. `.truecourse/invariants/` is **committed**, not gitignored — unlike `LATEST.json`, `history.json`, `graphs/`, `flows/`.

### Plugin

A shipped module that generates and enforces invariants of one type. Takes (spec + code) as input. Owns the declaration schema. No per-project state. Versioned alongside TrueCourse releases.

Interface:

```ts
interface Plugin<I extends Invariant> {
  readonly type: string;       // "state-machine", "ordering", etc.
  readonly version: number;
  readonly schema: JsonSchema;  // validates declarations of this type

  discover(ctx: DiscoverContext): Promise<I[]>;
  enforce(invariant: I, ctx: EnforceContext): Promise<Violation[]>;

  // Optional: declare whether an existing invariant's anchor still exists
  // (e.g., the field/route/spec section it targets). Feeds drift detection.
  checkAnchor?(invariant: I, ctx: DiscoverContext): 'present' | 'missing';

  migrate?(invariant: unknown, fromVersion: number): I;
}
```

`DiscoverContext` carries:
- the parsed codebase
- the project's spec/requirements documents (SPEC.md, PRDs, business-requirements files, README — pre-ingested; see § Inputs)
- all currently-active invariants (so plugins can cross-reference — e.g., `lease-gating` may consult `state-machine`)
- the rejected-signatures store
- the run mode (`'full'` or `'diff'`) and, in `'diff'` mode, the checkpoint + diff (changed files, changed spec sections) — see § Incremental discovery

`EnforceContext` carries the parsed codebase and a bounded LLM budget if the plugin opts in. Enforcement runs against code only — the spec/requirements were already distilled into the invariant at discovery time.

Plugins return `Violation[]` (TrueCourse's existing violation shape — see § Enforcement output), not a plugin-internal finding type. Output unification is a framework guarantee.

### Rule (for contrast)

A pattern-matching static check in TrueCourse's existing catalog. Fires directly on code; no project-specific declaration required. The existing rule catalog remains rules — no refactor. Examples: "no unused exports," "orphan producer," "sibling routes should share guards."

**Static rule vs. Plugin decision table:**

| Situation | Use |
|---|---|
| Pattern check with no project-specific context (shape, name, unused, orphan) | **Static rule** |
| Correctness statement that varies per project (state machine, ordering guarantee, spec contract, guard-sharing group) | **Plugin** (generates an invariant) |

Static rules compose by being enabled in config. Plugins compose by producing invariants whose enforcement is deterministic once declared.

---

## Design principles

- **Invariants are a self-sustained subsystem.** A project can adopt Invariants without using ADRs, Graphs, Flows, or any other TrueCourse concept.
- **Three distinct concepts, no overlap.** **Static rules** (shipped, fire on patterns), **Plugins** (shipped, own one invariant type each), **Invariants** (per-project, generated, enforced).
- **Spec + code are co-equal inputs.** Every plugin takes both. Some lean heavier on one side (`rest-contract` is spec-heavy; `cross-route-guard` is code-heavy), but the input shape is the same.
- **Discovery before authoring.** Plugins propose candidates from spec + code. The team's job is reviewing drafts, not authoring invariants from scratch. Hand-authoring is supported as an escape hatch.
- **Enforcement is deterministic where possible, LLM where necessary.** Plugin `discover` methods may use LLM filters and extraction. Plugin `enforce` methods are deterministic by default — LLM is a fallback only for invariant types that defy static checking.
- **Drift is a first-class signal.** A plugin re-running discovery may find that an active invariant no longer matches the current spec or code. Stale invariants are a review-queue signal, not an enforcement bypass.
- **Invariants are versioned; plugins have a schema.** Each invariant binds to a plugin version. Plugin schema changes require migrations, not silent breakage.
- **Authoring burden scales with project, not catalog.** A team commits tens of invariants once. The plugin catalog grows unbounded but is authored in TrueCourse core.
- **Deterministic enforcement over noisy catches.** Better to miss a candidate than to flag a false positive on real code. Discovery FPs cost a review; enforcement FPs cost trust.
- **One output bucket.** Invariant-enforcement violations land in the same violations store as rule-based findings, tagged so consumers can filter by source.

---

## Inputs

Plugins read two kinds of input:

1. **Code.** The parsed codebase, shared with the rest of the analyzer. Same AST, same module graph, same call trees. No plugin-specific parsing. Per-file language is resolved via the analyzer's existing `detectLanguage(filePath)` (`packages/analyzer/src/language-config.ts`) — plugins do not reimplement extension→language mapping.
2. **Spec / requirements documents (v1: files only).** Human-written text describing what the system must do — `SPEC.md`, `docs/SPEC.md`, PRDs, business-requirements docs, README. Discovered by convention (`SPEC.md` at repo root) with a `.truecourse/config.json` override and fallback detection for common names (`SPEC*.md`, `SPECIFICATION.md`, `docs/spec.md`, `PRD*.md`, `REQUIREMENTS.md`, `README.md` last-resort). Pre-ingested per `suggest` run (section-hashed, so `--diff` re-extracts only changed sections) and passed to every plugin. **External sources** (Jira, Linear, Notion, Confluence) are post-v1 — see § Spec sources.

Plugins are free to use either, both, or neither depending on their type. `rest-contract` primarily extracts claims from documents and locates them in code. `state-machine` reads code enum-write sites but may also consult the spec for named lifecycle stages. `cross-route-guard` is mostly code-driven but a business-requirements line like "all billing endpoints require payment validation" is a strong signal. The framework does not prescribe a ratio — plugins choose.

Drafts carry provenance indicating which inputs contributed (`inputs: [spec, code]`, `inputs: [code]`, etc.), so reviewers know where the signal came from.

---

## Spec sources

v1 reads spec from **files only**. The framework is designed so that other sources can be added later as **source connectors** without touching plugins.

### v1 (files)

- File reader is the only built-in source.
- Discovery via the conventions and overrides described in § Inputs.
- Pre-ingested per `suggest` run; section-hashed for `--diff`.

### Post-v1 (external connectors)

External systems where teams keep specs and requirements:

- Jira (issues, epics, acceptance criteria)
- Linear (issues, projects, labels)
- Notion (pages, databases)
- Confluence (pages, spaces)
- GitHub Issues / Projects

The framework treats each as a **source connector** that exposes the same interface as the file reader: enumerate sections, return content + section identity (e.g. `JIRA:PROJ-123`), section hash. Plugins do not see the difference between a spec file section and a Jira ticket.

Connector model (post-v1 design sketch):

- Connectors live under `packages/analyzer/src/spec-sources/<name>/`.
- Auth tokens and per-source filters (project keys, labels) configured in `.truecourse/config.json`.
- Aggressive caching at the source — fetch once per `suggest`, hash the result, only re-extract when content changes.
- Self-hosted instances supported via custom base URLs.
- Section identity is connector-namespaced (`FILE:SPEC.md#orders`, `JIRA:PROJ-123`, `LINEAR:ENG-42`) so the checkpoint disambiguates across sources.

External connectors ship after the file path is proven and at least one plugin (`rest-contract`) has shipped against it. They are explicitly **not** in the v1 scope.

---

## The three-phase process

Every invariant flows through three phases, regardless of plugin type.

### 1. Discover

The plugin reads spec + code and proposes candidate invariants. Signals come from code patterns (enum assignment sites, route groupings, call trees, query shapes) and from spec claims (lifecycle descriptions, error-code tables, endpoint contracts, ordering statements). LLM is used for extracting structured claims from spec prose and for filtering noisy code candidates. Output: drafts in the review queue, each with a confidence score and a one-line provenance signal.

Discovery also runs against already-accepted invariants. This does double duty:

- **Dedupe.** Plugins don't re-propose drafts already covered by an active declaration.
- **Drift detection.** An active invariant whose discovery signal no longer matches the current spec or code is flagged stale. The declaration stays active until the team decides. A severe drift — the invariant's anchor (target field, route group, spec section) no longer exists — is still Stale; the drift summary reads *"scope no longer exists; consider retiring"* and retirement is the team's action, not automatic.

Discovery runs on explicit `truecourse invariants suggest` — never auto-runs on `analyze`. LLM calls cost time and money; drafts need explicit review.

**Run modes (parallel to `analyze`).** `truecourse invariants suggest` runs a full rescan against the whole codebase + spec. `truecourse invariants suggest --diff` runs incrementally against the last checkpoint — only changed files and changed spec sections feed discovery. Same flag, same `mode: 'full' | 'diff'` server API as `analyze`. Incremental is how teams keep the invariant set current as the project grows without paying for full LLM extraction on every run. See § Incremental discovery.

### 2. Declare

The team reviews each draft — accept, edit, or reject. Accept writes a structured YAML file to `.truecourse/invariants/`. Reject persists the draft signature to `.truecourse/invariant-rejected.json` so discovery doesn't resurface it.

Declarations are structured (typed against the plugin's schema) and self-contained. Everything downstream reads from the declaration; prose context is optional commentary, never load-bearing.

Hand-authoring is equally supported — a team can write an invariant YAML file by hand and the enforce path treats it identically to a discovered-and-accepted one. Discovery is the ergonomic default; authoring parity means the substrate doesn't depend on the plugin getting discovery right.

### 3. Enforce

On every `truecourse analyze`:

1. Load active invariants from `.truecourse/invariants/*.yaml`. Validate each against its plugin's schema. Invariants bound to unknown plugin types or incompatible versions are skipped with a warning (not a failure).
2. For each invariant, call its plugin's `enforce` with the parsed codebase.
3. Collect returned `Violation[]` from all plugins. Merge with rule-based violations into the unified analyze output.

Enforcement is deterministic where possible. Some invariant types fall back to LLM comparison — these declare `enforcement: llm` in their schema and are tuned conservatively.

**Diff-check integration.** `truecourse diff-check` also enforces invariants. A PR that introduces a violation cites the invariant in the output, parallel to how diff-check already cites ADRs.

---

## Enforcement output

Invariant-enforcement findings land in the **same violations bucket** used by the existing rule catalog — `packages/shared/src/types/violations.ts`. Consumers (dashboard, CLI, diff-check, exports) do not get a second list to merge.

Extensions to the existing `Violation` schema:

- **`type`** — add `'invariant'` to `ViolationTypeSchema`. Downstream filters distinguish invariant-sourced violations from rule-sourced ones by this field.
- **`invariantId?`** — new optional field, parallel to the existing `ruleKey?`. Populated when `type === 'invariant'`. Points back to the slug of the invariant in `.truecourse/invariants/<slug>.yaml`.
- **Existing fields** — `severity`, `status`, `target*Id`, `title`, `content`, `fixPrompt`, `firstSeenAt`, `resolvedAt`, `createdAt` apply unchanged.

This keeps the dashboard, history tracking, diff status (new/unchanged/resolved), and all existing violation tooling working without branching code paths. The only places that need plugin-awareness are (a) the Invariants tab itself and (b) anywhere a user wants to filter *by source*.

Plugins must not invent a parallel finding type. A plugin that emits something that isn't a `Violation` is a bug in the plugin framework, not a feature.

---

## Property-test synthesis

Two plugins — `ordering` and `fairness` — cannot be enforced by static analysis alone. They declare a *behavioral* property (sort order under concurrency, work-distribution under load) that must be checked by **executing** the system under varied inputs. The framework provides a synthesis runtime that those plugins use to generate and run property-based tests.

### Model

- **Sandbox subprocess.** Tests run in an isolated subprocess that TrueCourse spawns and tears down. Never in-process with the analyzer (a generated property test can hang or OOM; we don't want that crashing analyze) and never inside the user's project tree.
- **Per-language adapters.** A small adapter per language wires the plugin's declared property into the language's idiomatic property-based runner.
- **Multi-language from day one.** v1 ships TS/JS and Python adapters. Other languages added alongside their analyzer/LSP support, never before — synthesis depends on being able to generate target-language code that calls into project code, which depends on the analyzer understanding it.

### Adapters and runners

| Language | Runner | Status |
|---|---|---|
| TypeScript / JavaScript | [fast-check](https://github.com/dubzzz/fast-check) | v1 |
| Python | [Hypothesis](https://hypothesis.readthedocs.io/) | v1 |
| C# | FsCheck (or CsCheck) | with C# analyzer/LSP |
| Java | jqwik | with Java analyzer/LSP |
| Go | testing/quick or gopter | with Go analyzer/LSP |

Adapters live under `packages/analyzer/src/plugins/synthesis/<language>/`. Each adapter knows: how to render a property assertion in its language, how to invoke its runner, how to capture pass/fail + counterexample.

### Runner provisioning

- **JS/TS.** fast-check is bundled as a TrueCourse dependency. The synthesis subprocess invokes `node` and imports it from TrueCourse's own `node_modules`. No user-side install required (beyond Node, which the user already has — they're running TrueCourse).
- **Python.** Cannot be used as a Node lib. The framework manages a dedicated venv at `~/.truecourse/runners/python/` and lazy-installs Hypothesis on first use. The synthesis subprocess invokes that venv's `python` interpreter. User just needs Python on PATH; TrueCourse owns the rest.

Same pattern applies for future languages: bundle if the runner is a Node lib, otherwise own a managed runtime under `~/.truecourse/runners/<language>/`.

### Language detection

Synthesis routes to the right adapter using the analyzer's existing `detectLanguage(filePath)` (`packages/analyzer/src/language-config.ts`). The plugin invariant's scope (target file or symbol) carries enough info to resolve the language. An invariant may explicitly override via `language:` in its YAML if auto-detection is wrong; otherwise inferred.

### Execution

For each enforcement run of an `ordering` or `fairness` invariant:

1. Plugin renders the property assertion (using the adapter for the target language) into a self-contained test harness.
2. Framework writes the harness to a TrueCourse-owned temp directory.
3. Framework spawns the language's runner subprocess with a timeout (configurable, default 30s) and a memory cap.
4. Runner emits pass / fail / timeout / OOM. On fail, runner reports a counterexample.
5. Plugin formats the result as a `Violation` (or no violation on pass).
6. Temp directory is cleaned up.

If the runner can't be installed (network failure on first lazy install, missing Python interpreter), the framework reports a clear error and skips enforcement of synthesis-based invariants — no silent failure, no stale violation persisted.

### Determinism and flakes

Property-based runners use seeded RNG. The framework records the seed alongside each violation so a run is reproducible. A counterexample that doesn't reproduce on re-run is a framework bug, not a flaky test.

---

## Incremental discovery

As a project grows, full rescans get expensive — every `suggest` run would re-parse the whole codebase and re-extract claims from the full spec via LLM. Incremental discovery solves this, mirroring the `analyze` / `analyze --diff` split.

### Modes

- **Full** (`truecourse invariants suggest`) — scan everything. Used on first run, after large refactors, or when the user wants a clean baseline.
- **Diff** (`truecourse invariants suggest --diff`) — scan only what changed since the last checkpoint. Default for day-to-day use.

Server API: `mode: 'full' | 'diff'`, identical to the existing `analyze` endpoint convention.

### Checkpoint

After every `suggest` run, the framework writes `.truecourse/invariant-checkpoint.json`:

- file hashes for every code file scanned
- per-section hashes for each spec/requirements document
- the set of scopes already covered by active invariants (so diff runs know what's settled)
- timestamp + TrueCourse version

On a `--diff` run, the framework computes the delta (new/changed/deleted code files, new/changed/deleted spec sections) and hands it to plugins in `DiscoverContext` alongside the full codebase (plugins may still need non-diff context to understand the change — e.g., a new route's guard usage depends on reading the entire guard module).

### Plugin contract

- Plugins don't have to implement incremental specially. The framework filters `DiscoverContext` so that pattern scans run against changed files only. For most plugins this is enough.
- Plugins that need to *combine* diff signals with full-repo context (e.g., cross-route-guard, which needs the whole route group to detect asymmetry) read `ctx.mode` and opt into the full scan within their own logic. The framework doesn't force a one-size shape.
- `checkAnchor` runs against *all* active invariants on every `suggest`, regardless of mode. Anchor-missing is cheap to check and the right time to surface it is whenever the team is reviewing.

### Drift re-evaluation

On a `--diff` run, active invariants are re-checked only if the diff touches their scope (their source files or their spec section). Untouched invariants stay in their current status. On a full run, every active invariant is re-evaluated.

### Spec incremental

Spec files get section-level hashing (by heading, with a fallback to paragraph-level chunks for docs without headings). Only changed sections pay the LLM-extraction cost. Unchanged sections reuse prior extractions.

### Checkpoint policy

`.truecourse/invariant-checkpoint.json` is **committed**. Team members share it, CI uses it, and branches merge it cleanly because it's a flat hash manifest (no ordering, no positional state). On conflict, either side is valid — the next `--diff` run reconciles against actual file state.

---

## Invariant lifecycle

1. **Candidate** — `discover` emits it. Not enforced. Sits in the review queue.
2. **Active** — human accepts. File written. Enforced on every subsequent analyze and diff-check.
3. **Stale** — later `discover` pass (full or `--diff`) finds spec or code has diverged from the declaration. Active status preserved (still enforced); review queue shows a one-line drift summary. Team edits and re-accepts, or retires. If the invariant's anchor is missing entirely (field deleted, route group empty, spec section removed — detected via the plugin's `checkAnchor`), the drift summary reads *"scope no longer exists; consider retiring"* — still Stale, not auto-retired.
4. **Retired** — human deletes the file (or uses `truecourse invariants retire <slug>`). Enforcement stops.

Rejected candidates persist signatures in `.truecourse/invariant-rejected.json` (committed). This prevents re-proposal across team members and machines.

---

## Initial plugin catalog

Six plugin types ship in the first release. **This is a starter set.** The catalog is expected to grow — new plugin types will be added as new classes of semantic correctness are identified. The framework treats plugins as an unbounded registry.

Each plugin's Discover description below calls out how it uses spec, code, or both.

### `state-machine`

Declared states and allowed transitions for a field, enum, or typed value.

- **Discover.** From **code**: enumerate enum types, union types, ORM enum fields; collect assignment sites and read surrounding guards (WHERE clauses, switch cases, `if` checks) to infer possible prior states. From **spec**: extract named lifecycle descriptions ("an order goes from placed → paid → shipped"). Merge signals; LLM sanity-filter distinguishes real state machines from ad-hoc enums (e.g., `user.role = 'admin' | 'user'` is not a state machine).
- **Declaration.** States, terminal states, allowed transitions, scope (the symbol or field being transitioned).
- **Enforce.** For every write to the declared field, compute allowed prior states from the surrounding guard. For each, check the `(prior, new)` transition exists in the declaration. Flag illegal transitions.

### `cross-route-guard`

A guard call shared by a group of related routes.

- **Discover.** From **code**: group routes by URL prefix and/or resource; build each route's entry-path call tree; identify "guard-shaped" calls (naming heuristics like `validate*|assert*|require*`, early-return shape, LLM tag). From **spec**: lines like "all X endpoints require Y validation" identify groups and guards directly.
- **Declaration.** Group selector, required guard call, exempt routes (explicit opt-outs).
- **Enforce.** For each route in the group, verify the guard call appears on the entry path before the main operation.

### `rest-contract`

REST API contract claims extracted from the spec, enforced against handlers, middleware, validators, and models. The spec-heaviest plugin and the catch-all for prose-stated REST obligations.

- **Discover.** From **spec**: LLM extracts every concrete REST obligation — status codes per endpoint, request/response body shapes, required request/response headers (auth, content-type, idempotency, Location, ETag, cache-control, rate-limit), query-param and path-param contracts, authentication/authorization requirements, pagination contracts, idempotency, error-envelope shape, accepted/produced content types, versioning, and entity field schemas. Each obligation gets a stable `obligationKey` (e.g. `POST /users status-201`, `* error-envelope`, `User.email`) so paraphrases of the same obligation collapse to one claim. Versioned against the spec file's content hash so spec edits invalidate stale extractions. From **code**: locate every site that constructs the obligated behavior — when an obligation must hold at N distinct sites (e.g. an api-gateway controller and a downstream handler both shape the same response), emit N claims with the same key and different anchors.
- **Declaration.** The extracted claim, its kind tag, the stable obligationKey, the code anchor, and a back-reference to the source spec section.
- **Enforce.** For each claim, compare against the anchored code site. The enforcement prompt's machinery guard distinguishes real implementation sites (handler with `res.status(...)`, middleware with `(req, res, next)`, ORM model with `@unique`, …) from lookalike files (stub classes, type declarations, constants files) so wrong-anchor situations don't flag false drift. LLM-backed in v1; deterministic comparison reserved for follow-up where the claim has a structured form (e.g. parsed from an OpenAPI document instead of prose).

### `ordering`

Declared sort order on a query or collection iteration.

- **Discover.** From **code**: find query builders with `orderBy` clauses inside iteration. From **spec**: claims like "results are always returned in chronological order" or "oldest first." LLM sanity-filter: is the outer caller claiming a global ordering over the full collection?
- **Declaration.** Target query or function, required sort order (fields + directions), scope (within-group vs. global-across-collection).
- **Enforce.** Synthesize a property-based test that exercises the declared ordering under concurrent and multi-scope scenarios. Run via the synthesis runtime (§ Property-test synthesis); language-routed via `detectLanguage`. Failures surface as violations with the runner's counterexample attached.

### `fairness`

Work-distribution guarantees on bounded loops and queues.

- **Discover.** From **code**: work-distribution loops where iteration is bounded by a cap that's not a terminating condition. From **spec**: claims like "no tenant can starve others" or "every candidate is eventually processed." LLM filter is critical — bounded loops are common and usually intentional. Conservative confidence threshold.
- **Declaration.** Target loop, fairness property.
- **Enforce.** Property-test synthesis (§ Property-test synthesis) populates candidates past the cap and asserts all eligible candidates are eventually processed. Highest-FP-risk plugin.

### `lease-gating`

Validation required before operating on a leased/locked/owned resource. May consult an active `state-machine` invariant to understand terminal vs. non-terminal lease states.

- **Discover.** From **code**: find fields representing leases, locks, or ownership (naming + shape heuristics: `expiresAt`, `ownerId`, `heldBy`); trace operations that consume the resource. From **spec**: claims like "session tokens expire after N minutes and must be revalidated."
- **Declaration.** Leased resource, operations requiring validation, the validation function.
- **Enforce.** For each declared operation, verify the validation call precedes the resource access.

---

## Future plugin candidates

Each existing plugin is the specialist for one class of contract or invariant. New contract surfaces ship as new plugins rather than being shoe-horned into existing ones. Candidates already on the radar:

### `graphql-schema`

GraphQL schema and resolver contract claims.

- **Discover.** From **spec** (or `.graphql` SDL files treated as a spec source): query/mutation/subscription signatures, field nullability, deprecated fields, scalar formats, error/result-union conventions. From **code**: resolver implementations, type definitions, schema-first or code-first builders.
- **Declaration.** Operation or type, the obligated property (return type, nullability, deprecation, required directive, error shape), anchor at the resolver / schema declaration site.
- **Enforce.** Compare resolver return shape and decorators against the schema obligation; flag drift when a resolver returns a shape incompatible with the SDL or skips a required directive.

### `grpc-proto`

gRPC and Protocol Buffers service contract claims.

- **Discover.** From `.proto` files (treated as the spec): service definitions, RPC method signatures, request/response message shapes, streaming patterns (unary / server-stream / client-stream / bidi), reserved field numbers, deprecated messages. From **code**: generated stubs and the hand-written server implementations that satisfy them.
- **Declaration.** Service method, message type, the obligated property (field number stability, streaming pattern, required field, deprecation), anchor at the server implementation.
- **Enforce.** Verify the server implementation matches the proto'd streaming pattern, returns the declared message shape, and doesn't repurpose reserved field numbers.

### `cli-contract`

CLI command surface claims.

- **Discover.** From **spec** (README / `--help` / man-page docs / a `commands.md`): command names, flags (long + short), required vs. optional args, exit codes per outcome, output format (stdout JSON vs. human text, stderr for errors). From **code**: argv parser registrations (commander, yargs, clap, click, cobra, …), exit calls, output writers.
- **Declaration.** Command path, the obligated property (flag presence, required arg, exit code on outcome, output stream), anchor at the parser registration or command handler.
- **Enforce.** Verify each documented flag is registered, every documented exit code has a corresponding code path, and output goes to the documented stream.

### Other candidates

- `openapi-contract` — same surface as `rest-contract` but driven by a structured OpenAPI/Swagger document instead of prose. Deterministic comparison where the document is precise; falls back to the prose-style flow where it isn't.
- `event-schema` — pub/sub message contracts (Kafka, NATS, RabbitMQ, EventBridge): topic name, schema version, required headers, retry/DLQ behavior.
- `webhook-contract` — outbound webhook contracts: payload shape, signing scheme, retry behavior, idempotency.
- `sql-migration` — invariants about migration safety (no destructive change without a backfill, no NOT NULL on a populated table without a default).

The list is open-ended — new plugin types are added as new classes of semantic correctness are identified. Each new plugin owns its specialty; the framework itself stays generic.

---

## Discovery UX

The review-queue pattern mirrors TrueCourse's existing ADR suggest flow (`docs/ADR_PLAN.md` § 19.1) — same shape, independently owned.

- **Manual trigger.** `truecourse invariants suggest` or a dashboard button. Never auto-runs on analyze.
- **Review queue.** Proposed invariants appear in an "Invariants" tab. Each draft shows plugin type, scope, declaration preview, provenance signal (which inputs contributed), one-line rationale, confidence score.
- **Per-draft actions.** Accept / edit / reject. Accept writes YAML; reject persists signature.
- **Drift display.** Active invariants that no longer match discovered patterns show a "stale" badge with a one-line diff against the latest discovery.
- **No-spec messaging.** When `suggest` runs and no spec source is found, the CLI / dashboard prints an explicit message — e.g. *"No spec source detected. Searched: SPEC.md, docs/SPEC.md, SPECIFICATION.md, PRD*.md, REQUIREMENTS.md, README.md. Plugins that depend on spec input (rest-contract, and partial signal for several others) will produce no candidates. Add a spec file or configure a source in `.truecourse/config.json`."* Never silent.
- **Noise control (non-negotiable from day one):**
  - Per-plugin confidence threshold (user can lower to see more)
  - Max drafts per run (hard cap per plugin)
  - Topic-signature dedupe for rejected drafts
  - LLM-disableable per plugin
  - Discovery runs only on explicit user action

The review experience must feel like code review, not a drafting app. Five minutes per invariant should be the typical authoring cost.

---

## Data model

### On-disk

- `.truecourse/invariants/<slug>.yaml` — one file per active invariant. **Committed.**
- `.truecourse/invariant-rejected.json` — signatures of rejected drafts. **Committed.**
- `.truecourse/invariant-checkpoint.json` — file hashes + spec section hashes + covered scopes from the last `suggest` run. Powers `--diff` mode. **Committed** (flat hash manifest; merges cleanly).
- `.truecourse/invariant-drafts/<draft-id>.json` — pending drafts awaiting review. Gitignored (transient, regenerated by `suggest`).

Atomic writes go through `atomicWriteJson` (existing pattern); invariant YAML files use the same tmp-then-rename approach.

### In-memory (server)

- `Invariant { id, type, pluginVersion, scope, declaration, provenance, sourceFile }`
- `InvariantDraft { id, type, pluginVersion, declaration, provenance, rationale, confidence }`
- Enforcement output: `Violation` (existing shape, `type: 'invariant'`, `invariantId: <slug>`)

### Plugin registry

- `packages/analyzer/src/plugins/index.ts` — exports the shipped plugin array
- Each plugin at `packages/analyzer/src/plugins/<type>/` with:
  - `index.ts` — the Plugin implementation
  - `schema.ts` — Zod schema for the declaration
  - `prompts/` if LLM-assisted
  - Synthesis adapters under `synthesis/` if the plugin uses property-test synthesis (see § Property-test synthesis)

Tests are centralized under `tests/plugins/<type>/` per the project convention (tests not co-located with source).

Third-party plugins are out of scope for v1. The architecture permits them in principle, but only first-party plugins ship.

---

## Naming rationale

Chose **Invariant** over Policy, Contract, Constraint, Property, Rule, Assertion, Guarantee.

- **Precision.** In CS, an invariant is literally "a property that must always hold." That's exactly what this is.
- **Product positioning.** "Policy" places the feature in the OPA / Sentinel / Kyverno space (authz, compliance) — a different category. "Invariant" positions alongside TypeScript, formal verification, property-based testing.
- **Composability.** "State-machine invariant," "ordering invariant," "lease invariant" all read naturally.
- **Differentiation from Rule.** "Rule" is already used for TrueCourse's existing rule catalog. Calling this "Rule" collides.

The **"dynamic rule"** framing is reserved for explanation, not naming. Users see the word Invariant in the product, CLI, and files; "think of them as dynamic rules" is a pedagogical aid in docs and onboarding.

Intimidation factor ("invariant sounds academic") is handled in UI copy — *"An invariant is a fact about your project that must always hold — e.g., an order can never leave the delivered state"* — not by softening the term.

Plugin `type` values use state-of-the-world nouns (`state-machine`, `cross-route-guard`, `ordering`, `lease-gating`) — invariants *are*; they don't *do*. The plugin does the enforcing.

---

## Design decisions

Resolved during design. Captured here as a paper trail; revisit if assumptions break.

1. **Plugin location.** `packages/analyzer/src/plugins/`. Plugins live alongside the analyzer, sharing the same package boundary as `packages/analyzer/src/patterns/` (existing rule definitions). No separate workspace package; no third-party plugin support in v1.

2. **Invariant file format.** YAML. Readable, comment-friendly. Schema validator produces actionable errors.

3. **LLM call routing.** Centralized via the existing core LLM provider (`packages/core/src/services/llm/`). Plugins declare prompts; the framework owns concurrency limits, provider rotation, and cost tracking. No per-plugin LLM clients.

4. **Invariant slug / filename.** Plugin-generated slug at draft time (e.g. `state-machine__order-status`), editable on accept. Filename = `<slug>.yaml`.

5. **Property-test synthesis runtime.** Sandbox subprocess (option (c)) — multi-language from day one. See § Property-test synthesis. Per-language adapters: fast-check for JS/TS, Hypothesis for Python. v1 ships TS/JS + Python; other languages added alongside their analyzer/LSP support.

6. **Enforcement cadence.** Both `analyze` and `analyze --diff`. Diff mode cites which invariants a change violates.

7. **Plugin versioning.** Per-plugin semver. One plugin's breaking schema change does not force migration of unrelated invariants.

8. **Spec source discovery.** v1 is **files only**. Convention: `SPEC.md` at repo root. Override: `.truecourse/config.json`. Fallback scan: `SPEC*.md`, `SPECIFICATION.md`, `docs/spec.md`, `PRD*.md`, `REQUIREMENTS.md`, `README.md` (last-resort). External connectors (Jira, Linear, Notion, Confluence) are **post-v1** — see § Spec sources.

9. **Cross-plugin invariant reads.** Yes, read-only. `DiscoverContext` carries `existingInvariants`. Plugins must tolerate absence gracefully (never require another plugin's invariants).

10. **No-spec behavior.** Discovery does not silently produce nothing. When no spec source is detected, `truecourse invariants suggest` prints an explicit message naming the paths searched and which plugins will produce no candidates as a result. See § Discovery UX.

11. **Adding plugin types post-ship.** Additive by construction. A new plugin type shipping in a later release produces discovery drafts on existing projects on next `suggest`; no migration needed for pre-existing invariants of other types.

12. **Anchor-check granularity.** Each plugin defines what "anchor missing" means. Framework provides the optional `checkAnchor` hook; plugins implement the semantics. Plugins without `checkAnchor` never surface anchor-missing drift (regular discovery-signal drift still fires).

13. **Checkpoint commit policy.** `.truecourse/invariant-checkpoint.json` is committed. Flat hash manifest (file path → hash, spec section → hash). Merge conflicts take either side; the next `--diff` run reconciles against real file state.

14. **Language detection.** Reuse the analyzer's existing `detectLanguage(filePath)` in `packages/analyzer/src/language-config.ts:291`. Plugins do not roll their own extension→language mapping. New languages added there propagate to plugins automatically.

---

## Implementation sequencing

Order by ROI (coverage breadth per unit of work) and technical risk (synthesis-heavy plugins ship later once the framework is battle-tested).

1. **Framework.** Plugin interface, invariant store, schema validator, draft persistence, spec ingestion (section-hashed, files-only), checkpoint + `--diff` mode wiring, review queue (stub UI). Extensions to the `Violation` schema (`type: 'invariant'`, `invariantId`). No plugins; proves the scaffolding.
2. **`rest-contract`.** Broadest applicability (any project with a spec). Validates the spec-extraction path end-to-end.
3. **`state-machine`.** Hardest static-analysis piece (guard inference, transition graph, WHERE-clause reading). Foundation for `lease-gating`.
4. **`cross-route-guard`.** Lightweight; leans on existing route-graph infrastructure.
5. **Synthesis runtime + `ordering`.** Introduces property-test synthesis (sandbox subprocess, fast-check + Hypothesis adapters, `~/.truecourse/runners/python/` lazy-install). Validates the multi-language path before `fairness` inherits it. Larger scope than a single plugin — synthesis runtime is shared infrastructure.
6. **`lease-gating`.** Small plugin; ships once `state-machine` is in place to be consulted.
7. **`fairness`.** Ships last — noisiest, highest FP risk; reuses the synthesis runtime from step 5.
8. **Per-plugin acceptance suite.** Fixture repos per plugin (TS/JS + Python where the plugin spans languages), CI gate for catch + no-false-positive assertions. Runs parallel to 2–7 so each plugin is validated on merge.

External spec connectors (Jira, Linear, etc.) are scheduled post-v1; not in this sequencing.

Each step gets its own IMPL doc when work starts.

---

## Test plan

The same fixture pair pattern that the analyzer's rule tests use applies here, extended with discovery and drift coverage. Tests live under `tests/`; fixture projects stay at `tests/fixtures/` (single source of truth, shared across analyze rules and invariant plugins).

### Fixture model

Two existing fixture projects per language:

- `tests/fixtures/sample-js-project-positive/` — clean code, follows the spec.
- `tests/fixtures/sample-js-project-negative/` — same spec, code has intentional bugs at known file:line locations.
- `tests/fixtures/sample-python-project-positive/` and `-negative/` — Python equivalents (carry the multi-language burden for `ordering`, `fairness`, and any plugin that exercises behavior across languages).

These fixtures are **extended in place** to support invariant testing:

- A single `SPEC.md` per fixture pair (positive and negative share the same spec). Covers every invariant type the framework ships with — order lifecycle (`state-machine`), result ordering (`ordering`), shared route guards (`cross-route-guard`), session leases (`lease-gating`), error-code/field-schema claims (`rest-contract`), bounded work loops (`fairness`).
- Code in the **positive** fixture follows the spec exactly. Code in the **negative** fixture follows the spec *except* for one or more intentional bug sites per plugin, at known file:line.
- **No pre-committed `.truecourse/invariants/`.** Invariants always come from discovery during the test run (LLM mocked at the centralized boundary). The committed fixture is spec + code only — invariants are an output, not an input.

### Per-plugin tests

For each plugin under `tests/plugins/<type>/`:

1. **`discover.test.ts`** — Run plugin's `discover()` against the positive fixture (spec + code aligned). Assert the produced drafts match the expected shape (states, transitions, route group, ordering claim, etc.) derived from the spec. Discovery is **spec-authoritative**: running the same plugin against the negative fixture must produce the **same** drafts (the buggy code must not contaminate discovery).
2. **`enforce.test.ts`** — Run discovery on each fixture, persist the drafts as active invariants in a temp directory, then run enforcement:
   - Negative fixture → expected violations at known file:line, with the right `invariantId` and `type: 'invariant'`.
   - Positive fixture → zero violations.
3. **`drift.test.ts`** — Discover invariants from a fixture; copy fixture to a temp dir; mutate the spec or code to diverge from the active invariant; re-run discovery; assert drift flagged with the right one-line summary; assert enforcement continues (still produces violations, doesn't silently skip).
4. **`anchor-missing.test.ts`** — Same pattern, but the mutation deletes the invariant's anchor entirely (field removed, route group emptied, spec section removed). Assert Stale with `"scope no longer exists; consider retiring"`. No auto-retire. No spurious violation.

### Cross-plugin tests

Cross-plugin scenarios (e.g. `lease-gating` consulting `state-machine`) live under `tests/plugins/lease-gating/cross-plugin.test.ts`. Three temp-copy variants of the shared fixture: cross-referenced invariant **present**, **absent**, **stale**. Plus one variant where a `--diff` run does not touch the state-machine's scope, asserting incremental narrows discovery — not enforcement (active declarations always loaded).

### Synthesis-runtime tests

For `ordering` and `fairness`, the synthesis subprocess runs live with seeded RNG:

- Generated test fails on the negative fixture's buggy code; passes on the positive fixture.
- Counterexample reproduces on re-run with the same seed.
- Runner provisioning: fast-check bundled (no install); Hypothesis lazy-installed into `~/.truecourse/runners/python/`. First-run install path covered.
- Failure modes: timeout respected, memory cap respected, missing language runtime produces a clear error (not a silent skip).
- Multi-language parity: the same `ordering` invariant running against the JS fixture and the Python fixture produces equivalent violations. Language auto-routed via `detectLanguage`; YAML `language:` override honored.

### Framework tests

Under `tests/invariant-framework/` — small, focused, no full fixture projects:

- **Store atomicity, schema validation, registry loading, version-mismatch handling.**
- **`Violation` schema extension round-trip** — invariant violations persist through `LATEST.json`, diff correctly (new / unchanged / resolved), render in the dashboard without special-casing.
- **Spec ingestion** — file detection by convention + override + fallback scan; section-hashing for `--diff`.
- **No-spec UX** — when no spec source is found, the explicit message fires; no silent failure.
- **Checkpoint round-trip** — write, re-read, mutate on disk, assert diff detection. Merge-conflict scenario: two branches update the checkpoint, assert next `--diff` reconciles to truth.
- **Incremental discovery equivalence** — full `suggest` and a matching `--diff` `suggest` produce the same final state. Mutate one file + one spec section, run `--diff`, assert only affected plugins re-scan, drafts for unchanged scopes not re-proposed.

### Determinism

- LLM is mocked at the centralized boundary (`packages/core/src/services/llm/`) using recorded responses (cassettes). Cassettes are regenerated when prompts change deliberately, with a clear refresh command.
- Synthesis RNG is seeded; counterexamples are reproducible by seed.
- Confidence-score assertions use bands (e.g. `confidence > 0.7`), never exact floats.

### Real-world battle test

Per the existing battle-test cycle: every plugin runs on at least 2–3 real codebases (TrueCourse itself + open-source repos) before merge. New false positives become additions to the negative fixture. Required gate per plugin, same standard as analyze rules.

---

## Scope — what this plan does not cover

- **Third-party plugin authoring.** Architecture permits it (registry is an array); not shipped in v1.
- **External spec connectors (Jira, Linear, Notion, Confluence, GitHub Issues).** v1 reads spec from files only. Connector model designed (§ Spec sources) and ships post-v1.
- **Synthesis languages beyond TS/JS + Python.** v1 ships those two adapters. C#, Java, Go, Rust adapters are added alongside their analyzer/LSP support, never before.
- **Runtime observability / dynamic tracing.** Distinct capability; tracked separately. Invariants are static-time and synthesized-test; they do not instrument running code.
- **Cross-repo invariant sharing.** Each repo owns its invariants. No sharing mechanism in v1.
- **Auto-accept of high-confidence drafts.** Explicit review always required. Auto-accept is a silent-drift failure mode, rejected categorically.
- **Invariant authoring UI for brand-new users.** Discovery-first flow assumes there's code or spec to read. Onboarding for empty repos is docs + hand-authored YAML; no UI wizard.

---

## Relationship to other TrueCourse concepts

Invariants are self-sustained. This section exists only to clarify how they interact with concepts a user might already know.

### vs. Static rules

Different shapes, both ship with TrueCourse, both produce `Violation`s into the same bucket.

| | Static rules | Invariants (dynamic rules) |
|---|---|---|
| Authored | In TrueCourse core | Per-project, generated by plugins |
| Inputs | Code patterns | Spec + code |
| Project context | None | Encoded in the declaration |
| Output | `Violation` | `Violation` (same bucket, `type: 'invariant'`) |

Filter by `Violation.type`: `type !== 'invariant'` = rule-sourced; `type === 'invariant'` = plugin-sourced.

### vs. ADRs

ADRs are **decision records**. Invariants are **enforcement facts**. An ADR may *reference* an invariant in its body — the same mechanism ADRs already use to reference graphs and flows:

| ADR references | Artifact | Role |
|---|---|---|
| Graphs | `.truecourse/graphs/*` (generated, gitignored) | Descriptive — what the system *is* |
| Flows | `.truecourse/flows/*` (generated, gitignored) | Descriptive — how the system *behaves* |
| Invariants | `.truecourse/invariants/*` (declared, committed) | Prescriptive — what the system *must* do |

ADRs that reference invariants should use a section header like `Enforced by:` rather than `See also:`, to reflect the contractual nature. Documentation convention, not a hard binding.

**Invariants do not require ADRs.** A project can use Invariants with zero ADRs. An ADR referencing an invariant adds narrative context; removing the ADR does not un-enforce the invariant. Removing the invariant file does.

### vs. Graphs and Flows

Graphs and flows are generated artifacts describing the current codebase. Invariants are declarations about what the codebase must always be. Different lifetime (generated every analyze vs. committed once), different purpose (describe vs. prescribe), different enforcement (none vs. every analyze). They may be referenced by the same ADR; that is their only point of contact.

---

## References

- `docs/INVARIANTS_PLAN.md` — validation-tied plan (preserved as the acceptance target against the original bug set).
- `docs/ADR_PLAN.md` — ADR architecture.
- `docs/PLAN.md` — master phase plan.
- `packages/shared/src/types/violations.ts` — the `Violation` schema that plugin enforcement extends.
- `packages/core/src/services/llm/` — the centralized LLM provider plugins use for discovery prompts.
- `packages/analyzer/src/language-config.ts` — `detectLanguage(filePath)` and `LANGUAGE_CONFIGS`. Plugins reuse this for extension→language mapping.
