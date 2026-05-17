# IL DSL — grammar reference

File extension: `.tc`. One artifact per file. The first keyword on the
first non-comment line declares the artifact type.

Editor support: TrueCourse ships a VS Code TextMate grammar for `.tc`
that's installed silently on first `truecourse analyze`. See
`tools/cli/vscode-extension/`.

## Lexical

- **Comments**: `//` to end of line; `/* ... */` block.
- **Identifiers**: kebab-case or dot-separated (e.g. `paginated`,
  `Order.status`, `order.lifecycle.events`).
- **Strings**: double-quoted, e.g. `"POST /api/orders"`.
- **Numbers**: bare (`200`, `1`, `50`).
- **Lists**: `[a, b, c]` (allow trailing comma; allow newlines).
- **Ranges**: `1..50`, `100..113`.
- **References**: `<ArtifactType>:<identity>`. The identity portion is
  bare for kebab/snake/dot identifiers, quoted when it contains spaces
  or slashes:
  - `Entity:Order`
  - `StateMachine:Order.status`
  - `Effect:order.placed`
  - `Operation:"POST /api/orders"`
  - `Operation:"POST /api/orders/{id}/pay"`

## Top-level keywords (artifact types)

```
operation              entity              enum
state-machine          auth-requirement    error-envelope
pagination-contract    idempotency-contract
effect-group           unenforceable-obligation
authorization-rule     formula
```

## Common header

Every artifact starts with the keyword + identity, then a brace block.
The first line of the block is `origin <source> <section> <range>`.

```
operation POST "/api/orders" {
  origin SPEC.md "Operations — Orders / POST /api/orders" 100..113
  ...
}
```

## Selectors (unified grammar)

Single primitive on one line:

```
selector path-glob "/api/**"
selector tag paginated
selector method POST
selector operations [Operation:"POST /api/customers"]
```

Compound:

```
selector all-of {
  path-glob "/api/**"
  none-of {
    tag public
  }
}
```

Closed primitive set: `path-glob`, `path-regex`, `method`, `protocol`,
`tag`, `operations`. Composers: `all-of`, `any-of`, `none-of`, `not`.

## Conditions (typed discriminator)

```
response 201 on success { ... }
response 400 on validation_failure { ... }
response 404 on not_found { resource Entity:Order; ... }
response 409 on state_precondition_violated { machine StateMachine:Order.status; ... }
response 403 on auth_role_failed { required-role admin; ... }
```

Closed `kind` enum: `success`, `validation_failure`, `not_found`,
`conflict`, `state_precondition_violated`, `auth_required`,
`auth_role_failed`, `idempotency_replay`, `rate_limited`,
`internal_error`.

Per-kind discriminator fields appear inside the response block:
- `not_found` → `resource <EntityRef>`
- `state_precondition_violated` → `machine <StateMachineRef>`
- `auth_role_failed` → `required-role <name>`

## Inheritance

```
response 401 inherits AuthRequirement:auth.bearer.api
response 403 inherits AuthRequirement:auth.role.admin
```

## Field declarations (entities + body shapes)

Inline form (short):

```
field id: uuid origin server-assigned immutable
totalCents: integer >= 0
customerId: uuid references Entity:Customer
```

Block form (long):

```
field email: string {
  format email
  normalize lowercase
  unique
}
```

Type vocabulary:
- Primitives: `string`, `integer`, `number`, `boolean`, `object`, `array`
- Format sugar: `uuid`, `email`, `iso-8601` (each desugars to
  `string format <name>`)
- Union: `string|null`
- Reference-as-type: bare reference whose `<Type>` matches the target's
  declared kind. Use `Enum:OrderStatus` for an enum, `Entity:Order`
  for an entity. Field paths append after the identity
  (`Entity:Order.subtotalCents`) and resolve to the parent artifact;
  field-level validation is performed by the per-artifact lifter.

Modifiers as bare keywords: `required`, `optional`, `immutable`,
`mutable`, `unique`. Multi-word modifiers: `mutability state-machine`,
`mutability refreshed-on-mutation`, `origin server-assigned`,
`origin derived`.

Constraints chain after the type:
- `integer >= 0`
- `string constraint non-empty`
- `string format email`

## Lists / arrays / pages

```
items: array element Entity:Order
nextCursor: string|null semantics null-when-last-page
```

## Effects (inside operations)

```
effect emits Effect:order.placed
effect persist Entity:Order {
  writes {
    status = "placed"
    placedAt = now
    updatedAt = now
  }
}
effect state-transition StateMachine:Order.status to paid
```

## Forbids

```
forbid status 200 when resource-missing
forbid query-param offset
forbid emission when-response-status [4xx, 5xx]
```

## Tags

```
tags [paginated, idempotent]
```

## Business-rule artifacts

### `authorization-rule` — per-row authorization

Goes beyond bearer/role auth: enforces "which rows can the caller act
on" by relating the request's auth context to a loaded resource.

```
authorization-rule order.owner-only {
  origin SPEC.md "Business rules / Order ownership" 178..189

  applies-to {
    operations [Operation:"GET /api/orders/{id}", ...]
  }

  predicate "request.auth.userId == loaded.Order.customerId"

  except {
    role admin
  }

  on-violation {
    status 403
    error-code forbidden
    body ErrorEnvelope:error.envelope.standard
  }
}
```

`request` and `loaded` are well-known scopes the predicate may
reference. The verifier maps these to the runtime auth context and the
URL-resolved resource respectively.

### `formula` — derived field

A pure expression that computes one entity field from inputs.
Computed once at the declared lifecycle point (e.g. `order-creation`)
and immutable thereafter.

```
formula order.tax-cents {
  origin SPEC.md "Business rules / Pricing" 191..201

  output Entity:Order field taxCents

  inputs [
    Entity:Order.subtotalCents,
    Entity:Order.discountCents,
  ]

  expression "round((subtotalCents - discountCents) * 0.08)"

  computed-at order-creation
  immutable-after-creation

  depends-on Formula:order.discount-cents
}
```

Formulas chain via `depends-on`. The verifier checks (a) the
implementation reads exactly the declared `inputs`, (b) the
implementation writes exactly the declared `output`, and (c) the
expression matches the implementation's arithmetic.

Conditional formulas use a `when ... then ... else ...` block:

```
expression {
  when (customer.loyaltyTier == "gold") and (subtotalCents > 10000)
    then round(subtotalCents * 0.10)
  else 0
}
```

## Reserved keywords

`operation`, `entity`, `enum`, `state-machine`, `auth-requirement`,
`error-envelope`, `pagination-contract`, `idempotency-contract`,
`effect-group`, `unenforceable-obligation`, `authorization-rule`,
`formula`, `origin`, `request`, `response`, `body`, `header`,
`query`, `path-param`, `effect`, `emits`, `persist`,
`state-transition`, `forbid`, `inherits`, `selector`, `applies-to`,
`transitions`, `transition`, `states`, `initial`, `terminal`,
`field`, `tags`, `on`, `to`, `from`, `now`, `required`, `optional`,
`immutable`, `mutable`, `unique`, `one-of`, `any-of`, `all-of`,
`none-of`, `not`, `references`, `bound-to`, `format`, `normalize`,
`default`, `min`, `max`, `predicate`, `expression`, `inputs`,
`output`, `depends-on`, `computed-at`, `immutable-after-creation`,
`derived-by`, `applies`, `except`, `when`, `then`, `else`, `loaded`.
