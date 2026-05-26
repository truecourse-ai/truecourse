# ADR-002: Service communication

## Status

Accepted

## Context

Clients are first-party web and mobile apps that already ship a REST
client library.

## Decision

Expose a **REST** API. We reuse the existing REST client library across
all surfaces.

## Rejected alternatives

- **gRPC** — browser support requires an extra proxy hop.
- **GraphQL** — over-fetching is not a problem at our current scale.
