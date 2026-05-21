# Customers — Endpoints

## POST /api/customers

Create a customer. **Admin only.**

**Request body:** `{ email: string, name: string }`

**Validation:** email syntactically valid; name non-empty; email
unique (otherwise `409` with `email_taken`).

**On success (201):** the created `Customer`. Header
`Location: /api/customers/{id}`. `email` is stored lowercased.

## GET /api/customers

List customers (paginated). Same pagination contract as Orders
(`cursor`, `limit`, `{ items, nextCursor }`).

## GET /api/customers/:id

Fetch one customer. `404` with `customer_not_found` when missing.
