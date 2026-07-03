# ADR 0003 — Time zones

- **Status:** accepted (2024-02-05)
- **Deciders:** Platform, Booking

## Context

Providers and their customers are frequently in different time zones, and
appointment times cross daylight-saving transitions. We need three things to be
unambiguous: what instant an appointment actually starts, how it's displayed to each
party, and how time-window math (the 48-hour cancellation window, ordering,
reminders) is computed. Storing wall-clock local time makes all three ambiguous
around DST.

## Decision

All appointment times are **stored in UTC** (`startsAt timestamptz`). Times are
**rendered in the provider's local time zone**, identified by an **IANA tz string**
(e.g. `America/New_York`) on the Provider record. The booking app additionally
records the `timezone` the customer saw, for display reconciliation only.

## Alternatives considered

- **Store local wall-clock time plus an offset.** Rejected: the offset is only valid
  at one instant; DST transitions make "3:00 AM" ambiguous or nonexistent, and the
  window math breaks around the change.
- **Store fixed UTC offsets (e.g. `-05:00`) instead of IANA names.** Rejected: an
  offset can't know when DST starts or ends, so any date more than a few months out
  can render an hour wrong.
- **Store everything in provider-local time and convert on write.** Rejected: pushes
  the ambiguity to write time and makes cross-zone comparisons (a customer in another
  zone) error-prone.

## Consequences

- **(+)** DST is handled by the tz database, not our code; there is one canonical
  instant per appointment, and all window/ordering math is unambiguous in UTC.
- **(+)** Rendering is a pure presentation concern at the edges.
- **(−)** Every display path must convert UTC → the right IANA zone; forgetting to
  convert shows raw UTC.
- **(−)** All services depend on an up-to-date tz database (zoneinfo); a stale
  zoneinfo across deploys can render times inconsistently.
- **(−)** The customer-seen `timezone` is **display metadata only** and must never
  feed the 48-hour window or any comparison — an easy footgun to guard against in
  code review.
