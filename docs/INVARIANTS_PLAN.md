# Invariants & Plugins — Design Plan

A self-sustained subsystem for catching semantic correctness bugs. Plugins (shipped with TrueCourse) discover, declare, and enforce Invariants (per-project facts about what must always hold).

## Context

TrueCourse today catches **structural** defects well — dead wiring, missing guards that sibling code paths share, type/shape mismatches. It does not catch **semantic** defects where the code is internally consistent but wrong relative to intent: illegal state-machine transitions, broken ordering guarantees, spec drift, fairness violations, domain-specific contract breaks.

The missing capability is a per-project layer of declared correctness that TrueCourse discovers automatically, the team confirms once, and the analyzer enforces on every run. Rules alone can't express this — they're patterns, not facts. What's needed is typed declarations of the invariants each project must uphold, and shipped code that knows how to discover and enforce each type.

**Validation set.** The 8 bugs from the Kilo "Opus 4.7 vs Kimi K2.6" workflow-orchestrator experiment (`https://blog.kilo.ai/p/we-gave-claude-opus-47-and-kimi-k26`). Current catch rate: 2/8 (K2 orphan wiring, K3 cross-route guard asymmetry). Target: 8/8 once Invariants ship. The remaining 6 all belong to bug classes TrueCourse structurally cannot reach today.

## Design principles

- **Invariants are a self-sustained subsystem.** They stand on their own. A project can adopt Invariants without using ADRs, Graphs, or any other TrueCourse concept. Plugins discover, declarations live in the repo, enforcement runs on every analyze. Full stop.
- **Three distinct concepts, no overlap.** **Rules** (static, shipped, fire on code patterns), **Plugins** (static, shipped, own one invariant type each), **Invariants** (per-project, declared, enforced). These are different kinds of things and stay that way.
- **Discovery before authoring.** Plugins propose candidates from the code itself. The team's job is reviewing drafts, not authoring invariants from scratch. Hand-authoring is supported as an escape hatch, not the primary flow.
- **Enforcement is deterministic where possible, LLM where necessary.** Plugin discover methods may use LLM sanity filters. Plugin enforce methods are deterministic by default — LLM is a fallback only for invariant types that defy static checking (e.g., prose-spec compliance).
- **Drift is a first-class signal.** Plugins re-run discovery on every analyze. An active invariant whose declaration no longer matches what the code looks like now is flagged as stale. Stale invariants are a signal, not a failure — they tell the team the declaration needs re-review.
- **Invariants are versioned, plugins have a schema.** Each invariant binds to a plugin version. Plugin schema changes require migrations, not silent breakage.
- **Authoring burden scales with project, not catalog.** A team commits tens of invariants once. The plugin catalog grows unbounded but is authored in TrueCourse core, not by users. Users never feel the plugin count.
- **Deterministic enforcement over noisy catches.** Better to miss a candidate than to flag a false positive on real code. Discovery FPs cost a review; enforcement FPs cost trust. We tune the former loose and the latter tight.

---

## Core concepts

### Invariant

A per-project fact that must always hold. Lives as a YAML file in `.truecourse/invariants/<slug>.yaml`. Committed to the repo. Binds to exactly one plugin via its `type:` field. The declaration is the canonical record — enforcement reads it literally.

Example (indicative):

```yaml
# .truecourse/invariants/step-status.yaml
type: state-machine
plugin-version: 1
scope: Step.status
states: [pending, running, waiting_retry, blocked, succeeded, failed]
terminal: [blocked, succeeded, failed]
transitions:
  - {from: pending,         to: running}
  - {from: running,          to: [succeeded, failed, waiting_retry]}
  - {from: waiting_retry,    to: running}
  - {from: [pending, running, waiting_retry], to: blocked}
provenance:
  source: discovered
  timestamp: 2026-04-22
  signal: "7 write sites across src/services/*.ts"
```

Invariants are reviewed like code. `.truecourse/invariants/` is **committed**, not gitignored — unlike `LATEST.json`, `history.json`, `graphs/`, `flows/`.

### Plugin

A shipped module owning one invariant *type*. Owns discovery, declaration schema, and enforcement for that type. No per-project state. Versioned alongside TrueCourse releases.

Interface:

```ts
interface Plugin<I extends Invariant> {
  readonly type: string;      // "state-machine", "ordering", etc.
  readonly version: number;
  readonly schema: JsonSchema; // validates declarations of this type

  discover(ctx: DiscoverContext): Promise<I[]>;
  enforce(invariant: I, ctx: EnforceContext): Promise<Finding[]>;

  migrate?(invariant: unknown, fromVersion: number): I;
}
```

`DiscoverContext` carries the parsed codebase, all currently-active invariants (so plugins can cross-reference — e.g., `lease-gating` may consult `state-machine`), and the rejected-signatures store.

`EnforceContext` carries the parsed codebase and a bounded LLM budget if the plugin opts in.

### Rule

A pattern-matching static check in TrueCourse's existing catalog. Fires directly on code; no per-project declaration required. The 958 existing rules remain rules — no refactor needed. Examples: "no unused exports," "orphan producer" (catches K2), "sibling routes should share guards" (catches K3).

**Rule vs. Plugin decision table:**

| Situation | Use |
|---|---|
| Pattern check with no project-specific context (shape, name, unused, orphan) | **Rule** |
| Correctness statement that varies per project (state machine, ordering guarantee, spec contract, guard-sharing group) | **Plugin** |

Rules compose by being enabled in config. Plugins compose by producing invariants whose enforcement is deterministic once declared.

---

## The three-phase process

Every invariant flows through three phases, regardless of plugin type:

### 1. Discover

The plugin scans the code and proposes candidate invariants. Signals come from static patterns (enum assignment sites, route groupings, call trees, query shapes) plus optional LLM sanity filters ("does this look like an intentional state machine, or just an ad-hoc enum?"). Output: drafts in the review queue, each with a confidence score and a one-line provenance signal.

Discovery also runs against already-accepted invariants. This does double duty:

- **Dedupe.** Plugins don't re-propose drafts for invariants already covered by an active declaration.
- **Drift detection.** An active invariant whose discovery signal no longer matches what the plugin sees in the code is flagged stale. The declaration stays active until the team decides; stale is a review-queue signal, not an enforcement bypass.

Discovery runs on explicit `truecourse invariants suggest` — never auto-runs on `analyze`. LLM calls cost time and money; drafts need explicit review.

### 2. Declare

The team reviews each draft — accept, edit, or reject. Accept writes a structured YAML file to `.truecourse/invariants/`. Reject persists the draft signature to `.truecourse/invariant-rejected.json` so discovery doesn't resurface it.

Declarations are structured (typed against the plugin's schema) and self-contained. Everything downstream reads from the declaration; prose context is optional commentary, never load-bearing.

Hand-authoring is equally supported — a team can write an invariant YAML file by hand and the enforce path treats it identically to a discovered-and-accepted one. Discovery is the ergonomic default; authoring parity means the substrate doesn't depend on the plugin getting discovery right.

### 3. Enforce

On every `truecourse analyze`:

1. Load active invariants from `.truecourse/invariants/*.yaml`. Validate each against its plugin's schema. Invariants bound to unknown plugin types or incompatible versions are skipped with a warning (not a failure).
2. For each invariant, call its plugin's `enforce` with the parsed codebase.
3. Collect findings. Merge with rule-based findings into the unified analyze output.

Enforcement is deterministic where possible. Some invariant types (e.g., `rest-contract` for prose-spec claims that resist structured extraction) fall back to LLM comparison — these declare `enforcement: llm` in their schema and are tuned conservatively.

**Diff-check integration.** `truecourse diff-check` also enforces invariants. A PR that introduces a violation cites the invariant in the output. Parallel to how diff-check already cites ADRs.

---

## Invariant lifecycle

1. **Candidate** — discover emits it. Not enforced. Sits in the review queue.
2. **Active** — human accepts. File written. Enforced on every subsequent analyze and diff-check.
3. **Stale** — later discover pass finds the code has diverged from the declaration. Active status preserved (still enforced); review queue shows a one-line drift summary. Team edits + re-accepts, or retires.
4. **Retired** — human deletes the file (or uses `truecourse invariants retire <slug>`). Enforcement stops. The retirement is committed like any file change.

Rejected candidates persist signatures in `.truecourse/invariant-rejected.json` (committed). This prevents re-proposal across team members and machines.

---

## Initial plugin catalog

Six plugins cover the Kilo validation set plus the natural extensions. Each plugin ships with a full spec in its own IMPL doc when work starts.

### P1 — `state-machine`

**Catches:** C1 (lease recovery regresses `blocked` state).

- **Discover.** Enumerate enum types, union types, Prisma `@enum`. For each, collect assignment sites and read surrounding guards (WHERE clauses, switch cases, `if` checks) to infer possible prior states at each write. Build the observed transition graph. LLM sanity-filter distinguishes real state machines from ad-hoc enums (`user.role = 'admin' | 'user'` is not a state machine).
- **Declaration.** States, terminal states, allowed transitions, scope (the symbol or field being transitioned).
- **Enforce.** For every write to the declared field, compute allowed prior states from the surrounding guard. For each, check the `(prior, new)` transition exists in the declaration. Flag illegal transitions. The classic C1 catch: an update with no status guard writing `waiting_retry` to a field that could currently be `blocked` — and `blocked → waiting_retry` is not in the transitions.

### P2 — `cross-route-guard`

**Catches:** K3 (expired-lease check missing on `/complete`, `/fail`). Reinforces rule-based K3 detection; plugin form because the group and guard identity are project-specific.

- **Discover.** Group routes by URL prefix and/or resource. Build each route's entry-path call tree. Identify "guard-shaped" calls (naming heuristics like `validate*|assert*|require*`, early-return shape, LLM tag). In each group, find guards used by ≥2 routes and missed by ≥1.
- **Declaration.** Group selector, required guard call, exempt routes (explicit opt-outs).
- **Enforce.** For each route in the group, verify the guard call appears on the entry path before the main operation.

### P3 — `rest-contract`

**Catches:** C3 (SSE cursor fallback), K4 (404 vs 409), K5 (Zod too restrictive). Widest impact plugin — three bugs from one source artifact.

- **Discover.** Read the project's prose spec (`SPEC.md`, `docs/SPEC.md`, or a configured path). LLM extracts structured claims: error-code table, field schemas, endpoint contracts, streaming/SSE semantics. Emit one invariant per extracted claim. Versioned against the spec file's content hash so spec edits invalidate stale extractions.
- **Declaration.** The extracted structured claim plus a back-reference to the source spec section.
- **Enforce.** For each claim, locate the corresponding code site (route handler, Zod schema, error thrower) and compare. Deterministic where the claim is structured (error codes, field types); LLM-backed where the claim is inherently prose (cursor fallback behavior).

### P4 — `ordering`

**Catches:** K1 (claim ordering not global across runs).

- **Discover.** Find query builders with `orderBy` clauses inside iteration. LLM sanity-filter: is the outer caller claiming a global ordering over the full collection? Surface candidates where README/comments/spec text asserts global ordering.
- **Declaration.** Target query or function, required sort order (fields + directions), scope (within-group vs global-across-collection).
- **Enforce.** Synthesize a property-based test that exercises the declared ordering under concurrent and multi-scope scenarios. Run via an embedded property runner (not the project's test runner). Failures surface as findings.

### P5 — `fairness`

**Catches:** C2 (bounded claim scan starves low-priority candidates).

- **Discover.** Work-distribution loops where iteration is bounded by a cap that's not a terminating condition (e.g., `take(maxClaims * 10)`). LLM filter is critical here — bounded loops are common and usually intentional. Conservative confidence threshold.
- **Declaration.** Target loop, fairness property ("every eligible candidate is eventually processed within N iterations under load M").
- **Enforce.** Property-test synthesis populates candidates past the cap and asserts all eligible candidates are eventually processed. Noisiest plugin; ships last.

### P6 — `lease-gating`

Reinforces K3 beyond the cross-route-guard plugin; unlocks future bugs in the same class (expired ownership tokens, stale lock holders, etc.).

- **Discover.** Find fields representing leases / locks / ownership (naming + shape heuristics: `expiresAt`, `ownerId`, `heldBy`). Trace operations that consume the leased resource. May consult an active `state-machine` invariant to understand terminal vs non-terminal lease states.
- **Declaration.** Leased resource, operations requiring validation, the validation function.
- **Enforce.** For each declared operation, verify the validation call precedes the resource access.

---

## Discovery UX

Parallels the existing ADR suggest flow (`docs/ADR_PLAN.md` § 19.1) because the review-queue pattern is proven; this is not an ADR dependency.

- **Manual trigger.** `truecourse invariants suggest` or a dashboard button. Never auto-runs on analyze.
- **Review queue.** Proposed invariants appear in an "Invariants" tab. Each draft shows plugin type, scope, declaration preview, provenance signal, one-line rationale, confidence score.
- **Per-draft actions.** Accept / edit / reject. Accept writes YAML; reject persists signature.
- **Drift display.** Active invariants that no longer match discovered patterns show a "stale" badge with a one-line diff against the latest discovery.
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
- `.truecourse/invariant-drafts/<draft-id>.json` — pending drafts awaiting review. Gitignored (transient, regenerated by `suggest`).

Atomic writes go through `atomicWriteJson` (existing pattern); invariant YAML files use the same tmp-then-rename approach.

### In-memory (server)

- `Invariant { id, type, pluginVersion, scope, declaration, provenance, sourceFile }`
- `InvariantDraft { id, type, pluginVersion, declaration, provenance, rationale, confidence }`
- `InvariantFinding { invariantId, site, severity, message, suggestedFix? }`

### Plugin registry

- `packages/plugins/src/index.ts` — exports the shipped plugin array
- Each plugin at `packages/plugins/src/<type>/` with:
  - `index.ts` — the Plugin implementation
  - `schema.ts` — Zod schema for the declaration
  - `prompts/` if LLM-assisted
  - Co-located tests per plugin

Third-party plugins are out of scope for v1. The architecture permits them (registry is an array), but we ship only first-party plugins.

---

## Naming rationale

Chose **Invariant** over Policy, Contract, Constraint, Property, Rule, Assertion, Guarantee.

- **Precision.** In CS, an invariant is literally "a property that must always hold." That's exactly what this is. "Policy" is strictly fuzzier (policies can be soft preferences).
- **Product positioning.** "Policy" places the feature in the OPA / Sentinel / Kyverno space (authz, compliance) — a different category with different buyers. "Invariant" positions alongside TypeScript, formal verification, property-based testing — where the value prop lives.
- **Composability.** "State-machine invariant," "ordering invariant," "lease invariant" all read naturally. "State-machine policy" fights the modifier.
- **Differentiation from Rule.** "Rule" is already used for our 958-rule catalog. Calling this "Rule" collides.

Intimidation factor ("invariant sounds academic") handled in UI copy — `"An invariant is a fact about your project that must always hold — e.g., a step can never leave the blocked state"` — not by softening the term.

Plugin type values use state-of-the-world nouns (`state-machine`, `shared-guard`, `ordering`, `lease-validation`) — invariants *are*; they don't *do*. The plugin does the enforcing.

---

## Validation: the 8 Kilo bugs

Explicit acceptance criterion. One fixture repo per bug, each reproducing the exact defect. TrueCourse must emit a specific finding for each. Fixture suite becomes a CI gate — any release that drops catches blocks.

| Bug | Mechanism | Plugin |
|-----|-----------|--------|
| C1  | State-machine invariant on `Step.status`, unguarded write flagged as illegal `blocked → waiting_retry` | P1 |
| C2  | Fairness invariant, property test surfaces starvation past the cap | P5 |
| C3  | Spec-code-drift: cursor semantics extracted from SPEC.md | P3 |
| K1  | Ordering invariant + property test under concurrent runs | P4 |
| K2  | Existing orphan-producer rule | (rule) |
| K3  | Existing cross-route-guard rule + P2 reinforcement | (rule + P2) |
| K4  | Spec-code-drift: error-code table from SPEC.md | P3 |
| K5  | Spec-code-drift: field schema from SPEC.md | P3 |

**Target: 8/8.** P3 alone closes 3 of 8. P1 closes the hardest (state-machine regression).

"Catch" means the right finding on the right file/symbol, not just *any* warning. Fixtures assert on finding ID + location.

---

## Open design questions

Decide before M1. Each has a preferred answer; none are locked.

1. **Plugin location.** `packages/plugins/` as a new workspace package, or `apps/server/src/plugins/` as server-internal? **Preferred: new package** — plugins are conceptually like rules (`packages/analyzer/src/patterns/`) and should share that shape. Makes room for third-party plugins without structural change later.

2. **Invariant file format.** YAML or JSON? **Preferred: YAML** — readable, comment-friendly, matches MADR precedent. Schema validator produces actionable errors.

3. **Where discovery LLM calls run.** Per-plugin LLM client, or centralized via the existing LLM provider (`apps/server/src/services/llm/`)? **Preferred: centralized** — reuse concurrency limits, provider rotation, cost tracking. Plugins declare prompts but don't own the spawn.

4. **Invariant naming.** User-assigned slug, plugin-generated slug, or both? **Preferred: plugin-generated slug at draft time** (e.g., `state-machine__step-status`), editable on accept. Filename = slug + `.yaml`.

5. **Property-test synthesis runtime.** P4 and P5 generate and run tests. Where? (a) in-process using a lightweight property runner (e.g., fast-check); (b) emit tests to the project's test dir and run via `pnpm test`; (c) sandbox subprocess. **Preferred: (a) for v1** — deterministic, no filesystem side effects, no coupling to project test runner. Upgrade to (b) if teams want persistent test artifacts.

6. **Enforcement cadence.** Only `analyze`, or also `diff-check`? **Preferred: both.** Diff-check cites which invariants a change violates.

7. **Plugin versioning policy.** Per-plugin semver or single version tied to TrueCourse releases? **Preferred: per-plugin semver.** A plugin's breaking schema change should not require users to migrate unrelated invariants.

8. **Prose-spec path (for P3).** Convention (`SPEC.md` at repo root) + override in `.truecourse/config.json`? **Preferred: yes**, plus fallback detection that searches for `SPEC*.md`, `SPECIFICATION.md`, `docs/spec.md`.

9. **Cross-plugin invariant reads.** Can plugins consult other plugins' invariants (e.g., `lease-gating` reading `state-machine`)? **Preferred: yes, read-only.** `DiscoverContext` already carries `existingInvariants`. Plugins must tolerate absence of cross-referenced invariants gracefully (never require them).

10. **Invariants without a project — e.g., new repo.** Discovery requires code to scan. For a near-empty repo, discovery produces nothing. Hand-authoring is the path; onboarding docs should make this clear. Not a blocker.

---

## Implementation sequencing

Order by ROI (catch-rate per unit of engineering work) and risk (P5 noisiest, ship last). Each milestone gets its own IMPL doc when work starts.

1. **M1 — Framework.** Plugin interface, invariant store, schema validator, draft persistence, review queue (stub UI). No plugins; proves the scaffolding.
2. **M2 — P3 `rest-contract`.** Widest impact (3 bugs). LLM-heavy but deterministic surface comparisons. Validates the LLM-assisted discovery path.
3. **M3 — P1 `state-machine`.** Hardest technical piece (guard inference, transition graph, WHERE-clause analysis). Closes the headline bug (C1).
4. **M4 — P2 `cross-route-guard`.** Lightweight; reinforces existing rule-based K3.
5. **M5 — P4 `ordering`.** Introduces property-test synthesis. Validates open question #5.
6. **M6 — P6 `lease-gating`.** Small plugin; ships once P1 provides the cross-plugin state-machine context it consults.
7. **M7 — P5 `fairness`.** Ship last — noisiest, highest FP risk, largest synthesis surface.
8. **M8 — Kilo fixture suite.** Eight fixture repos, CI gate, acceptance verification. Runs parallel to M2–M7 so each plugin is validated against its bug on merge, not at the end.

---

## Test plan (design-level)

- **Framework.** `tests/server/invariant-store.test.ts`, `tests/server/plugin-registry.test.ts` — schema validation, store atomicity, registry loading, version mismatch handling.
- **Per-plugin.** `tests/plugins/<type>/discover.test.ts`, `tests/plugins/<type>/enforce.test.ts` — mock LLM at spawn boundary, assert candidate shape and confidence, enforce findings on fixtures, hand-authored invariants enforced identically to discovered ones.
- **Fixture suite.** `tests/fixtures/kilo-bugs/<id>/` — one fixture per bug, reproducer code + expected finding ID + expected location.
- **Drift.** Fixture with matching invariant, mutated to diverge; assert drift flagged, no finding on correct code, enforcement continues.
- **Property-test synthesis (P4, P5).** Generated tests fail on buggy fixtures, pass on corrected fixtures, no flakes across N runs.
- **Cross-plugin composition.** Fixture where `lease-gating` consults `state-machine`; assert correct behavior when the state-machine invariant is present, absent, or stale.

---

## Scope — what this plan does not cover

- **Third-party plugin authoring.** Architecture permits it (registry is an array); not shipped in v1.
- **Runtime observability / dynamic tracing.** Distinct capability; tracked separately. Invariants are static-time + synthesized-test; they do not instrument running code.
- **Cross-repo invariant sharing.** Each repo owns its invariants. No sharing mechanism in v1.
- **Auto-accept of high-confidence drafts.** Explicit review always required. Auto-accept is a silent-drift failure mode we reject categorically.
- **Invariant authoring UI for brand-new users.** Discovery-first flow assumes there's code to scan. Onboarding for empty repos is docs + hand-authored YAML; no UI wizard.

---

## Relationship to other TrueCourse concepts

Invariants are self-sustained. This section exists only to clarify how they interact with concepts a user might already know.

### vs. Rules

Different shapes, both ship with TrueCourse, both produce findings. Rules fire on patterns; plugins enforce declarations. The 958 existing rules stay as rules — no refactor. New correctness checks choose their shape by the rule-vs-plugin decision table above.

### vs. ADRs

ADRs are **decision records**. Invariants are **enforcement facts**. An ADR may *reference* an invariant in its body — same mechanism ADRs already use to reference graphs and flows:

| ADR references | Artifact | Role |
|---|---|---|
| Graphs | `.truecourse/graphs/*` (generated, gitignored) | Descriptive — what the system *is* |
| Flows | `.truecourse/flows/*` (generated, gitignored) | Descriptive — how the system *behaves* |
| Invariants | `.truecourse/invariants/*` (declared, committed) | Prescriptive — what the system *must* do |

ADRs that reference invariants should use a section header like `Enforced by:` rather than `See also:`, to reflect the contractual nature of the reference. That's a documentation convention, not a hard binding.

**Invariants do not require ADRs.** A project can use Invariants with zero ADRs. An ADR referencing an invariant adds narrative context; removing the ADR does not un-enforce the invariant. Removing the invariant file does.

Phase 19.2 (ADR → Rule Codification in `docs/ADR_PLAN.md`) was an earlier attempt to turn ADR prose into static rules one-off. This design supersedes it: plugins provide typed, structured, multi-phase enforcement instead of per-ADR rule emission. 19.2 transitions to `SUPERSEDED_BY: INVARIANTS_PLAN.md`.

### vs. Graphs and Flows

Graphs and flows are generated artifacts describing the current codebase. Invariants are declarations about what the codebase must always be. Different lifetime (generated every analyze vs. committed once), different purpose (describe vs. prescribe), different enforcement (none vs. every analyze). They may be referenced by the same ADR; that's their only point of contact.

---

## References

- Kilo validation article: `https://blog.kilo.ai/p/we-gave-claude-opus-47-and-kimi-k26`
- `docs/ADR_PLAN.md` — ADR architecture. Phase 19.2 superseded by this doc.
- `docs/PLAN.md` — master phase plan.
