# Orders — Data shapes

## Order

| Field          | Type           | Constraint                                              |
|----------------|----------------|---------------------------------------------------------|
| `id`           | UUID           | server-assigned, never client-supplied                  |
| `status`       | OrderStatus    | enum, see lifecycle                                     |
| `totalCents`   | integer        | ≥ 0; immutable after creation                           |
| `customerId`   | UUID           | references an existing Customer; immutable              |
| `placedAt`     | ISO timestamp  | server-assigned at creation, immutable                  |
| `updatedAt`    | ISO timestamp  | server-assigned, refreshed on every mutation            |

## OrderStatus (enum)

`placed | paid | shipped | delivered | cancelled`

## Order lifecycle

Every order moves through the lifecycle below. Once an order reaches
a terminal state (`delivered` or `cancelled`), it does not move
again — no recovery, no retry, no override.

- **Initial:** every newly created order begins in `placed`.
- **Terminal:** `delivered` and `cancelled`.
- **Allowed transitions:**
  - `placed → paid`
  - `placed → cancelled`
  - `paid → shipped`
  - `paid → cancelled`
  - `shipped → delivered`

Any other transition is illegal.

## Pricing

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

## Order ownership

A customer can only fetch or transition orders they own — i.e. an
order's `customerId` must equal the authenticated caller's `userId`.
Applies to:

- `GET /api/orders/:id`
- `POST /api/orders/:id/pay`
- `POST /api/orders/:id/ship`
- `POST /api/orders/:id/cancel`

Violations return `403` with code `forbidden`. **Admins bypass** —
the `admin` role can act on any order.
