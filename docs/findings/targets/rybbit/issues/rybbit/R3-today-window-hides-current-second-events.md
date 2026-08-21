---
finding: R3
target: rybbit-io/rybbit
route: public issue
title: "A date-range window's upper bound is a strict < against whole-second now(), so a just-flushed event is visible to realtime and invisible to every date-range surface until the next second ticks"
labels: "none. rybbit-io/rybbit applies no labels: both issue templates declare `labels: ''` and all 40 most recent issues carry an empty label array. No suggested-labels line is included, deliberately."
status: filed
filed_url: https://github.com/rybbit-io/rybbit/issues/1134
filed_at: 2026-08-21
reverified: "2026-08-20 live re-run against a docker compose stack built from master @ 64f8c4fb7f394bdfe9379717de8e6c21758b1ac2, 10 rounds, all 10 divergent, both windows polled in parallel every 40 ms from the moment of the track ack; evidence in docs/findings/targets/rybbit/live/R3/repro.md and live/R3/r3.log"
format_note: "bug_report.md is a classic Markdown template, not a YAML form, and no template-enforcing workflow exists on this repo. Body matches its bold-label section shape verbatim and in template order: **Describe the bug**, **To Reproduce**, **Expected behavior**, **Screenshots**, **Desktop (please complete the following information):**. No suggested-labels line, since this repo applies none. The recently merged past-minutes navigation change is referred to by commit sha and in plain words rather than hash-number syntax, and is explicitly ruled out as a fix."
---

# A date-range window's upper bound is a strict < against whole-second now(), so a just-flushed event is visible to realtime and invisible to every date-range surface until the next second ticks

**Describe the bug**

The analytics time window has one `switch` with two branches that disagree about the present. The date branch bounds the range with a strict `<` against `now()`; the relative branch, four lines below, is inclusive. Both sides are whole seconds, because `events.timestamp` is a ClickHouse `DateTime` and ClickHouse's `now()` is one too.

So an event stamped at second N is **excluded from a Today window for the remainder of second N**, while the realtime surface, which uses the relative branch, already shows it. Realtime says a visitor is on the site; the dashboard on the same screen says there is nothing to show. Both are querying the same row.

**This is deterministic, not a flake, and it is worth being precise about that**, because the natural reading of "a race between two queries" is that it is rare and unreproducible. It is neither. The trigger is simply that the event lands early in its wall-clock second: the strict bound then has the whole remainder of that second in which to hide the row.

Measured on a fresh build of `master`, parking each track call about 30 ms after a second boundary and polling both windows in parallel every 40 ms:

```
10 of 10 rounds divergent
gap range 533-601 ms  (601, 556, 588, 575, 577, 586, 533, 571, 576, 582)
past_minutes first returned the session at   386-452 ms after the ack
date_range   first returned the session at   970-1040 ms after the ack
```

Look at those two columns rather than the gap. `past_minutes` varies with when the ingest queue happened to flush, which is the data actually arriving. `date_range` is pinned at 970 to 1040 ms in all ten rounds, which is not the data arriving at all: it is the next second boundary, the strict bound moving past a row that had been sitting there for half a second.

The visible consequence is a dashboard that contradicts itself for up to a second at a time, and, for anyone tracking an event and then immediately reading a date-range surface (an integration test, a setup wizard, a "verify your installation" step, a scripted import), a surface that answers empty for a write it has already acknowledged.

#### What the docs promise

`docs/content/docs/api/getting-started.mdx:147` presents the three time forms as alternative ways of naming a window, not as windows with different semantics:

> All endpoints require date-based, exact datetime, or relative time parameters:

And the same page is explicit about exclusivity exactly once, at `:176`, for `end_datetime`:

> Exact UTC end timestamp for the query period. **This boundary is exclusive.**

`end_date` at `:157-158` carries no such note:

> End date for the query period

A reader is therefore told that one of the three forms has an exclusive upper bound, and reasonably concludes the others do not. In practice the date form has one too, and its exclusive point is not the end of the day but the current second.

#### Root cause

Read at `64f8c4fb`, all in `server/src/api/analytics/utils/timeWindow.ts`, inside `whereClause`.

The date branch, `:283-301` (the strict `<` is at `:293`, `now()` at `:295`):

```ts
      return `AND ${column} >= toTimeZone(
      toStartOfDay(toDateTime(${SqlString.escape(startDate)}, ${tz})),
      'UTC'
      )
      AND ${column} < if(
        toDate(${SqlString.escape(endDate)}) = toDate(now(), ${tz}),
        toTimeZone(now(), 'UTC'),
        toTimeZone(
          toStartOfDay(toDateTime(${SqlString.escape(endDate)}, ${tz})) + INTERVAL 1 DAY,
          'UTC'
        )
      )`;
```

The block carries a comment stating the intent: the upper bound is the end date's midnight tomorrow, except when the end date is today, in which case it is now, "so a partial final day is not reported as a whole one". The intent is right. The resolution is what bites: at second granularity, "strictly before now" excludes the whole second that `now()` is currently in.

Four lines below, `case "pastMinutes"` at `:307-308` is inclusive:

```ts
      return `AND ${column} > toDateTime(${SqlString.escape(window.start)}, 'UTC') AND ${column} <= toDateTime(${SqlString.escape(window.end)}, 'UTC')`;
```

One `switch`, two bounds, one `<` and one `<=`, four lines apart. That pair is the entire argument.

#### One thing to rule out before reading further

The most recent commit on `master` looks like a fix for this if you go by its title. It is not, and it is worth saying so plainly so nobody spends time on it.

The change merged on 2026-08-20 whose title is about period chart axes ending a bucket early and adding past-minutes time navigation is `64f8c4fb`, which is the exact commit tested here. It touches nine files, **all of them under `client/`**: chart axis maximums moving from a period's final millisecond to the start of its final bucket, a date selector, a store, and their tests. It does not touch server SQL. `server/src/api/analytics/utils/timeWindow.ts` has had no commit since the time-window unification of 2026-08-15 (`9c66672b`), which is an ancestor of the tested commit, so this bound survived that refactor unchanged.

#### Possible fixes

Yours to choose; the constraint is that whatever is done here should leave the two branches agreeing about the current second.

1. Make the today bound inclusive of the current second, matching the relative branch.
2. Or move both branches to a common resolution, which is the deeper fix and connects to the whole-second storage of `events.timestamp` generally.

Whichever, a test that tracks an event and immediately queries both windows would have caught this, and would keep catching it.

**To Reproduce**

Stack: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, clean working tree, images built from the repo's own `server/Dockerfile` and `client/Dockerfile`, backend on `127.0.0.1:14701`. Virgin Postgres and ClickHouse. `CLUSTER_WORKERS=0`, `DISABLE_TELEMETRY=true`.

Each round:

1. Create a fresh site, so no earlier event can be in either window.
2. Park about 30 ms after a wall-clock second boundary, so the event is stamped early in its second.
3. `POST /api/track`, one pageview.
4. From the moment of the ack, poll **both** windows in parallel every 40 ms, and record when each first returns the session:
   - `GET /api/sites/<id>/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0`
   - `GET /api/sites/<id>/sessions?start_date=<today>&end_date=<today>&time_zone=UTC`

The two windows are each other's control. Same event, same site, same instant, one query parameter apart.

```
round 1 site 11: ack 200 {"success":true} (6 ms, stamped +31 ms into its second)
  past_minutes visible at 386 ms | date_range visible at 987 ms | gap 601 ms

  DIVERGENT at +386 ms:
    GET /api/sites/11/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"s5AnnRUCdC4fD4","user_id":"2c7259e51a82",…}]}
    GET /api/sites/11/sessions?start_date=2026-08-21&end_date=2026-08-21&time_zone=UTC
      -> 200 {"data":[]}

round 2 site 12: ack 200 {"success":true} (27 ms, stamped +31 ms into its second)
  past_minutes visible at 438 ms | date_range visible at 994 ms | gap 556 ms

  DIVERGENT at +438 ms:
    GET /api/sites/12/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"vh0-FkmO1ZRjKT","user_id":"d1b50d067820",…}]}
    GET /api/sites/12/sessions?start_date=2026-08-21&end_date=2026-08-21&time_zone=UTC
      -> 200 {"data":[]}
```

All ten rounds:

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

Ten of ten. Every round had a real interval in which realtime held the session and the identical date-range query returned `{"data":[]}`.

The ceiling depends on how quickly the ingest queue flushes relative to the second boundary, so it moves between hosts: on a run where the queue flushed at 80 to 290 ms after the ack rather than 390 to 450 ms, the same procedure produced gaps up to 934 ms, and the one round in that set that did not diverge is the mechanism's own negative control, its flush having slipped into the **next** second, by which point the bound had already moved past the row. That is the shape to expect if you reproduce it: divergence whenever the row lands in the second it is queried in, agreement whenever it does not.

**Expected behavior**

An event that realtime can see is an event a Today window can see. Concretely, in every round above the `start_date`/`end_date` query returns the same session the `past_minutes` query returns, at the same time, rather than up to 601 ms later.

Nothing here asks for a change to the sensible intent of the bound. A partial final day should still not be reported as a whole one. The two branches simply need to agree on where the present ends.

**Screenshots**

None taken for this report; it is proved at the API layer, where both windows can be polled in parallel at 40 ms and timestamped exactly, which a screenshot cannot do. The user-facing symptom is easy to picture though: the realtime counter showing a visitor while the dashboard beside it, on the same site and the same second, renders its empty state.

**Desktop (please complete the following information):**

- OS: macOS 26.5 (build 25F71), Apple silicon
- Browser: not applicable. Every request above was issued directly against the backend over HTTP, no browser involved
- Version: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, self-hosted via the repo's own docker compose. `v2.8.0` (2026-07-26) is an ancestor of this commit, so the shipped release carries the same behaviour
- Deployment: docker compose, backend `127.0.0.1:14701`, ClickHouse, Postgres and Redis local to the stack. `CLUSTER_WORKERS=0`, `DISABLE_SIGNUP=false`, `DISABLE_TELEMETRY=true`, virgin database

This finding came from running the product's published documentation against a live instance. The full transcript, including the per-round poll log and the result summary, is available on request.
