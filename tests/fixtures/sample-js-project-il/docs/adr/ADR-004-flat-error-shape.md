# ADR-004: Flat error response shape

## Status

Accepted

## Context

Clients complained that the nested error object is verbose and awkward to parse
for simple failures. We want the smallest possible error body.

## Decision

**All 4xx and 5xx responses use a FLAT error shape** — a single top-level
`message` string and nothing else:

```json
{ "message": "string" }
```

There is **no** nested `error` object, **no** `code` field, and **no** `details`
field. For trivial client errors a **bare string body** (just the message text,
not even JSON) is also acceptable.

## Rationale

- Smaller payloads and simpler client handling.
- A machine-readable `code` is unnecessary — clients switch on the HTTP status.
