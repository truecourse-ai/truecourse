# ADR 0002 — Error response envelope

Status: accepted

All non-2xx responses use the standard error envelope:

```json
{ "error": { "code": "string", "message": "string" } }
```

`code` is a stable machine-readable token (e.g. `VALIDATION_FAILED`).
`message` is a human-readable description.
