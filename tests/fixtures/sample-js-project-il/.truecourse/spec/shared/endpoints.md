# Cross-cutting endpoint rules

## Pagination

Every list endpoint paginates via cursor:

- Query param `cursor` — opaque string, omitted on first page.
- Query param `limit` — integer 1..50, default 20. Values above 50
  are clamped to 50, not rejected.
- Response shape: `{ items: T[], nextCursor: string | null }`.
- `nextCursor: null` indicates the last page.

Offset / page-number pagination is forbidden across the entire
surface.

## Idempotency

Mutating endpoints that accept an `Idempotency-Key` header must
short-circuit on a repeat request — return the original response
without re-running side effects.
