# Orders — Effects

Successful mutations emit the following events to the bus:

- `order.placed` — on `POST /api/orders` 201.
- `order.paid` — on `POST /api/orders/:id/pay` 200.
- `order.shipped` — on `POST /api/orders/:id/ship` 200.
- `order.cancelled` — on `POST /api/orders/:id/cancel` 200.

Each payload carries the order's `id`, the new `status`, and the ISO
timestamp of the transition. **No event is emitted on failed
transitions or validation errors.**
