# R7 — the Sessions doc promises a per-session Bounce Status; no such field exists

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`; the dashboard driven in Chromium (playwright-core 1.62.1 from `packages/guard-runner`) through `reference/seed/guard-front.mjs` on `127.0.0.1:14750` |
| raw | `r7.log`, `r7.json`, `r7.stdout`, `r7-sessions-tab.png`, `r7-sessions-tab.txt`, `web.log`, `web.json` |

## VERDICT: **still reproduces** — both halves (the doc is wrong; the product is self-consistent).

---

## The doc

`docs/content/docs/(docs)/feature-guides/sessions.mdx:10-18`, "Each session displays:" …

> - **Duration** - Time spent on site
> - **Pages Visited** - Number of pages viewed
> - **Events Triggered** - Custom events fired during the session
> - **Device & Browser** - Technical environment
> - **Location** - Geographic location based on IP
> - **Entry/Exit Page** - Where the session started and ended
> - **Bounce Status** - Whether the user left after one page

## The code

`grep -i bounce server/src/api/analytics/sessions/getSessions.ts` returns nothing at this SHA.

---

## PROBE — the live payload, on a site with one genuine bounce and one two-page visit

```
site 35
GET /api/sites/35/sessions -> 200
  2 session rows. Keys of row 0:
    ["session_id","user_id","identified_user_id","country","region","city","language","device_type",
     "browser","browser_version","operating_system","operating_system_version","screen_width","screen_height",
     "referrer","channel","hostname","utm_source","utm_medium","utm_campaign","utm_term","utm_content",
     "session_end","session_start","session_duration","entry_page","exit_page","pageviews","events","errors",
     "outbound","button_clicks","copies","form_submits","input_changes","ip","lat","lon","tag","timezone",
     "has_replay","traits"]
  any key matching /bounc/i: []
  whole response contains the substring "bounc": false
  row: entry=/only-page exit=/only-page pageviews=1 events=0
  row: entry=/first     exit=/second    pageviews=2 events=0
```

41 declared fields, one of them genuinely a bounce, and no field of any name says so.

## CONTROL — the bounce *metric* does exist

So this is a missing per-session field, not a missing feature:

```
CONTROL GET /api/sites/35/overview
  -> 200 {"data":{"sessions":2,"pages_per_session":1.5,"bounce_rate":50,"session_duration":0.5,"pageviews":3,"users":2}}
```

---

## PROBE — the rendered Sessions tab

Chromium, signed out (the site is `public: true`), `GET http://127.0.0.1:14750/35/sessions`.
Screenshot: `r7-sessions-tab.png`, full extracted text: `r7-sessions-tab.txt`.

```
  body matches /bounce/i:                 false
  body mentions "/only-page":             true
  body mentions "/first" and "/second":   true / true
```

Both visits render — so the list is populated, not empty — and the word "Bounce" appears
nowhere on the page:

```
Fuchsia Turkey
1  0  Direct  /only-page  /only-page  Aug 20, 7:39 PM  •  0s
Purple Zebra
2  0  Direct  …
```

The rows carry a pageview badge and an events badge and nothing else. A reader can
derive "bounced" from `pageviews == 1`, but the product ships no such status and the
Sessions tab renders none.

## Change from the hand-verification

None. The hand-verification proved this on the response shape alone; the browser pass
here confirms the rendered tab agrees.
