---
finding: R2
target: rybbit-io/rybbit
route: public issue
title: "Whole-second event timestamps plus a strict > mean two funnel steps in the same second never convert (0% instead of 100%), and a two-page visit's exit page reads as its entry page"
labels: "none. rybbit-io/rybbit applies no labels: both issue templates declare `labels: ''` and all 40 most recent issues carry an empty label array. No suggested-labels line is included, deliberately."
status: draft
reverified: "2026-08-20 live re-run against a docker compose stack built from master @ 64f8c4fb7f394bdfe9379717de8e6c21758b1ac2, both halves and both controls re-executed, ClickHouse queried directly so 'same second' is read rather than inferred; evidence in docs/findings/targets/rybbit/live/R2/repro.md and live/R2/r2.log"
format_note: "bug_report.md is a classic Markdown template, not a YAML form, and no template-enforcing workflow exists on this repo. Body matches its bold-label section shape verbatim and in template order: **Describe the bug**, **To Reproduce**, **Expected behavior**, **Screenshots**, **Desktop (please complete the following information):**. No suggested-labels line, since this repo applies none. The neighbouring replay-precision change is referred to by commit sha and in plain words rather than hash-number syntax."
---

# Whole-second event timestamps plus a strict > mean two funnel steps in the same second never convert, and a two-page visit's exit page reads as its entry page

**Describe the bug**

`events.timestamp` is a ClickHouse `DateTime`, which is whole seconds, and the value is server-stamped with the sub-second part cut off on the way in. `/api/track` accepts no timestamp of its own, so a caller cannot supply better precision even if it has it.

The funnel query then advances a session only on a strict inequality, `sa.timestamp > s.step_time`. **Two funnel-step events that land in the same wall-clock second therefore never advance the funnel.** A session that demonstrably visited both steps is counted at step 1 and reported as 100 percent dropped off at step 2.

The same tie has a second visible symptom: the entry-page and exit-page query orders by `timestamp` with no tie-break, so a two-page visit inside one second reports its **entry** page as its **exit** page.

Four rows in one ClickHouse second, and the same four events one and a half seconds apart:

```
PROBE   4 rows, all stamped 2026-08-21 02:37:42
  step 1  Cart      sessions 2  conversion_rate 100  dropoff_rate 0
  step 2  Checkout  sessions 0  conversion_rate 0    dropoff_rate 100   visitors 0

CONTROL identical events, 1500 ms between the two paths (02:37:43 and 02:37:44)
  step 1  Cart      sessions 2  conversion_rate 100  dropoff_rate 0
  step 2  Checkout  sessions 2  conversion_rate 100  dropoff_rate 0     visitors 2
```

Nothing failed and nothing was logged. The numbers are simply wrong, which for a product whose entire output is numbers is the worse failure mode. A funnel that reads 0 percent looks like a real finding about a real checkout, and there is nothing on the screen to suggest otherwise.

The realistic triggers are not exotic. Any single-page app that fires a route-change pageview and then an immediate second one, any server-to-server or scripted tracking, any redirect chain, and any fast click-through will regularly put two steps in one second.

#### What the docs promise

`docs/content/docs/api/funnels/analyze.mdx:18`, on the endpoint itself:

> Analyzes a funnel and returns step-by-step conversion data. Sessions must complete steps in order (step 2 must occur after step 1, etc.).

"In order" is the contract, and the two sessions above did complete the steps in order. Nothing in `funnels.mdx` or in the API reference says a funnel needs a whole second between steps, or that a step completed in the same second as its predecessor does not count.

`docs/content/docs/(docs)/definitions.mdx:41-42` defines the other half:

> ### Exit Page
> The last page viewed by a user before ending their session. Helps identify where users tend to leave your site.

In the probe below the last page viewed is `/checkout` and the reported exit page is `/blog/article`, which is the entry page.

#### Root cause

Read at `64f8c4fb`. Three pieces, none of them wrong on its own.

**1. Storage is whole seconds.** `server/src/db/clickhouse/schema/core.ts:89`, in the events DDL:

```
        timestamp DateTime,
```

and the sub-second part is discarded on the ingest path: `server/src/services/tracker/utils.ts:152` stamps `timestamp: trackingRequest.receivedAt.toISOString()`, then `server/src/services/tracker/pageviewQueue.ts:83` formats it down:

```ts
        timestamp: DateTime.fromISO(pv.timestamp).toFormat("yyyy-MM-dd HH:mm:ss"),
```

**2. The funnel advances on a strict inequality.** `server/src/api/analytics/funnels/getFunnel.ts:71`, inside the per-step CTE:

```
        sa.timestamp > s${index + 1}.step_time
```

With second resolution, `>` means "at least one second later". Two events in the same second compare equal, so the join finds nothing and the step reports zero sessions.

**3. Entry and exit page have no tie-break.** `server/src/api/analytics/getMetric.ts:170` opens the `entry_page` / `exit_page` branch, and `:206` is the ordering:

```
              row_number() OVER (PARTITION BY session_id ORDER BY timestamp ${orderDirection}) as row_num
```

`orderDirection` is `ASC` for entry and `DESC` for exit. When every row in the session shares a timestamp, both directions can return the same row, and in the probe below they do.

#### The project already treats second resolution as too coarse, in a neighbouring table

Worth raising because it is your own reasoning, not ours. The commit titled "perf(clickhouse): cut mutation-driven parts-lock contention on the hot ingest path" (`c65b3931`, merged 2026-08-20, hours before this check) adds the `session_replay_metadata_v2` table and justifies millisecond columns in the DDL itself, at `core.ts:347-349`:

```
        -- Millisecond resolution, matching session_replay_events.timestamp:
        -- duration is now derived from these bounds instead of being stored,
        -- and second-resolution columns would floor a 900ms replay to 0.
        start_time SimpleAggregateFunction(min, DateTime64(3)),
```

That is the identical argument applied to a different table: at second resolution, sub-second reality floors to zero. In the replay table it floors a duration; in the events table it floors a funnel conversion.

#### Possible fixes

Both are yours to weigh, and they are not exclusive:

1. **Widen `events.timestamp` to `DateTime64(3)`**, matching what the replay tables already do. This is a migration, and the ingest path would have to stop calling `toFormat("yyyy-MM-dd HH:mm:ss")`. It fixes both symptoms and every other query that orders by time.
2. **Add a deterministic tie-break** so equal timestamps still order, and relax the funnel's `>` to `>=` guarded by that tie-break so a step cannot match its own predecessor row. Cheaper, no migration, but it only fixes the queries you remember to change.

**To Reproduce**

Stack: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, clean working tree, images built from the repo's own `server/Dockerfile` and `client/Dockerfile`, backend on `127.0.0.1:14701`, ClickHouse published on `127.0.0.1:14723` so the stored rows can be read directly. Virgin Postgres and ClickHouse. `CLUSTER_WORKERS=0`, `DISABLE_TELEMETRY=true`.

Two methodological points, because they are what make the result clean:

- Every burst is parked about 30 ms after a wall-clock second boundary, so the events cannot straddle a second by accident.
- ClickHouse is queried directly for the stored timestamps, so "the same second" is **observed**, not assumed from the wall clock of the caller.

#### Funnel, probe: two visitors do `/cart` then `/checkout` with no gap

```
site 7  (tcref-r2fp-e40808b7)
  track acks: {"success":true} | {"success":true} | {"success":true} | {"success":true}

  clickhouse rows (pathname / timestamp / session):
      /cart       2026-08-21 02:37:42   80ssgI7dc-jbuJ
      /cart       2026-08-21 02:37:42   2EcKAJO8zH3Aph
      /checkout   2026-08-21 02:37:42   80ssgI7dc-jbuJ
      /checkout   2026-08-21 02:37:42   2EcKAJO8zH3Aph
  distinct whole seconds across the 4 rows: 1

  POST /api/sites/7/funnels/analyze
    -> 200 {"data":[{"step_number":1,"step_name":"Cart","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2},
                    {"step_number":2,"step_name":"Checkout","sessions":0,"conversion_rate":0,"dropoff_rate":100,"visitors":0}]}
```

#### Funnel, control: the same thing, 1500 ms between the two paths

```
site 8  (tcref-r2fc-e40808b7)
  clickhouse rows:
      /cart       2026-08-21 02:37:43   dyH17TnMS6K1bI
      /cart       2026-08-21 02:37:43   _yfxv_BQymEMxY
      /checkout   2026-08-21 02:37:44   dyH17TnMS6K1bI
      /checkout   2026-08-21 02:37:44   _yfxv_BQymEMxY
  distinct whole seconds across the 4 rows: 2

  POST /api/sites/8/funnels/analyze
    -> 200 {"data":[{"step_number":1,"step_name":"Cart","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2},
                    {"step_number":2,"step_name":"Checkout","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2}]}
```

Same funnel definition, same two visitors, same two paths, same order. 0 percent when the visits share a second, 100 percent when they are one second apart. The gap is the only variable.

#### Entry and exit page, probe: one visitor, `/blog/article` then `/checkout`, no gap

```
site 9  (tcref-r2ep-e40808b7)
  clickhouse rows:
      /blog/article   2026-08-21 02:37:46   zLG0Ff6Pgmgat8
      /checkout       2026-08-21 02:37:46   zLG0Ff6Pgmgat8
  distinct whole seconds across the 2 rows: 1

  GET /api/sites/9/metric?parameter=entry_page
    -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":0,…}],"totalCount":1}}
  GET /api/sites/9/metric?parameter=exit_page
    -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":0,…}],"totalCount":1}}
```

#### Entry and exit page, control: the same two pageviews 2000 ms apart

```
site 10  (tcref-r2ec-e40808b7)
  clickhouse rows:
      /blog/article   2026-08-21 02:37:47   Cpqy7LilFFYj2M
      /checkout       2026-08-21 02:37:49   Cpqy7LilFFYj2M
  distinct whole seconds across the 2 rows: 2

  GET /api/sites/10/metric?parameter=entry_page
    -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":2,…}],"totalCount":1}}
  GET /api/sites/10/metric?parameter=exit_page
    -> 200 {"data":{"data":[{"value":"/checkout",…}],"totalCount":1}}
```

**Expected behavior**

A session that completed step 2 after step 1 counts at step 2, whatever the interval between them. Concretely: site 7 reports step 2 `sessions: 2`, `conversion_rate: 100`, `dropoff_rate: 0`, exactly as site 8 does. And the exit page of site 9 is `/checkout`, the last page the visitor viewed, exactly as site 10 reports it.

More generally, two events that arrive milliseconds apart should not be indistinguishable to the analytics that exist to tell them apart. Sub-second ordering is information the ingest path currently has, in `receivedAt`, and discards on the way to the column.

**Screenshots**

None. This is a data-layer defect with no visual component, and the verbatim ClickHouse rows and API responses above are the evidence. The dashboard symptom a user would actually notice is a funnel that reports a real, converting checkout as 100 percent dropoff, and an Exit Pages list that names pages nobody exited from.

**Desktop (please complete the following information):**

- OS: macOS 26.5 (build 25F71), Apple silicon
- Browser: not applicable. Every request above was issued directly against the backend over HTTP, no browser involved
- Version: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, self-hosted via the repo's own docker compose. `v2.8.0` (2026-07-26) is an ancestor of this commit, so the shipped release carries the same behaviour
- Deployment: docker compose, backend `127.0.0.1:14701`, ClickHouse published on `127.0.0.1:14723` for direct reads, Postgres and Redis local to the stack. `CLUSTER_WORKERS=0`, `DISABLE_SIGNUP=false`, `DISABLE_TELEMETRY=true`, virgin database

This finding came from running the product's published documentation against a live instance. The full transcript, including the raw request log and the result summary, is available on request.
