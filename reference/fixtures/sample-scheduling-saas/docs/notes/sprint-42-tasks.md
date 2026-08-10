# Sprint 42 — task board

_Working notes, not a spec. Updated daily in standup._

## In progress
- [ ] ALEX: flaky test in slots endpoint (retry logic) — almost done
- [ ] PRIYA: bump Postgres to 16 in staging
- [ ] SAM: investigate slow `/ops/appointments` query, add index?

## To do
- [ ] wire up the new error tracking DSN
- [ ] delete the old `/api/v0/*` shims after the mobile cutover
- [ ] schedule the load test for the booking flow

## Done
- [x] upgrade Node to 22
- [x] turn on the outbox relay in prod

## Parking lot
- maybe move the relay to its own service later
- ask design about the empty-slots state
