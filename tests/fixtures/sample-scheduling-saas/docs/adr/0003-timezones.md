# ADR 0003 — Time zones

Status: accepted

## Decision

All appointment times are **stored in UTC** (`startsAt timestamptz`). Times are
**rendered in the provider's local time zone**, identified by an **IANA tz string**
(e.g. `America/New_York`) on the Provider record. The booking app additionally
records the `timezone` the customer saw, for display reconciliation only.

## Context

Providers and customers are often in different zones; storing UTC and converting
at the edges avoids DST bugs. We standardize on IANA names (never fixed offsets)
so DST transitions are handled by the tz database.
