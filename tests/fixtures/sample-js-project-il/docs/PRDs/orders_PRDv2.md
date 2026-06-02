# Order Management Service — PRD v2

The current contract for the orders + customers service. Authoritative
across the surface; older docs (v1, README) are kept for history.

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
    "details": { ... }
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

## API versioning

The service exposes **API v2**. The version identifier `v2` is a stable
constant (`ApiVersion = "v2"`) surfaced in service metadata and response
headers.

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

### CustomerTier (enum)

Customer billing tier: `bronze | silver | gold | platinum`. `platinum` is
the top tier, reserved for the highest-volume accounts.

### LoyaltyTier (enum)

Customer loyalty status, distinct from billing tier:
`standard | silver | gold`. Stored on `Customer.loyaltyTier` (default
`standard`, mutable).

### ShippingCarrier (enum)

Carrier used for an outbound shipment: `ups | fedex | usps`.

### Loyalty tiers (lookup table)

A `loyalty_tiers` reference table backs loyalty lookups:

| Column      | Type    | Constraint                          |
|-------------|---------|-------------------------------------|
| `code`      | string  | one of `bronze`, `silver`, `gold`   |
| `name`      | string  | display name                        |
| `threshold` | integer | spend threshold, ≥ 0                |

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

### Status groupings

Two named groupings of `OrderStatus` are referenced by business rules:

- **Non-terminal statuses**: `placed`, `paid`, `shipped` — the statuses an
  order can still transition out of (`delivered` and `cancelled` are
  terminal and excluded).
- **Refundable statuses**: `paid`, `shipped` — only paid-or-shipped orders
  are refund-eligible. `placed`, `delivered`, and `cancelled` orders are
  never refundable.

---

## Operations — Orders

### POST /api/orders

Create a new order. **Idempotent under `Idempotency-Key`** — a repeat request
with the same key returns the original response.

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

### Discount tiers

The loyalty discount percentage is configured per tier as a fixed map,
`DiscountTiers`:

| Tier   | Discount |
|--------|----------|
| bronze | 5%       |
| silver | 10%      |
| gold   | 20%      |

This map is a stable business constant and must match the configured
`DiscountTiers` values exactly.

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

### Retry budget

Event emission to the bus is retried on transient failure. The retry
budget is a fixed constant `MAX_RETRY`, set to **3** attempts.

---

## Data access rules

These constraints govern how the data layer queries the database. They
hold for every query against the named table, independent of endpoint.

- **Tenant scoping (orders)** — every query against the `orders` table must
  filter by tenant: `orders.tenantId = <current tenant>`. A query missing
  this predicate leaks cross-tenant data.
- **Date scoping (orders)** — any date-range filter on orders must bind to
  the `orders.placedAt` column (never `updatedAt`).
- **Soft delete (orders)** — orders are hard-deleted; there is no
  `deletedAt` soft-delete column. Order queries must not include a
  `deletedAt IS NULL` predicate.
- **Status allowlist (customers)** — customer-list queries must restrict
  `customers.status` to the allowed set `["active", "pending"]`.
- **Loyalty tiers** — queries against the `loyalty_tiers` table must
  restrict `code` to `["bronze", "silver", "gold"]`.

## Production hardening

The following must never appear in the shipped codebase:

- No file under `src/legacy/**` — the legacy uploader is out of scope.
- No `PROD_DEBUG` environment variable — debug env-vars are forbidden in
  production.
- No dependency on the `request` HTTP-client package — migrate to native
  `fetch`.
- No `FEATURE_EXPORT_V2` feature flag in any config — the export feature is
  GA-gated and the flag must not appear.

---

## Out of Scope

<!-- PLANTED NEGATIVE-SPEC: B.9 should extract these as outOfScope on
     the orders module manifest, not as planned operations. -->

The following endpoints are explicitly excluded from V2 and must not
ship without a follow-up PRD:

- `POST /api/orders/:id/replace` — replacement order flow
- `POST /api/orders/:id/refund` — money-back flow
- `GET /api/orders/:id/export` — per-order data export
