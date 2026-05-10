# ADR 0002 — Error response envelope

Status: accepted

All non-2xx responses use the standard error envelope:

```json
{ "error": { "code": "string", "message": "string" } }
```

`code` is a stable machine-readable token (e.g. `validation_failed`,
`order_not_found`, `illegal_transition`). `message` is a human-readable
description.

## Decision

Single envelope across the surface. No bare-string error responses, no
flat `{message: "..."}` shapes — those break the standard client.
