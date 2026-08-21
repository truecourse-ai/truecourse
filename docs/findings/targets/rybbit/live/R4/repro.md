# R4 — `/api/track` acknowledges before the event is queryable

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:38 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701`, `CLUSTER_WORKERS=0` |
| rounds | 12, random phase |
| raw | `r4.log`, `r4.json`, `r4.stdout` |

## VERDICT: **still reproduces** — 12 of 12 immediate read-backs empty.

## Measured, this run

```
=== R4 SUMMARY over 12 rounds ===
ack -> queryable, sorted: 101, 256, 289, 347, 359, 434, 473, 571, 632, 723, 762, 926 ms
min 101 ms · median 454 ms · max 926 ms
12 of 12 immediate read-backs answered pageviews: 0
```

The hand-verification measured 30-972 ms, median 555 ms, 12/12 empty. Same distribution:
uniform across the queue's 1000 ms interval, as the mechanism predicts.

---

## Mechanism, re-read at `64f8c4fb`

`server/src/services/tracker/pageviewQueue.ts`:

```ts
const PAGEVIEW_BATCH_SIZE = 5000;
const PAGEVIEW_FLUSH_INTERVAL_MS = 1000;
```

used as `batchSize` and `interval` on the queue. `{"success":true}` means **queued**, not
stored. Nothing in `docs/content/docs/api/` or the tracking guides names a consistency
window.

## Method

Each round: a fresh site, a random 0-1000 ms delay to decorrelate the caller from the
queue's own fixed-phase interval timer, one `POST /api/track`, an immediate read, then a
25 ms poll of `GET /overview?past_minutes_start=5&past_minutes_end=0`.

Measuring at a fixed phase understates the window three-fold, because a fixed-phase
caller beats against the queue's fixed-phase timer — R3's phase-parked rounds on this
same instance clustered at 386-452 ms, where these random-phase rounds spread 101-926 ms.

## PROBE / CONTROL

The immediate read is the probe; the polled read that follows it is the control — same
request, same site, same event, only the clock differs.

```
round 1 site 21: POST /api/track -> 200 {"success":true} @T+0
   GET overview @T+25 ms -> 200 {"data":{"sessions":0,"pages_per_session":null,"bounce_rate":null,"session_duration":null,"pageviews":0,"users":0}}
   first non-zero read @T+571 ms

round 3 site 23: POST /api/track -> 200 {"success":true} @T+0
   GET overview @T+32 ms -> 200 {"data":{"sessions":0,…,"pageviews":0,"users":0}}
   first non-zero read @T+632 ms

round 12 site 32: POST /api/track -> 200 {"success":true} @T+0
   GET overview @T+28 ms -> 200 {"data":{"sessions":0,…,"pageviews":0,"users":0}}
   first non-zero read @T+473 ms
```

All twelve rounds are in `r4.log`; all twelve immediate reads (issued 23-32 ms after the
`200`) answered `pageviews: 0`.

## Change from the hand-verification

None material. Min moved 30 -> 101 ms and median 555 -> 454 ms, both inside run-to-run
noise on a 1000 ms interval; the 12/12 empty-immediate-read result is identical.
