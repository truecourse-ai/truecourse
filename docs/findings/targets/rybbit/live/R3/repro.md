# R3 — a date-range window's strict `<` against whole-second `now()` hides the current second

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:38 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701` |
| rounds | **10** (the brief asks for at least 8) |
| raw | `r3.log`, `r3.json`, `r3.stdout` |

## VERDICT: **still reproduces**, and it is deterministic, not a flake.

## Measured, this run

| | |
|---|---|
| **ratio** | **10 of 10 rounds divergent** |
| **gap range** | **533-601 ms** (min 533, max 601, all ten gaps: 601, 556, 588, 575, 577, 586, 533, 571, 576, 582) |

The hand-verification measured 7 of 8 with gaps up to 934 ms. This run is *more*
consistent (no negative-control round landed) but with a smaller ceiling, because on
this host the pageview queue happened to flush at ~390-450 ms after the ack rather than
the ~80-290 ms the earlier run saw; the divergent interval is
`(next second boundary) - (flush time)`, so a later flush leaves less of the second to
hide in. The mechanism and the direction are identical.

---

## Mechanism, re-read at `64f8c4fb`

`server/src/api/analytics/utils/timeWindow.ts`, `whereClause`, `case "date"`:

```ts
    case "date": {
      const { startDate, endDate, timeZone } = window;
      const tz = SqlString.escape(timeZone);
      return `AND ${column} >= toTimeZone(
      toStartOfDay(toDateTime(${SqlString.escape(startDate)}, ${tz})),
      'UTC'
      )
      AND ${column} < if(
        toDate(${SqlString.escape(endDate)}) = toDate(now(), ${tz}),
        toTimeZone(now(), 'UTC'),
        …
      )`;
    }
```

Four lines below, `case "pastMinutes"` is INCLUSIVE:

```ts
    case "pastMinutes":
      return `AND ${column} > toDateTime(${SqlString.escape(window.start)}, 'UTC') AND ${column} <= toDateTime(${SqlString.escape(window.end)}, 'UTC')`;
```

Both sides are whole seconds (`events.timestamp` is `DateTime`; ClickHouse `now()` is
too), so the two windows disagree about the current second by construction, in one
`switch`, four lines apart.

---

## Method

Each round: a fresh site; park ~30 ms after a wall-clock second boundary so the event is
stamped EARLY in its second; one `POST /api/track`; then poll BOTH windows in parallel
every 40 ms from the moment of the ack, recording when each first returns the session.

## PROBE / CONTROL

The two windows are each other's control: same event, same site, same instant, one
query parameter apart.

```
round 1 site 11: ack=200 {"success":true} (6 ms, stamped +31 ms into its second) | past_minutes visible at 386 ms | date_range visible at 987 ms | gap 601 ms
  DIVERGENT at +386 ms:
    GET /api/sites/11/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"s5AnnRUCdC4fD4","user_id":"2c7259e51a82",…}]}
    GET /api/sites/11/sessions?start_date=2026-08-21&end_date=2026-08-21&time_zone=UTC
      -> 200 {"data":[]}

round 2 site 12: ack=200 {"success":true} (27 ms, stamped +31 ms into its second) | past_minutes visible at 438 ms | date_range visible at 994 ms | gap 556 ms
  DIVERGENT at +438 ms:
    GET /api/sites/12/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"vh0-FkmO1ZRjKT","user_id":"d1b50d067820",…}]}
    GET /api/sites/12/sessions?start_date=2026-08-21&end_date=2026-08-21&time_zone=UTC
      -> 200 {"data":[]}
```

## Full board

| round | site | stamped at +ms into its second | past_minutes visible | date_range visible | gap |
|---:|---:|---:|---:|---:|---:|
| 1 | 11 | 31 | 386 ms | 987 ms | **601 ms** |
| 2 | 12 | 31 | 438 ms | 994 ms | **556 ms** |
| 3 | 13 | 32 | 452 ms | 1040 ms | **588 ms** |
| 4 | 14 | 32 | 439 ms | 1014 ms | **575 ms** |
| 5 | 15 | 32 | 410 ms | 987 ms | **577 ms** |
| 6 | 16 | 32 | 420 ms | 1006 ms | **586 ms** |
| 7 | 17 | 31 | 448 ms | 981 ms | **533 ms** |
| 8 | 18 | 30 | 446 ms | 1017 ms | **571 ms** |
| 9 | 19 | 30 | 428 ms | 1004 ms | **576 ms** |
| 10 | 20 | 32 | 388 ms | 970 ms | **582 ms** |

Every round had a real interval in which realtime held the session and the date-range
surface returned `{"data":[]}`. Note the `date_range visible` column: it is pinned at
970-1040 ms in all ten rounds, i.e. at the next second boundary, which is the strict
bound moving, not the data arriving. The data arrived at the `past_minutes` time.

## Change from the hand-verification

Ratio moved from 7/8 to **10/10**; gap ceiling moved from 934 ms down to 601 ms, for the
flush-phase reason above. Nothing about the mechanism, the surfaces or the verdict
changed.
