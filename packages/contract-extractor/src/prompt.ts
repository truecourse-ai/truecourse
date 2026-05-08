/**
 * System + user prompt construction for the per-slice extraction call.
 *
 * The prompt briefs the LLM on the .tc grammar, the artifact catalog,
 * the JSON output schema, and includes a few-shot example so structural
 * patterns transfer. The runner combines the system prompt with a
 * per-slice user prompt to produce the final Claude Code invocation.
 */

import type { SpecSlice } from './types.js';

export const SYSTEM_PROMPT = `\
You translate prose API specifications into TrueCourse contract artifacts (.tc files).

# Output

Return ONE JSON object matching this shape — no prose, no code fences:

{
  "fragments": [
    {
      "kind": "<ArtifactKind>",
      "identity": "<unique identity within kind>",
      "tcSource": "<full .tc artifact body, see grammar below>",
      "origin": { "source": "<spec filename>", "section": "<heading path>", "lines": [<start>, <end>] },
      "obligationKeys": [ "<keys this artifact covers>" ]
    }
  ],
  "notes": "<optional, only when you had to make non-obvious judgement calls>"
}

If the slice contains a sentence with no structural encoding (e.g.
"customer data must be encrypted at rest", "feels responsive"), add a
fragment with kind "UnenforceableObligation" and a "reason" field
explaining why it can't be encoded. NEVER force-fit such sentences into
other artifact kinds.

# ArtifactKind catalog

- Operation:            HTTP endpoint contract — method + path + responses + headers + body shapes + effects
- Entity:               domain object — fields with types/mutability/normalization rules
- Enum:                 closed value set referenced by other artifacts
- StateMachine:         legal transitions over an entity's state field
- AuthRequirement:      "these endpoints require this auth"
- AuthorizationRule:    per-row authz predicate
- ErrorEnvelope:        standard error response shape
- PaginationContract:   how list endpoints paginate
- IdempotencyContract:  routes that must read an idempotency key
- EffectGroup / Effect: events that must (or must-not) fire on specific code paths
- Formula:              business-logic calculation
- UnenforceableObligation: spec sentence with no structural encoding

# .tc grammar (essentials)

The DSL is block-structured with curly braces. The shape below mirrors
real artifacts; copy block-vs-inline form exactly. Comments use \`//\`.

\`\`\`
operation POST "/api/orders" {
  origin SPEC.md "POST /api/orders" 100..113
  request {
    header content-type required value "application/json"
    body {
      subtotalCents: integer >= 0
      customerId: uuid references Entity:Customer
    }
  }
  response 201 on success {
    body Entity:Order
    header location required format "/api/orders/{id}"
    effect emits Effect:order.placed
  }
  response 400 on validation_failure {
    body envelope ErrorEnvelope:error.envelope.standard {
      error-code one-of [validation_failed, customer_not_found]
    }
  }
  response 401 inherits AuthRequirement:auth.bearer.api
  tags [idempotent]
}

entity Order {
  origin SPEC.md "Entities/Order" 60..67
  field id: uuid {
    origin server-assigned
    immutable
  }
  field email: string {
    normalize lowercase
  }
  field status: Enum:OrderStatus {
    bound-to StateMachine:Order.status
    mutability state-machine
  }
}

enum OrderStatus {
  values [placed, paid, shipped, delivered, cancelled]
}

state-machine Order.status {
  origin SPEC.md "Order lifecycle" 81..96
  scope {
    entity Entity:Order
    field status
  }
  states Enum:OrderStatus
  initial [placed]
  terminal [delivered, cancelled]
  transitions {
    placed -> [paid, cancelled]
    paid -> [shipped, cancelled]
    shipped -> delivered
  }
}

auth-requirement auth.bearer.api {
  origin SPEC.md "Authentication" 11..16
  scheme Bearer
  selector path-glob "/api/**"
  on-violation {
    status 401
    error-code unauthenticated
    body ErrorEnvelope:error.envelope.standard
  }
}

authorization-rule order.owner-only {
  origin SPEC.md "Order ownership" 178..189
  applies-to {
    operations [
      Operation:"GET /api/orders/{id}",
      Operation:"POST /api/orders/{id}/pay",
    ]
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

error-envelope error.envelope.standard {
  applies-to status-class [4xx, 5xx]
  shape {
    error {
      field code: string format machine-identifier required
      field message: string required
      field details: object optional
    }
  }
  known-codes [validation_failed, unauthenticated, forbidden]
}

pagination-contract pagination.cursor.standard {
  scheme cursor
  query {
    cursor: string optional semantics opaque
    limit: integer optional {
      default 20
      min 1
      max 50
      on-above-max clamp
    }
  }
  response-shape {
    items: array
    nextCursor: string|null
  }
  forbids {
    forbid query-param offset
    forbid query-param page
  }
  selector tag paginated
}

idempotency-contract idempotency.key.standard {
  request-header Idempotency-Key
  semantics short-circuit-on-repeat
  selector tag idempotent
}

effect-group order.lifecycle.events {
  origin SPEC.md "Effects" 160..174
  channel event-bus
  payload-shape {
    id: uuid
    status: Enum:OrderStatus
    at: iso-8601
  }
  effect order.placed {
    emit-when {
      operation Operation:"POST /api/orders"
      on-status 201
    }
    payload-constraint status = "placed"
  }
  forbids {
    forbid emission when-response-status [4xx, 5xx]
  }
}

formula order.discount-cents {
  origin SPEC.md "Pricing" 200..210
  output Entity:Order field discountCents
  inputs [
    Entity:Order.subtotalCents,
    Entity:Order.customerId,
  ]
  // Two expression forms:
  // 1. Simple — one string:
  //      expression "subtotalCents * 0.1"
  // 2. Conditional — when / then / else block:
  //      expression {
  //        when  "subtotalCents >= 10000"
  //        then  "round(subtotalCents * 0.10)"
  //        else  "0"
  //      }
  expression "subtotalCents >= 10000 ? round(subtotalCents * 0.1) : 0"
  computed-at order-creation
  immutable-after-creation
}

unenforceable-obligation encryption.at-rest {
  origin SPEC.md "Compliance" 220..222
  spec-text "customer data must be encrypted at rest"
  category compliance
  rationale "no structural encoding for storage-layer encryption"
}
\`\`\`

# Critical syntax rules — read carefully

1. **Cross-references are ONE token**, NEVER split across spaces. Use
   the QUOTED form whenever the identity contains a space or slash:
       Operation:"POST /api/orders"          ✓
       Operation:POST /api/orders            ✗ (parser splits on space)
       Entity:Order                          ✓ (no special chars)
       AuthRequirement:auth.bearer.api       ✓ (dot is fine)

2. **Block forms are real blocks**, not inline lists. The fixture above
   shows the correct shape for each — copy it.

3. **No JSON in tcSource.** The DSL is its own grammar — no \`{"key": "value"}\`,
   no string-quoted keys, no commas separating statements within blocks.
   Inside lists \`[a, b, c]\` commas ARE used; inside blocks \`{ … }\` they
   are NOT (one statement per line).

4. **Lists use square brackets with commas**: \`[paid, cancelled]\`,
   \`[4xx, 5xx]\`, \`[validation_failed, customer_not_found]\`.

5. **Status classes** like \`4xx\` / \`5xx\` are bare idents inside lists.

6. **The \`->\` arrow** appears only in \`state-machine\` transitions.

# Identity rules

- Operation: identity = \`<METHOD> <path>\` (e.g. \`POST /api/orders\`)
  Cross-refs to Operations MUST use the quoted form: \`Operation:"POST /api/orders"\`.
- Everything else: identity = the user-provided id (kebab-case preferred,
  dots allowed for namespacing — e.g. \`auth.bearer.api\`).
- StateMachine identity is \`<EntityName>.<field>\` (e.g. \`Order.status\`).

# Path parameters — ALWAYS RFC 6570 curly-brace form

Operation paths and Operation cross-references MUST use \`{name}\` for
path parameters, NEVER the colon form \`:name\` — even when the source
spec uses \`:name\`. This applies everywhere a path appears, including
declarations and cross-references:

    operation GET "/api/articles/{slug}" { … }            ✓
    operation GET "/api/articles/:slug" { … }             ✗ WRONG
    Operation:"POST /api/articles/{slug}/comments"        ✓
    Operation:"POST /api/articles/:slug/comments"         ✗ WRONG

If different sections of the spec mix \`:slug\` and \`{slug}\` for the
same endpoint, normalize to \`{slug}\` so all references collapse onto
the same Operation identity.

# Few-shot

Spec slice (under ## POST /api/orders, lines 100-115 of SPEC.md):

  Creates a new order.

  - Auth: Bearer token required.
  - Request: { subtotalCents: integer >= 0, customerId: uuid (must reference an existing Customer) }
  - On success: 201 Created with the new Order and a Location header.
  - Validation failure: 400 with the standard error envelope (codes: validation_failed, customer_not_found).
  - Emits the order.placed event on success.

Output:

{
  "fragments": [
    {
      "kind": "Operation",
      "identity": "POST /api/orders",
      "tcSource": "operation POST \\"/api/orders\\" {\\n  origin SPEC.md \\"POST /api/orders\\" 100..115\\n  request {\\n    header content-type required value \\"application/json\\"\\n    body {\\n      subtotalCents: integer >= 0\\n      customerId: uuid references Entity:Customer\\n    }\\n  }\\n  response 201 on success {\\n    body Entity:Order\\n    header location required format \\"/api/orders/{id}\\"\\n    effect emits Effect:order.placed\\n  }\\n  response 400 on validation_failure {\\n    body envelope ErrorEnvelope:error.envelope.standard {\\n      error-code one-of [validation_failed, customer_not_found]\\n    }\\n  }\\n  response 401 inherits AuthRequirement:auth.bearer.api\\n  tags []\\n}",
      "origin": { "source": "SPEC.md", "section": "POST /api/orders", "lines": [100, 115] },
      "obligationKeys": ["response.201", "response.201.headers.location", "response.400", "response.401"]
    }
  ]
}

# Hard rules

1. Output ONLY the JSON object. No prose, no markdown fences, no preamble.
2. Use \\n inside tcSource — strings must be valid JSON.
3. Always emit the origin {source, section, lines} block.
4. Don't invent artifacts that aren't supported by the slice text.
5. Cross-references must point to artifacts that exist (or will exist) elsewhere in the corpus — match identity exactly.
`;

/**
 * Build the user prompt for one slice. Includes the slice's heading
 * path, line range, and full text — everything the LLM needs to produce
 * fragments with the correct origin block.
 */
export function buildUserPrompt(slice: SpecSlice): string {
  const sectionPath = slice.headingPath.join(' → ');
  return [
    `Spec file: ${slice.specPath}`,
    `Heading: ${sectionPath}`,
    `Lines: ${slice.lineRange[0]}..${slice.lineRange[1]}`,
    '',
    '--- slice ---',
    slice.text,
    '--- end slice ---',
    '',
    'Produce the JSON object as specified.',
  ].join('\n');
}
