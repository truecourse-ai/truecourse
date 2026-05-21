# Orders — Effects

Successful mutations emit events to the event bus:

- `order.placed` — emitted on `POST /api/orders` `201`.
- `order.paid` — emitted on `POST /api/orders/:id/pay` `200`.
- `order.shipped` — emitted on `POST /api/orders/:id/ship` `200`.
- `order.cancelled` — emitted on `POST /api/orders/:id/cancel` `200`.

Each event payload carries: `id` (UUID), `status` (the new OrderStatus), `at` (ISO 8601 timestamp).

**No event is emitted on failed transitions or validation errors.**
