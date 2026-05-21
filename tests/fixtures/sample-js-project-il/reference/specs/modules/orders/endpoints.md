# Orders — Endpoints

## POST /api/orders

Create a new order.

**Request body:** `{ subtotalCents: integer, customerId: UUID }`

**Validation:**
- `subtotalCents` must be `>= 0`.
- `customerId` must reference an existing Customer; otherwise `400` with `customer_not_found`.

**On success (201):**
- Body: the created `Order` (includes all computed pricing fields).
- Header: `Location: /api/orders/{id}`.
- Effect: `order.placed` event emitted.
- `status` set to `placed`; `placedAt` and `updatedAt` set to now.
- `discountCents`, `taxCents`, `totalCents` computed server-side.

**On validation failure (400):** standard error envelope.

## GET /api/orders

List orders (paginated).

**Query parameters:** `cursor?`, `limit?`, `status?` (filter to one `OrderStatus` value).

**On success (200):** `{ items: Order[], nextCursor: string | null }`.
Items returned in `placedAt` descending order, globally across pages.

## GET /api/orders/:id

Fetch one order.

**Path parameter:** `id` must be a valid UUID; otherwise `400` with `validation_failed`.

**On success (200):** the `Order`.

**Not found (404):** standard error envelope with code `order_not_found`. A missing
order is never returned as a silent null or empty response.

## POST /api/orders/:id/pay

Transition `placed → paid`.

**On success (200):** the updated `Order`. Effect: `order.paid` emitted.

**Illegal transition (409):** standard error envelope with code `illegal_transition`.

Idempotent under `Idempotency-Key`.

## POST /api/orders/:id/ship

Transition `paid → shipped`.

**On success (200):** the updated `Order`. Effect: `order.shipped` emitted.

**Illegal transition (409):** standard error envelope with code `illegal_transition`.

## POST /api/orders/:id/cancel

Transition `placed → cancelled` or `paid → cancelled`.

**On success (200):** the updated `Order`. Effect: `order.cancelled` emitted.

**Illegal transition (409):** standard error envelope with code `illegal_transition`.
