# Sample Order Service

Order management API. RESTful service over Express + Postgres.

<!-- PLANTED-CONFLICT vs PRDv2: README still mentions session cookies; PRDv2 specifies JWT -->

Authentication uses session cookies issued at login. All `/api/*` endpoints
require a valid session.

See `docs/PRDs/backend_PRDv2.md` for the current spec.
