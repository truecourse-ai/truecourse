# Order Management Service — Specification

A two-resource HTTP service (Orders + Customers) used as a fixture for the
Intent IL verifier. The implementation under `code/` deliberately drifts
from this spec in fourteen places, each marked with `// IL-DRIFT:`. The IL
artifacts under `.truecourse/contracts/` encode the spec faithfully — they are what the
verifier compares the code against.

---

## Authentication

All endpoints under `/api/*` require an `Authorization: Bearer <token>`
header. Requests without a valid token return `401` with the standard
error envelope. Auth is enforced uniformly — there are no exceptions.

A small subset of endpoints additionally require an `admin` role,
encoded in the token payload. Role failures return `403` with code
`forbidden`.

## Error envelope

Every 4xx and 5xx response — across the entire surface — uses one envelope:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": { ... }   // optional, shape depends on the code
  }
}
```

`code` is a stable machine identifier (e.g. `validation_failed`,
`unauthenticated`, `forbidden`, `order_not_found`). `message` is a
human-readable sentence safe to show. `details` is optional, varies per
code.

## Pagination

Every list endpoint paginates via cursor:

- Query param `cursor` — opaque string, omitted on first page.
- Query param `limit` — integer 1..50, default 20. Values above 50 are
  clamped to 50, not rejected.
- Response shape: `{ items: T[], nextCursor: string | null }`.
- `nextCursor: null` indicates the last page.

Offset / page-number pagination is forbidden across the entire surface.

## Idempotency

Mutating endpoints that accept an `Idempotency-Key` header must
short-circuit on a repeat request — return the original response without
re-running side effects.

---

## Entities

### Order

| Field          | Type           | Constraint                                              |
|----------------|----------------|---------------------------------------------------------|
| `id`           | UUID           | server-assigned, never client-supplied                  |
| `status`       | OrderStatus    | enum, see lifecycle below                               |
| `totalCents`   | integer        | ≥ 0; immutable after creation                           |
| `customerId`   | UUID           | references an existing Customer; immutable              |
| `placedAt`     | ISO timestamp  | server-assigned at creation, immutable                  |
| `updatedAt`    | ISO timestamp  | server-assigned, refreshed on every mutation            |

### OrderStatus (enum)

`placed | paid | shipped | delivered | cancelled`

### Customer

| Field          | Type           | Constraint                                              |
|----------------|----------------|---------------------------------------------------------|
| `id`           | UUID           | server-assigned                                         |
| `email`        | string         | valid email; lowercased on write; unique                |
| `name`         | string         | non-empty                                               |
| `createdAt`    | ISO timestamp  | server-assigned, immutable                              |

## Order lifecycle

Every order moves through the lifecycle below. Once an order reaches a
terminal state (`delivered` or `cancelled`), it does not move again — no
recovery, no retry, no override.

- **Initial**: every newly created order begins in `placed`.
- **Terminal**: `delivered` and `cancelled`.
- **Allowed transitions**:
  - `placed → paid`
  - `placed → cancelled`
  - `paid → shipped`
  - `paid → cancelled`
  - `shipped → delivered`

Any other transition is illegal.

---

## Operations — Orders

### POST /api/orders

Create a new order.

- **Request body**: `{ totalCents: integer, customerId: UUID }`.
- **Validation**: `totalCents ≥ 0`; `customerId` references an existing
  Customer (otherwise `400` with `customer_not_found`).
- **On success (201)**:
  - Body: the created `Order`.
  - Header: `Location: /api/orders/{id}`.
  - Effect: `order.placed` event emitted.
  - Status set to `placed`; `placedAt` and `updatedAt` set to now.

### GET /api/orders

List orders (paginated).

- **Query**: `cursor?`, `limit?`, `status?` (filter to one OrderStatus).
- **On success (200)**: paginated body shape, items are full `Order`
  records.
- Items returned in `placedAt` descending order, globally across pages.

### GET /api/orders/:id

Fetch one order.

- **Path param**: `id` must be UUID; otherwise `400`.
- **On success (200)**: the order.
- **Not found (404)**: error envelope, code `order_not_found`. Fetching
  a missing order is never a silent no-op.

### POST /api/orders/:id/pay

Transition `placed → paid`. Otherwise `409` with `illegal_transition`.
Idempotent under `Idempotency-Key`. Effect: `order.paid`.

### POST /api/orders/:id/ship

Transition `paid → shipped`. Otherwise `409`. Effect: `order.shipped`.

### POST /api/orders/:id/cancel

Transition `placed → cancelled` or `paid → cancelled`. Otherwise `409`.
Effect: `order.cancelled`.

---

## Operations — Customers

### POST /api/customers

Create a customer. **Admin only.**

- **Request body**: `{ email: string, name: string }`.
- **Validation**: email syntactically valid; name non-empty; email
  unique (otherwise `409` with `email_taken`).
- **On success (201)**: the created `Customer`. Header
  `Location: /api/customers/{id}`. `email` is stored lowercased.

### GET /api/customers

List customers (paginated). Same pagination contract as Orders.

### GET /api/customers/:id

Fetch one customer. `404` with `customer_not_found` when missing.

---

## Business rules

### Order ownership

A customer can only fetch or transition orders they own — i.e. an
order's `customerId` must equal the authenticated caller's `userId`.
This applies to:

- `GET /api/orders/:id`
- `POST /api/orders/:id/pay`
- `POST /api/orders/:id/ship`
- `POST /api/orders/:id/cancel`

Violations return `403` with code `forbidden`. **Admins bypass** —
the `admin` role can act on any order.

`POST /api/orders` and `GET /api/orders` are not subject to this rule
(creation is for the caller; list endpoints already filter to caller).

### Pricing

Every order carries three computed money fields in addition to the
client-supplied `subtotalCents`:

- `discountCents` — `10%` of `subtotalCents` when the order's customer
  has `loyaltyTier == 'gold'` AND `subtotalCents > 10000`. Zero
  otherwise.
- `taxCents` — `8%` of `(subtotalCents - discountCents)`, rounded to
  the nearest integer cent.
- `totalCents` — `subtotalCents - discountCents + taxCents`.

These fields are server-computed at order creation and must not be
client-supplied. They are immutable after creation.

---

## Effects

Successful mutations emit the following events to the bus:

- `order.placed` — on `POST /api/orders` 201.
- `order.paid` — on `POST /api/orders/:id/pay` 200.
- `order.shipped` — on `POST /api/orders/:id/ship` 200.
- `order.cancelled` — on `POST /api/orders/:id/cancel` 200.

Each payload carries the order's `id`, the new `status`, and the ISO
timestamp of the transition. **No event is emitted on failed transitions
or validation errors.**
