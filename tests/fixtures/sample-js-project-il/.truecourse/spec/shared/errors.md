# Errors

## Error envelope

Every 4xx and 5xx response — across the entire surface — uses one
envelope:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": { ... }
  }
}
```

`code` is a stable machine identifier (e.g. `validation_failed`,
`unauthenticated`, `forbidden`, `order_not_found`,
`illegal_transition`). `message` is a human-readable sentence safe to
show. `details` is optional, varies per code.
