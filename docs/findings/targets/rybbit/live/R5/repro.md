# R5 — the Pages tab drops every pageview whose `page_title` is empty

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`; the dashboard driven in Chromium (playwright-core 1.62.1 from `packages/guard-runner`) through `reference/seed/guard-front.mjs` on `127.0.0.1:14750` |
| raw | `r5.log`, `r5.json`, `r5.stdout`, `r5-pages-tab.png`, `r5-pages-tab.txt`, `web.log`, `web.json` |

## VERDICT: **still reproduces** — proved on the API and on the rendered tab.

---

## The doc

`docs/content/docs/(docs)/feature-guides/pages-tab.mdx:8`:

> The Pages tab shows detailed analytics for every URL on your site.

## The code, re-read at `64f8c4fb`

`client/src/app/[site]/pages/components/PagesTable.tsx` reads
`useGetPageTitlesPaginated` -> `GET /api/sites/:siteId/page-titles`, whose query filters
in `server/src/api/analytics/getPageTitles.ts`:

```sql
        FROM events
        WHERE
          site_id = {siteId:Int32}
          AND page_title IS NOT NULL
          AND page_title <> ''
          AND type = 'pageview'
```

The path is rendered only as the row's subtitle, never as the key.

---

## PROBE — the API the tab consumes

Two pageviews on site 33 in the same second: `/pricing` with `page_title: "Pricing"`,
`/docs/getting-started` with no title at all.

```
site 33
track acks: 200 {"success":true} | 200 {"success":true}

PROBE   GET /api/sites/33/page-titles
  -> 200 {"data":[{"value":"Pricing","pathname":"/pricing","count":1,"percentage":100,"pageviews":1,"bounce_rate":100,"time_on_page_seconds":0}]}
  (1 row(s): /pricing)
```

## CONTROL — the same two pageviews on every other surface

```
CONTROL GET /api/sites/33/metric?parameter=pathname
  -> 200 {"data":{"data":[{"value":"/docs/getting-started","hostname":"tcref.test","count":1,"percentage":50,"pageviews":1,…},
                          {"value":"/pricing","hostname":"tcref.test","count":1,"percentage":50,"pageviews":1,…}],"totalCount":2}}
  (2 row(s): /docs/getting-started, /pricing)

CONTROL GET /api/sites/33/overview
  -> 200 {"data":{"sessions":2,"pages_per_session":1,"bounce_rate":100,"session_duration":0,"pageviews":2,"users":2}}

clickhouse rows (pathname / page_title / timestamp):
  /docs/getting-started		2026-08-21 02:39:05
  /pricing	Pricing	2026-08-21 02:39:05
```

The untitled pageview is stored, is counted in the overview, and appears in the pathname
dimension. It is invisible on the tab whose subject it is.

---

## PROBE — the rendered tab

Chromium, signed out (the site is `public: true`, the way the corpus's own web scenarios
drive it), `GET http://127.0.0.1:14750/33/pages`. Screenshot: `r5-pages-tab.png`, full
extracted text: `r5-pages-tab.txt`.

Requests the tab issued:

```
200 /api/sites/33/page-titles?start_date=2026-08-19&end_date=2026-08-19&time_zone=America%2FLos_Angeles&limit=1000&page=1
200 /api/sites/33/page-titles?start_date=2026-08-20&end_date=2026-08-20&time_zone=America%2FLos_Angeles&limit=25&page=1
```

What it rendered:

```
Page	Trend	Views	Sessions	Bounce	Duration
Pricing
/pricing
	1	1	+999%	100%	0s
Showing 1 to 1 of 1 pages
```

```
  body mentions "/pricing":               true
  body mentions "Pricing":                true
  body mentions "/docs/getting-started":  false
```

The tab's own footer says **"Showing 1 to 1 of 1 pages"** for a site that has two.

## Change from the hand-verification

None. The hand-verification proved this on the API alone; the browser pass here adds the
rendered tab and its "1 of 1" count.
