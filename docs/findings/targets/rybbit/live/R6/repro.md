# R6 — the Traffic Sources doc names `Search` / `Social`; the product stores `Organic Search` / `Organic Social`

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701` |
| raw | `r6.log`, `r6.json`, `r6.stdout` |

## VERDICT: **still reproduces** (doc drift).

---

## The doc

`docs/content/docs/(docs)/feature-guides/main-tab.mdx:35-43`, verbatim at this SHA:

> ## Traffic Sources
>
> See where your traffic comes from:
> - **Direct** - Typed URL or bookmarks
> - **Search** - Google, Bing, DuckDuckGo, etc.
> - **Social** - Twitter, Facebook, LinkedIn, Reddit
> - **Referral** - Other websites
>
> Click any source to filter the entire dashboard to that traffic.

## The code, re-read at `64f8c4fb`

`server/src/services/tracker/getChannel.ts` returns the GA4 names, and neither bare
`Search` nor bare `Social` is among them:

```
23:    return { type: "Organic Social", isPaid: false };
35:    return { type: "Organic Search", isPaid: false };
173:    return selfReferral ? "Internal" : "Direct";
202:        return "Paid Search";
238:      return "Organic Search";
240:      return "Organic Social";
260:      return "Organic Social";
266:      return "Referral";
294:    return "Referral";
```

---

## PROBE — one visit from a Google search, one from Twitter

```
site 34
track acks: 200 {"success":true} | 200 {"success":true}

GET /api/sites/34/metric?parameter=channel
  -> 200 {"data":{"data":[{"value":"Organic Search","count":1,"percentage":50,"pageviews":1,…},
                          {"value":"Organic Social","count":1,"percentage":50,"pageviews":1,…}],"totalCount":2}}

clickhouse rows (channel / referrer):
  Organic Search	https://www.google.com/search?q=rybbit
  Organic Social	https://twitter.com/someone/status/1
```

## PROBE / CONTROL — following the doc's instruction literally

The doc says "Click any source to filter the entire dashboard to that traffic." The
filter is `?filters=[{"parameter":"channel","type":"equals","value":["<name>"]}]` on
`/overview`. The documented names are the probe; the stored names are the control.

```
  filter channel == "Search"           -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Social"           -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Organic Search"   -> 200 sessions=1 pageviews=1 users=1
  filter channel == "Organic Social"   -> 200 sessions=1 pageviews=1 users=1
  filter channel == "Referral"         -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Direct"           -> 200 sessions=0 pageviews=0 users=0
```

Two of the doc's four names match nothing. Followed literally, the documented
instruction narrows the dashboard to zero.

## Change from the hand-verification

None.
