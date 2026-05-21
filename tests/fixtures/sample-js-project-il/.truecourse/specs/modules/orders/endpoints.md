# Orders — Endpoints

## POST /api/orders

Create a new order.

**Request body:** `{ totalCents: integer, customerId: UUID }`

**Validation:** `totalCents ≥ 0`; `customerId` references an existing
Customer (otherwise `400` with `customer_not_found`).

**On success (201):**
- Body: the created `Order`.
- Header: `Location: /api/orders/{id}`.
- Effect: `order.placed` event emitted.
- Status set to `placed`; `placedAt` and `updatedAt` set to now.

## GET /api/orders

List orders (paginated).

**Query:** `cursor?`, `limit?`, `status?` (filter to one OrderStatus).

**On success (200):** paginated body shape (`{ items, nextCursor }`),
items are full `Order` records. Items returned in `placedAt`
descending order, globally across pages.

## GET /api/orders/:id

Fetch one order.

**Path param:** `id` must be UUID; otherwise `400`.

**On success (200):** the order.

**Not found (404):** error envelope, code `order_not_found`. Fetching
a missing order is never a silent no-op.

## POST /api/orders/:id/pay

Transition `placed → paid`. Otherwise `409` with `illegal_transition`.
Idempotent under `Idempotency-Key`. Effect: `order.paid`.

## POST /api/orders/:id/ship

Transition `paid → shipped`. Otherwise `409`. Effect: `order.shipped`.

## POST /api/orders/:id/cancel

Transition `placed → cancelled` or `paid → cancelled`. Otherwise `409`.
Effect: `order.cancelled`.
