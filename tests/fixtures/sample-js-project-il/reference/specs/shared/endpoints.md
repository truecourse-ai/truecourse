# Cross-cutting endpoint rules

## Pagination

Every list endpoint uses cursor-based pagination:

- Query param `cursor` — opaque string, omitted on the first page.
- Query param `limit` — integer 1–50, default 20. Values above 50 are clamped to 50.
- Response shape: `{ items: T[], nextCursor: string | null }`.
- `nextCursor: null` signals the last page.

Offset- and page-number-based pagination is forbidden across the entire API surface.

## Idempotency

Mutating endpoints that accept an `Idempotency-Key` header must short-circuit on a
repeat key — returning the original response without re-running side effects.
