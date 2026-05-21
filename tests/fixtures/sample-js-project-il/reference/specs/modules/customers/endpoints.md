# Customers — Endpoints

## POST /api/customers

Create a customer. **Admin only.**

**Request body:** `{ email: string, name: string }`

**Validation:**
- `email` must be syntactically valid.
- `name` must be non-empty.
- `email` must be unique; duplicate returns `409` with `email_taken`.

**On success (201):**
- Body: the created `Customer`. `email` stored lowercased.
- Header: `Location: /api/customers/{id}`.

## GET /api/customers

List customers (paginated). Same cursor pagination as orders.

**On success (200):** `{ items: Customer[], nextCursor: string | null }`.

## GET /api/customers/:id

Fetch one customer.

**On success (200):** the `Customer`.

**Not found (404):** standard error envelope with code `customer_not_found`.
