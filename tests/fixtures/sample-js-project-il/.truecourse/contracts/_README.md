# IL Artifacts — sample-js-project-il

Faithful encoding of `SPEC.md`. The implementation under `code/` drifts
from these artifacts in 14 places (each marked `// IL-DRIFT:`). When the
verifier is built, every drift below should produce exactly one violation
that matches the marker's obligation key.

**Format**: purpose-built DSL (`.tc` files — TrueCourse). Grammar
reference in `_GRAMMAR.md`. VS Code highlighting ships with the CLI
and is installed silently on first analyze.

## Layout

Organized by domain, not by artifact type — the natural unit teams
think about is "the orders feature" or "the customers feature", not
"all the entities" or "all the operations".

```
.truecourse/contracts/
├── _shared/                  cross-cutting contracts that span domains
│   ├── auth-bearer.tc        (AuthRequirement)
│   ├── role-admin.tc         (AuthRequirement)
│   ├── error-envelope.tc     (ErrorEnvelope)
│   ├── pagination.tc         (PaginationContract)
│   └── idempotency.tc        (IdempotencyContract)
├── orders/                   the orders domain — every artifact related to Orders
│   ├── order.tc              (Entity)
│   ├── order-status.tc       (Enum — the closed state set)
│   ├── lifecycle.tc          (StateMachine — the transitions)
│   ├── operations/           one file per HTTP endpoint
│   │   ├── post-orders.tc
│   │   ├── get-orders.tc
│   │   ├── get-orders-id.tc
│   │   ├── post-orders-pay.tc
│   │   ├── post-orders-ship.tc
│   │   └── post-orders-cancel.tc
│   ├── ownership.tc          (AuthorizationRule — per-row authz)
│   ├── pricing/              business-logic formulas
│   │   ├── discount.tc       (Formula)
│   │   ├── tax.tc            (Formula)
│   │   └── total.tc          (Formula)
│   └── events.tc             (EffectGroup — order lifecycle events)
├── customers/                the customers domain
│   ├── customer.tc           (Entity)
│   ├── loyalty-tier.tc       (Enum)
│   └── operations/
│       ├── post-customers.tc
│       ├── get-customers.tc
│       └── get-customers-id.tc
└── _unenforceable/           obligations the spec mentions but no IL captures
    ├── _README.md
    └── example-performance.tc
```

Filename never matters for the verifier — every artifact is matched
by its declared `identity`. Folders are organizational only, free to
restructure without touching cross-references.

## Conventions

- **One artifact per file.** Filename is descriptive; the keyword on
  the first line + the identity that follows it is what the verifier
  matches on.
- **Cross-references** use `<ArtifactType>:<canonical-identity>`
  (e.g. `Entity:Order`, `Operation:"POST /api/orders"`). Validated at
  load time — unresolved references are errors with suggestions.
- **Severity tiers** (precedence high to low):
  1. Per-predicate `forbid:` blocks (most local)
  2. Per-instance `refinement_override:` blocks
  3. Per-artifact-type defaults (in IL framework, not user YAML)
  4. Global defaults (in IL framework): extra → `low`, different → `critical`

## Locked design decisions (answers to the open questions)

### 1. Selectors: unified grammar

One `selector:` block with closed primitive set + boolean composition.
Primitives: `path_glob`, `path_regex`, `method`, `protocol`, `tag`,
`operations` (explicit list). Composers: `all_of`, `any_of`, `none_of`,
`not`.

```yaml
selector: { path_glob: "/api/**" }                     # simple
selector:                                              # compound
  all_of:
    - path_glob: "/api/**"
    - none_of: [{ tag: public }]
```

### 2. Conditions: typed discriminated union

`condition:` is an object with closed `kind` discriminator + per-kind
optional fields.

```yaml
"201": { condition: { kind: success } }
"400": { condition: { kind: validation_failure } }
"404": { condition: { kind: not_found, resource_ref: Entity:Order } }
"409":
  condition:
    kind: state_precondition_violated
    machine_ref: StateMachine:Order.status
"403": { condition: { kind: auth_role_failed, required_role: admin } }
```

Initial closed `kind` enum: `success`, `validation_failure`, `not_found`,
`conflict`, `state_precondition_violated`, `auth_required`,
`auth_role_failed`, `idempotency_replay`, `rate_limited`,
`internal_error`. Extensible only via versioned schema bump.

### 3. Refinement overrides: hybrid four-tier

Tiers 1-2 (global default + per-artifact-type default) live in IL
framework code, never in user YAML. Tier 3 (per-instance) and tier 4
(per-predicate `forbid:`) are what authors write.

State-machine `out_of_terminal: critical` is a tier-2 default — every
state machine inherits it without restating.

### 4. Cross-references: strings + load-time resolver

Format: `<ArtifactType>:<canonical-identity>`. Strict regex on parse.
Loader builds a `(type, identity) → artifact` index and resolves every
reference. Unresolved references become load errors with suggestions.
On-disk syntax stays human-readable; type-safety enforced at load.

### 5. Unenforceable slot: first-class artifact type

`UnenforceableObligation` is its own artifact, used by the LLM
extractor when a spec obligation has no encodable structural form.
Tracked, reviewable, never silently dropped or force-fit. See
`.truecourse/contracts/unenforceable/` for the demo.

## Catalog of planted drift

| #  | Marker (in code)                                                                  | IL artifact / obligation                                                          |
|----|-----------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| 1  | `Operation:POST /api/orders / response.201 → returns 200`                         | `Operation:POST /api/orders` — `response.201` missing                              |
| 2  | `Operation:POST /api/orders / response.201.headers.location missing`              | `Operation:POST /api/orders` — required header                                     |
| 3  | `Operation:GET /api/orders / response.200.body.shape: bare array`                 | `Operation:GET /api/orders` — response shape                                       |
| 4  | `Operation:GET /api/orders/{id} / response.404 → silent 200 + null body`          | `Operation:GET /api/orders/{id}` — forbidden behavior                              |
| 5  | `PaginationContract / forbidden-scheme: offset/page`                              | `PaginationContract:pagination.cursor.standard` — `forbids`                        |
| 6  | `PaginationContract / limit-not-clamped`                                          | `PaginationContract:pagination.cursor.standard` — `limit.max`                      |
| 7  | `StateMachine:Order.status / illegal-transition: shipped → cancelled`             | `StateMachine:Order.status` — transitions                                          |
| 8  | `StateMachine:Order.status / unguarded-terminal-regression`                       | `StateMachine:Order.status` — `refinement_override.out_of_terminal`                 |
| 9  | `Entity:Order / field.placedAt.mutability`                                        | `Entity:Order` — field constraint                                                  |
| 10 | `Entity:Customer / field.email.normalize`                                         | `Entity:Customer` — field normalization                                            |
| 11 | `AuthRequirement:auth.bearer.api / unprotected: POST /api/customers`              | `AuthRequirement:auth.bearer.api` — selector violation                             |
| 12 | `ErrorEnvelope:error.envelope.standard / shape: bare {message}`                   | `ErrorEnvelope:error.envelope.standard` — shape conformance                        |
| 13 | `Effect:order.cancelled / missing-emission`                                       | `EffectGroup:order.lifecycle.events` — emission missing                            |
| 14 | `Effect:order.placed / forbidden-emission-on-failure`                             | `EffectGroup:order.lifecycle.events` — `forbids`                                   |
| 15 | `AuthorizationRule:order.owner-only / missing-check on GET /api/orders/{id}`     | `AuthorizationRule:order.owner-only` — applies-to violated (IDOR)                  |
| 16 | `Formula:order.discount-cents / threshold off-by-one`                            | `Formula:order.discount-cents` — expression boundary (`>` vs `>=`)                  |
| 17 | `Formula:order.tax-cents / wrong-base`                                           | `Formula:order.tax-cents` — inputs declared but not honored                         |

## DSL conversion: complete

All artifact files moved from YAML to `.il` DSL form. The locked
syntax decisions (typed condition discriminator, unified selector
grammar, tier-2 default refinement overrides, string cross-references
with load-time resolution, `unenforceable-obligation` artifact type)
are baked into the grammar. See `_GRAMMAR.md`.

Parser implementation is the next step — it reads `.il` files into
typed IL artifact objects that the verifier consumes.
