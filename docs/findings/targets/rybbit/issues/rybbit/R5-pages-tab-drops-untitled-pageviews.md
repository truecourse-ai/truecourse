---
finding: R5
target: rybbit-io/rybbit
route: public issue
title: "The Pages tab silently drops every pageview whose page_title is empty, so a two-page site renders as \"Showing 1 to 1 of 1 pages\""
labels: "none. rybbit-io/rybbit applies no labels: both issue templates declare `labels: ''` and all 40 most recent issues carry an empty label array. No suggested-labels line is included, deliberately."
status: filed
filed_url: https://github.com/rybbit-io/rybbit/issues/1135
filed_at: 2026-08-21
reverified: "2026-08-20 live re-run against a docker compose stack built from master @ 64f8c4fb7f394bdfe9379717de8e6c21758b1ac2, proved on the API and again on the rendered tab in Chromium, with the stored ClickHouse rows read directly; evidence in docs/findings/targets/rybbit/live/R5/repro.md, live/R5/r5.log, live/R5/r5-pages-tab.png and live/R5/r5-pages-tab.txt"
format_note: "bug_report.md is a classic Markdown template, not a YAML form, and no template-enforcing workflow exists on this repo. Body matches its bold-label section shape verbatim and in template order: **Describe the bug**, **To Reproduce**, **Expected behavior**, **Screenshots**, **Desktop (please complete the following information):**. No suggested-labels line, since this repo applies none. A screenshot of the rendered tab exists and should be attached at filing time."
---

# The Pages tab silently drops every pageview whose page_title is empty, so a two-page site renders as "Showing 1 to 1 of 1 pages"

**Describe the bug**

A pageview with no `page_title` is stored, is counted in the overview totals, and appears in the paths listing. It is absent from the titles listing that the Pages tab renders, and there is nothing on the tab to say a row was withheld.

Two pageviews on a fresh site, one with a title and one without:

```
GET /api/sites/33/page-titles          -> 1 row    (/pricing)
GET /api/sites/33/metric?parameter=pathname -> 2 rows  (/docs/getting-started, /pricing)
GET /api/sites/33/overview             -> pageviews 2, sessions 2, users 2
```

and the tab itself, rendered in a browser, states the wrong total in its own footer:

```
Page	Trend	Views	Sessions	Bounce	Duration
Pricing
/pricing
	1	1	+999%	100%	0s
Showing 1 to 1 of 1 pages
```

`/docs/getting-started` appears nowhere in the page text.

This matters because untitled pageviews are not exotic. They arise wherever `document.title` has not been set at the moment the tag fires, which is routine in single-page apps that track on route change before the framework updates the title, and on any programmatic or non-HTML pageview. For a site in that state the tab is not slightly incomplete, it is arbitrarily filtered, and the pages missing from it are exactly the ones whose instrumentation needs attention.

#### What the docs promise

`docs/content/docs/(docs)/feature-guides/pages-tab.mdx:8`, the first sentence of the page:

> The Pages tab shows detailed analytics for **every URL** on your site.

and `:12-13`, on what each row carries:

> Each page displays:
> - **Page URL** - The full path

So the documented unit of the tab is the URL, and the URL is the one thing an untitled pageview definitely has.

#### Root cause

Read at `64f8c4fb`.

The tab's rows come from `useGetPageTitlesPaginated` (`client/src/app/[site]/pages/components/PagesTable.tsx:101`), which calls `GET /api/sites/:siteId/page-titles`. That query filters the rows out at `server/src/api/analytics/getPageTitles.ts:70-74`:

```sql
        WHERE
          site_id = {siteId:Int32}
          AND page_title IS NOT NULL
          AND page_title <> ''
          AND type = 'pageview'
```

The filter looks deliberate rather than accidental, and the reason is visible one file over: the path is never the row's key. `PagesTable.tsx:155-156` renders it only as the muted subtitle beneath the title:

```tsx
            <p className="text-xs text-muted-foreground truncate" title={pathname}>
              {pathname}
            </p>
```

An untitled row would therefore have nothing to put on its first line, which is presumably why the rows are excluded upstream. That is an understandable layout decision that has quietly become a data decision, and the pagination footer inherits it: the count comes from the filtered set, so the tab confidently reports a total that is not the site's total.

#### Possible fixes

Three, in rough order of how much they change:

1. Fall back to the pathname when `page_title` is empty, so the row keys on something real and the subtitle can be dropped or repeated.
2. Drop the filter and let the row key on the path, showing the title only when there is one.
3. If neither is wanted, narrow the sentence in `pages-tab.mdx` so the tab's documented subject matches what it lists, and consider surfacing the withheld count somewhere.

The first two are small, and we would be glad to send a patch with a test if a pull request would be welcome.

**To Reproduce**

Stack: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, clean working tree, images built from the repo's own `server/Dockerfile` and `client/Dockerfile`, backend on `127.0.0.1:14701`, ClickHouse published locally so the stored rows can be read directly. Virgin Postgres and ClickHouse.

1. Create a site. In the run below it is site 33.
2. Track two pageviews: `/pricing` with `page_title: "Pricing"`, and `/docs/getting-started` with no title at all.
3. Read the tab's own endpoint, then read two surfaces that see the same events.

```
site 33
track acks: 200 {"success":true} | 200 {"success":true}

PROBE   GET /api/sites/33/page-titles
  -> 200 {"data":[{"value":"Pricing","pathname":"/pricing","count":1,"percentage":100,
                   "pageviews":1,"bounce_rate":100,"time_on_page_seconds":0}]}
  1 row: /pricing
```

Control, the same two pageviews on every other surface:

```
CONTROL GET /api/sites/33/metric?parameter=pathname
  -> 200 {"data":{"data":[{"value":"/docs/getting-started","hostname":"tcref.test","count":1,"percentage":50,"pageviews":1,…},
                          {"value":"/pricing","hostname":"tcref.test","count":1,"percentage":50,"pageviews":1,…}],"totalCount":2}}
  2 rows

CONTROL GET /api/sites/33/overview
  -> 200 {"data":{"sessions":2,"pages_per_session":1,"bounce_rate":100,"session_duration":0,"pageviews":2,"users":2}}

clickhouse rows (pathname / page_title / timestamp):
  /docs/getting-started		2026-08-21 02:39:05
  /pricing	Pricing	2026-08-21 02:39:05
```

Both events are stored, both are counted, and the untitled one carries an empty `page_title`. The single variable between the row that appears and the row that does not is the title.

Then the rendered tab, in Chromium, on `/33/pages` (the site is public, so no sign-in is involved):

```
requests the tab issued:
  200 /api/sites/33/page-titles?start_date=2026-08-19&end_date=2026-08-19&time_zone=America%2FLos_Angeles&limit=1000&page=1
  200 /api/sites/33/page-titles?start_date=2026-08-20&end_date=2026-08-20&time_zone=America%2FLos_Angeles&limit=25&page=1

what it rendered:
  Page	Trend	Views	Sessions	Bounce	Duration
  Pricing
  /pricing
  	1	1	+999%	100%	0s
  Showing 1 to 1 of 1 pages

  body mentions "/pricing":               true
  body mentions "Pricing":                true
  body mentions "/docs/getting-started":  false
```

**Expected behavior**

Both pageviews appear on the Pages tab, and its footer reads "Showing 1 to 2 of 2 pages" for a site with two pages. The untitled row is identified by its path, `/docs/getting-started`, which is the value the documentation calls the row's Page URL and the only stable identity such a row has.

At minimum, a page the overview counts and the paths listing lists should not vanish without trace from the tab documented as covering every URL on the site.

**Screenshots**

The Pages tab for the two-pageview site in the reproduction above. One row is listed, and the tab's own footer reads "Showing 1 to 1 of 1 pages". The untitled pageview, which the paths listing does return, is absent here.

![The Pages tab showing a single row and a footer reading "Showing 1 to 1 of 1 pages"](https://raw.githubusercontent.com/truecourse-agent/truecourse-evidence/main/rybbit-io/rybbit/R5/pages-tab.png)

A screenshot of the rendered tab is attached, showing the single `Pricing` row and the "Showing 1 to 1 of 1 pages" footer for the two-pageview site described above. The extracted page text in the transcript above is from that same render.

**Desktop (please complete the following information):**

- OS: macOS 26.5 (build 25F71), Apple silicon
- Browser: Chromium 141.0.7390.37 for the rendered-tab half; the API half was issued directly against the backend over HTTP with no browser involved
- Version: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, self-hosted via the repo's own docker compose. The dashboard's own footer in the attached screenshot reads `v2.8.0`, which is an ancestor of this commit, so the shipped release carries the same behaviour
- Deployment: docker compose, backend `127.0.0.1:14701`, client reached through a local front process on `127.0.0.1:14750`, ClickHouse, Postgres and Redis local to the stack. `CLUSTER_WORKERS=0`, `DISABLE_SIGNUP=false`, `DISABLE_TELEMETRY=true`, virgin database

This finding came from running the product's published documentation against a live instance. The full transcript, including the raw request log, the extracted page text and the result summary, is available on request.
