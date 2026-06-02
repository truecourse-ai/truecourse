# Errors

## Error envelope

Every `4xx` and `5xx` response across the entire API surface uses one envelope:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": { ... }
  }
}
```

`code` is a stable machine identifier. `message` is a human-readable string safe to
display. `details` is optional and varies per code.

Known error codes: `validation_failed`, `unauthenticated`, `forbidden`,
`order_not_found`, `customer_not_found`, `illegal_transition`, `email_taken`.
