# ADR-002: Service communication

## Status

Accepted

## Decision

Expose a **REST** API (ASP.NET Core). We reuse the existing REST client library
across all surfaces.

## Rejected alternatives

- **gRPC** — browser support requires an extra proxy hop.
- **GraphQL** — over-fetching is not a problem at our current scale.
