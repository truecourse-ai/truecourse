# R9 — journeys are pageviews-only, though `journeys.mdx` says each node is a page or an event

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701` |
| raw | `r9.log`, `r9.json`, `r9.stdout` |

## VERDICT: **still reproduces** — both halves.

---

## The doc

`docs/content/docs/(docs)/feature-guides/journeys.mdx:12-13`:

> ### Nodes
> Each bar represents a page or event. Its height indicates how many users reached that point.

## The code, re-read at `64f8c4fb`

`server/src/api/analytics/getJourneys.ts:74` filters the session's actions to

```sql
              AND type = 'pageview'
```

Nine event types exist; eight of them can never be a node.

---

## Setup

One session on site 37: `/start` -> custom event `signup_clicked` -> `/middle` -> `/end`,
each 1.2 s apart so the ordering is unambiguous (see R2).

```
track acks: {"success":true} | {"success":true} | {"success":true} | {"success":true}

clickhouse rows (type / pathname / event_name / timestamp):
  pageview	/start		2026-08-21 02:39:09
  custom_event	/start	signup_clicked	2026-08-21 02:39:11
  pageview	/middle		2026-08-21 02:39:12
  pageview	/end		2026-08-21 02:39:13
```

## CONTROL — the custom event IS stored and queryable

```
    GET /api/sites/37/events/names -> 200 {"data":[{"eventName":"signup_clicked","count":1}]}
```

## PROBE — the journeys surface

```
    GET /api/sites/37/journeys?steps=4
      -> 200 {"journeys":[{"path":["/start","/middle","/end"],"count":1,"percentage":100}]}
```

The event was ingested, is queryable, and sits in the middle of the walk between two
pages. It is absent from the journey; the four-step request returns a three-node path.

## Change from the hand-verification

None.
