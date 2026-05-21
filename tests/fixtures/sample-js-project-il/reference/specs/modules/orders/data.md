# Orders — Data

## Order

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | server-assigned, immutable |
| `status` | OrderStatus | see lifecycle |
| `subtotalCents` | integer | `>= 0`; client-supplied; immutable after creation |
| `discountCents` | integer | server-computed; immutable after creation |
| `taxCents` | integer | server-computed; immutable after creation |
| `totalCents` | integer | server-computed; immutable after creation |
| `customerId` | UUID | references an existing Customer; immutable |
| `placedAt` | ISO 8601 | server-assigned at creation; immutable |
| `updatedAt` | ISO 8601 | server-assigned; refreshed on every mutation |

## OrderStatus

`placed | paid | shipped | delivered | cancelled`

## Order lifecycle

- **Initial state:** `placed`.
- **Terminal states:** `delivered`, `cancelled`. Once reached, no recovery.
- **Allowed transitions:**
  - `placed → paid`
  - `placed → cancelled`
  - `paid → shipped`
  - `paid → cancelled`
  - `shipped → delivered`

Any other transition is illegal and returns `409` with `illegal_transition`.

## Pricing

Three money fields are server-computed at order creation and immutable after that:

- `discountCents` — `10%` of `subtotalCents` when the customer's `loyaltyTier` is `gold`
  AND `subtotalCents > 10000`. Zero otherwise.
- `taxCents` — `8%` of `(subtotalCents - discountCents)`, rounded to the nearest cent.
- `totalCents` — `subtotalCents - discountCents + taxCents`.

## Order ownership

Non-admin callers may only read or transition orders they own
(`Order.customerId == caller.userId`). Applies to:

- `GET /api/orders/:id`
- `POST /api/orders/:id/pay`
- `POST /api/orders/:id/ship`
- `POST /api/orders/:id/cancel`

Violations return `403` with code `forbidden`. The `admin` role bypasses this rule.
