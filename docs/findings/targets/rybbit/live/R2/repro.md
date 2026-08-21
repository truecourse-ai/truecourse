# R2 — whole-second timestamps plus a strict `>` make same-second funnel steps never convert

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:37 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701`, clickhouse read directly on `:14723` |
| raw | `r2.log`, `r2.json`, `r2.stdout` |

## VERDICT: **still reproduces** — both halves (funnel, and entry/exit page).

---

## Mechanism, re-read at `64f8c4fb`

1. The stored column is whole seconds — `server/src/db/clickhouse/schema/core.ts`:
   `timestamp DateTime,`. The value is server-stamped; `/api/track` accepts no
   timestamp field of any kind.
2. The funnel advances on a STRICT inequality —
   `server/src/api/analytics/funnels/getFunnel.ts`:
   ```sql
        sa.timestamp > s${index + 1}.step_time
   ```
3. Entry/exit page has nothing to break a tie with —
   `server/src/api/analytics/getMetric.ts`:
   ```sql
        row_number() OVER (PARTITION BY session_id ORDER BY timestamp ${orderDirection}) as row_num
   ```

All three unchanged from the hand-verification.

---

## Funnel — PROBE (two visitors, `/cart` then `/checkout`, no gap)

Every burst is parked ~30 ms after a wall-clock second boundary so the events cannot
straddle a second by accident, and ClickHouse is read directly, so "same second" is
observed rather than inferred.

```
  site 7  (tcref-r2fp-e40808b7)
  track acks: {"success":true} | {"success":true} | {"success":true} | {"success":true}
  clickhouse rows (pathname / timestamp / session):
      /cart       2026-08-21 02:37:42   80ssgI7dc-jbuJ
      /cart       2026-08-21 02:37:42   2EcKAJO8zH3Aph
      /checkout   2026-08-21 02:37:42   80ssgI7dc-jbuJ
      /checkout   2026-08-21 02:37:42   2EcKAJO8zH3Aph
  distinct whole seconds across the 4 rows: 1 (2026-08-21 02:37:42)
  POST /api/sites/7/funnels/analyze
    -> 200 {"data":[{"step_number":1,"step_name":"Cart","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2},
                    {"step_number":2,"step_name":"Checkout","sessions":0,"conversion_rate":0,"dropoff_rate":100,"visitors":0}]}
```

## Funnel — CONTROL (identical, 1500 ms between the two paths)

```
  site 8  (tcref-r2fc-e40808b7)
  clickhouse rows:
      /cart       2026-08-21 02:37:43   dyH17TnMS6K1bI
      /cart       2026-08-21 02:37:43   _yfxv_BQymEMxY
      /checkout   2026-08-21 02:37:44   dyH17TnMS6K1bI
      /checkout   2026-08-21 02:37:44   _yfxv_BQymEMxY
  distinct whole seconds across the 4 rows: 2
  POST /api/sites/8/funnels/analyze
    -> 200 {"data":[{"step_number":1,…"sessions":2,…},
                    {"step_number":2,"step_name":"Checkout","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2}]}
```

Two sessions that demonstrably visited both paths convert **0%** when the visits share a
second and **100%** when they are one second apart. The single variable is the gap.

---

## Entry/exit page — PROBE (one visitor, `/blog/article` then `/checkout`, no gap)

```
  site 9  (tcref-r2ep-e40808b7)
  clickhouse rows:
      /blog/article   2026-08-21 02:37:46   zLG0Ff6Pgmgat8
      /checkout       2026-08-21 02:37:46   zLG0Ff6Pgmgat8
  distinct whole seconds across the 2 rows: 1
  GET /api/sites/9/metric?parameter=entry_page -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":0,…}],"totalCount":1}}
  GET /api/sites/9/metric?parameter=exit_page  -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":0,…}],"totalCount":1}}
```

## Entry/exit page — CONTROL (same two pageviews 2000 ms apart)

```
  site 10  (tcref-r2ec-e40808b7)
  clickhouse rows:
      /blog/article   2026-08-21 02:37:47   Cpqy7LilFFYj2M
      /checkout       2026-08-21 02:37:49   Cpqy7LilFFYj2M
  distinct whole seconds across the 2 rows: 2
  GET /api/sites/10/metric?parameter=entry_page -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":2,…}],"totalCount":1}}
  GET /api/sites/10/metric?parameter=exit_page  -> 200 {"data":{"data":[{"value":"/checkout",…}],"totalCount":1}}
```

The exit page of a two-page visit is reported as its entry page whenever the two
pageviews tie on the whole second.

## Change from the hand-verification

None. Same numbers, same shape, at a SHA four commits later.
