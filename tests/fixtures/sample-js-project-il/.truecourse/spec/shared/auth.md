# Authentication

All endpoints under `/api/*` require an `Authorization: Bearer <token>`
header. Requests without a valid token return `401` with the standard
error envelope. Auth is enforced uniformly — there are no exceptions.

A small subset of endpoints additionally require an `admin` role,
encoded in the token payload. Role failures return `403` with code
`forbidden`.
