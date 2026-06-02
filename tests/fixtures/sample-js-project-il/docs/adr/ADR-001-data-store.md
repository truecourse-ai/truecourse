# ADR-001: Data store

## Status

Accepted

## Context

We need a relational store with strong consistency guarantees and
full-text search across orders and customers.

## Decision

We use **Postgres** as the system of record. Full-text search via
`tsvector` is relied on across all queries.

## Rejected alternatives

- **MongoDB** — no native multi-document transactions when this was decided.
- **MySQL** — weaker JSON and full-text story than Postgres.
