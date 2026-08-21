# Independent hand-verification — Rybbit product findings, 2026-08-21

Every claim below was re-proved from scratch against a **clean, isolated instance**
of `rybbit-io/rybbit` at `613cd0153c77e4fcd32235dd051f44257368b6e8`, by an agent
that did not run the corpus and did not reuse the corpus's stack, database or
account. Each finding gets a PROBE and a CONTROL, with verbatim request/response
text, and each cited mechanism was re-read at this SHA (stale cites are corrected
in place below; `findings.md` and `run-classification.md` were **not** edited).

Nothing in the Rybbit source was modified. Nothing was created, commented or
reacted to on GitHub.

---

## Cross-reference — corpus scenarios and upstream issues/PRs

Scenario ids and failing steps are from the converged board
(`run-classification.md` §3); upstream states were re-checked read-only on
2026-08-21 (`gh api` / `gh search`, nothing created or commented).

| finding | corpus scenario (failing step) | upstream (rybbit-io/rybbit) |
| --- | --- | --- |
| **F5** site creation never invalidates `sitesAccessCache` | 10 reds — step 2: `a-custom-event-goal-counts-only-its-own-event.api.1`, `a-goal-follows-the-dashboards-range-and-filters.api.1`, `a-goal-narrowed-by-an-event-property.api.1`, `a-page-goal-counts-the-sessions-that-reached-its-path.api.1`, `a-page-goal-pattern-matches-one-segment-or-many.api.1`, `an-incomplete-goal-is-refused.api.1`, `six-goal-types-and-six-funnel-step-types.api.1`, `a-funnel-refuses-fewer-than-two-steps.api.1`; step 3: `an-excluded-path-is-accepted-but-never-stored.api.1`, `ip-exclusions-in-every-supported-format.api.1` (per §1.4, these two 403 on the `excluded-*` GET, not the PUT) | issue [#980](https://github.com/rybbit-io/rybbit/issues/980) **closed "completed" 2026-05-22** — confirmed NOT fixed at this SHA (§1). No reopening or fix PR exists |
| **F6** whole-second timestamps + strict ordering | 6 reds: `a-two-step-funnel-reports-its-conversion-and-its-dropoff.api.1` (10), `a-custom-event-funnel-step-matches-by-name.api.1` (7), `a-funnel-step-can-be-labelled-and-narrowed.api.1` (8), `the-sessions-behind-a-funnel-step.api.1` (8), `entry-and-exit-pages-of-a-two-page-visit.api.1` (7), `a-goal-card-and-the-sessions-that-converted-it.web.1` (8) | **unreported** |
| **F7** docs name channels `Search`/`Social`; stored values are `Organic Search`/`Organic Social` | `a-filter-narrows-the-whole-dashboard.api.1` (7) | **unreported** |
| **F8** Pages tab drops untitled pageviews | no board red — `the-pages-tab-lists-every-path-it-has-seen.web.1` passes only because the seed supplies titles | **unreported** |
| **F10** `/api/track` acks before the event is queryable | no board red — it is why seven scenarios carry a polled-GET precondition step | **unreported** |
| **F11** "Today" window hides the current second | no stable red — ~1 red per few boards across the four web date-range readers (deterministic when phase-parked, §6) | **unreported** |
| deliberate red — no Bounce status on the session list | `the-session-list-has-no-bounce-status.web.1` (7) | **unreported** |
| deliberate red — undocumented exclusion kind still blocks | `an-undocumented-exclusion-kind-still-blocks.api.1` (3) | **unreported** (the doc list also omits ASN, §8) |
| deliberate red — journeys are pageviews-only | `journeys-render-the-paths-visitors-walk.api.1` (11) | **unreported** (open journeys issues #540/#770/#784 are unrelated) |
| deliberate red — lowercase country code refused, not normalised | `country-exclusion-cannot-reach-a-private-address.api.1` (5) | **unreported** |

Adjacent closed issues, recorded so they are not re-searched:
[#858](https://github.com/rybbit-io/rybbit/issues/858) (API-key rate limit 403
vs 429 — not exercised by this corpus),
[#939](https://github.com/rybbit-io/rybbit/issues/939) (500 on missing `page`
param — the corpus always sends it),
[#1031](https://github.com/rybbit-io/rybbit/issues/1031) (autocapture events as
goal/funnel targets — the corpus uses `page`/`event` steps only).

---

## Setup

| | |
|---|---|
| checkout | `/Users/smat/projects/work/inconcept-labs/github/truecourse-ai/pr-benchmark/rybbit`, `git log -1` = `613cd0153c77e4fcd32235dd051f44257368b6e8` |
| compose project | **`tcverify-rybbit`** (a copy of `reference/seed/compose.yml` in scratch, `name:` changed, ports moved, own volumes) |
| corpus project `tc-rybbit` | **never started.** All six of its containers were `Exited` before this session and were left `Exited`. Its volumes were never mounted. |
| host ports | clickhouse `127.0.0.1:14823`, postgres `14832`, redis `14839`, backend `14801`, client `14802` — the 148xx block, all confirmed free with `lsof` before boot |
| images | the already-built `tc-rybbit-backend:latest` / `tc-rybbit-client:latest` (built from `server/Dockerfile` and `client/Dockerfile` at this SHA). Used **read-only**: nothing was rebuilt, retagged or removed. This is why the stack booted in 23 s rather than 9 min. |
| env | identical to the corpus recipe, except `BASE_URL=http://127.0.0.1:14801`. `CLUSTER_WORKERS=0`, `DISABLE_SIGNUP=false`, `DISABLE_TELEMETRY=true`. |
| seed | `reference/seed/guard-seed.mjs`, unmodified, pointed at `RYBBIT_BACKEND_ORIGIN=http://127.0.0.1:14801`. Created `guard-owner@rybbit.test` and organization `tcref-guard` = `8Tfzc2VSvhFVvvB0pDI77yeGAUbKdfNA` on a virgin database. |
| access | every probe went through the backend's published port directly; no front proxy, since these are api-only probes and the `Origin` rewrite of `guard-front.mjs` is not needed when the caller sends `BASE_URL` as its own `Origin`. |

**One environment fact that turned out to be load-bearing, and that the corpus
notes do not record:** the seeded owner is the FIRST user in a fresh database, and
`server/src/lib/auth.ts:358-360` promotes the first user to `role: "admin"` —

```ts
// If this is the first user, make them an admin
await db.update(user).set({ role: "admin" }).where(eq(user.id, users[0].id));
```

```
$ docker exec tcverify-rybbit-postgres-1 psql -U frog -d analytics -c 'select id,email,role from "user";'
                id                |          email          | role
----------------------------------+-------------------------+-------
 y0bgCaJ8J82BTbkvV4Ffz6UojKoZD6Dc | guard-owner@rybbit.test | admin
```

That matters for F5 — see §1.3.

---

## 1. F5 — site creation does not invalidate `sitesAccessCache`

### VERDICT: **CONFIRMED** (and upstream #980 is *not* fixed at this SHA). One cite in `run-classification.md` is wrong; see §1.4.

### 1.1 Mechanism, re-read at this SHA

`server/src/lib/auth-utils.ts:122-126` — cite **correct**:

```ts
const sitesAccessCache = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
  useClones: false, // Don't clone objects for better performance with promises
});
```

`getSitesUserHasAccessTo(req, adminOnly = false)` (`:152`) caches under
`` `${userId}:${adminOnly}` `` (`:169`), reads at `:171`, writes at `:291`.
`invalidateSitesAccessCache` is `:297-300`.

The complete caller set of `invalidateSitesAccessCache` at this SHA
(`grep -rn` over `server/src`, tests excluded):

```
server/src/lib/auth.ts:180                       member removal
server/src/lib/auth.ts:566                       (auth hook)
server/src/lib/auth.ts:589                       (auth hook)
server/src/api/memberAccess/updateMemberSiteAccess.ts:86
server/src/api/sites/applySiteMove.ts:35
server/src/api/teams/createTeam.ts:97
server/src/api/teams/updateTeam.ts:114
server/src/api/teams/deleteTeam.ts:38
```

`server/src/api/sites/addSite.ts` — the handler behind
`POST /organizations/:organizationId/sites` (`server/src/index.ts:470`) — does not
import it and does not call it. `siteConfigurationLifecycle.ts` calls
`siteConfig.invalidate(site)` (`:347`, `:364`, `:384`), which is a *different*
cache (the per-site config cache of F3), not the sites-access cache.

**So findings.md's diagnosis is exact, and the fix upstream #980 was closed
"COMPLETED" for is still absent.** The corpus notes add three extra callers
(teams) that findings.md's prose does not list; none of them is the creation path,
so the conclusion is unchanged.

### 1.2 Probe and control — the `${userId}:false` key (goals, funnels, exclusion reads)

`requireSiteAccess` (`server/src/lib/auth-middleware.ts:194`) →
`getUserHasAccessToSite` (`auth-utils.ts:483-486`) → `getSitesUserHasAccessTo(req)`
→ key `` `${userId}:false` ``. This guards `POST /sites/:id/goals`,
`POST /sites/:id/funnels`, and every `GET /sites/:id/excluded-*`.

```
--- idle 16 s so both cache keys expire ---
[ 16118ms] create site A
    POST /api/organizations/8Tfzc.../sites
    -> 201 {"id":"a4d584418a63","siteId":4,"name":"tcref-f5a-b27aa4d8",…}
[ 16137ms] goal on A (warms userId:false)
    POST /api/sites/4/goals
    -> 201 {"success":true,"goalId":1}
[ 16149ms] PUT config on A (warms userId:true)
    PUT /api/sites/4/config
    -> 200 {"success":true,"message":"Site configuration updated successfully",…}
[ 16158ms] create site B
    POST /api/organizations/8Tfzc.../sites
    -> 201 {"id":"adcce583974e","siteId":5,"name":"tcref-f5b-b27aa4d8",…}
[ 16163ms] PROBE goal on B (immediate)
    POST /api/sites/5/goals
    -> 403 {"error":"Forbidden"}
[ 16169ms] PROBE funnel on B (immediate)
    POST /api/sites/5/funnels
    -> 403 {"error":"Forbidden"}
```

CONTROL — nothing changed but the clock:

```
--- CONTROL A: idle 16 s (stdTTL 15) then repeat, nothing else changed ---
[ 32233ms] CONTROL goal on B (after 16 s)
    POST /api/sites/5/goals
    -> 201 {"success":true,"goalId":2}
[ 32244ms] CONTROL funnel on B (after 16 s)
    POST /api/sites/5/funnels
    -> 201 {"success":true,"funnelId":2}
```

And the same on the READ side, which is what the corpus's exclusion scenarios
actually fail on:

```
[ 16089ms] create site A ... siteId 6
[ 16103ms] GET excluded-paths on A (warms userId:false)
    GET /api/sites/6/excluded-paths          -> 200 {"success":true,"excludedPaths":[]}
[ 16111ms] create site B ... siteId 7
[ 16121ms] PUT config on B (admin path, immediate)
    PUT /api/sites/7/config                  -> 200 {"success":true,…"excludedPaths":["/admin/*"]…}
[ 16125ms] PROBE GET excluded-paths on B (immediate)
    GET /api/sites/7/excluded-paths          -> 403 {"error":"Forbidden"}

--- CONTROL: idle 16 s, same GET ---
[ 32152ms] CONTROL GET excluded-paths on B (after 16 s)
    GET /api/sites/7/excluded-paths          -> 200 {"success":true,"excludedPaths":["/admin/*"]}
```

The write at `+16121 ms` succeeded and the read of that same write at `+16125 ms`
was Forbidden — four milliseconds apart, same cookie, same site.

### 1.3 Probe and control — the `${userId}:true` key (PUT /config), and why the owner is exempt

`requireSiteAdminAccess` (`auth-middleware.ts:234`) checks **`getIsUserAdmin`
first** (`:252-257`) and returns early for a better-auth system admin, *before*
reaching `getUserHasAdminAccessToSite` (`auth-utils.ts:488-491`) and therefore
before touching the cache at all. The seeded owner is a system admin (see Setup),
so `PUT /sites/:id/config` can never 403 for it — which is exactly what §1.2's
transcript shows at `+16121 ms`.

To prove the admin-side key has the same defect, a SECOND account was signed up
(so `auth.ts`'s first-user promotion misses it — the response shows `"role":"user"`)
and given its own organization, where it is org owner but not a system admin:

```
[ 32252ms] sign up a second user
    POST /api/auth/sign-up/email
    -> 200 {"token":"mDwe…","user":{…,"email":"tcverify-second-fdb33835@rybbit.test",…,"role":"user",…}}
[ 48333ms] user2 creates site C           -> 201  siteId 8
[ 48353ms] user2 PUT config on C (warms userId:true)
    PUT /api/sites/8/config                -> 200 {"success":true,…}
[ 48362ms] user2 creates site D           -> 201  siteId 9
[ 48367ms] PROBE user2 PUT config on D (immediate)
    PUT /api/sites/9/config                -> 403 {"error":"Forbidden"}

--- CONTROL: idle 16 s, same PUT ---
[ 64430ms] CONTROL user2 PUT config on D (after 16 s)
    PUT /api/sites/9/config                -> 200 {"success":true,…}
```

**Both cache keys carry the bug.** The system-admin short-circuit is the only
reason the corpus's own owner never sees the admin half.

### 1.4 Correction to `run-classification.md` rows 9 and 10

Rows 9 (`an-excluded-path-is-accepted-but-never-stored.api.1`) and 10
(`ip-exclusions-in-every-supported-format.api.1`) are described as
"`PUT /sites/{new}/config` → 403". That is not what those scenarios do. Step 2 of
each is the PUT, and it **succeeds** (the owner is a system admin); step 3 — the
step the board records as failing — is

```yaml
- request:
    method: GET
    path: /api/sites/${siteId}/excluded-paths
```

which is `authSitesRead` = `requireSiteAccess` = the `${userId}:false` key. The
class (BUG / F5) and the bucket size (10) are unaffected; only the named request
is wrong. §1.2's second transcript is the corrected repro.

### 1.5 Scope note

`GET /sites/:id/goals` answered `200 {"data":[],…}` on the just-created site in the
same breath as the 403s, because that route is `publicGoalsRead` →
`allowPublicSiteAccess`, which falls through to the site's `public: true` flag. So
the blast radius is the authenticated site-scoped surface, not every read.

---

## 2. F6 — whole-second timestamps + strict ordering

### VERDICT: **CONFIRMED**, both halves. One cite off by one line.

### 2.1 Mechanism, re-read at this SHA

1. The stored column is whole seconds. `server/src/db/clickhouse/schema/core.ts:89`
   — cite **correct**: `timestamp DateTime,`. The value is server-stamped and
   truncated on the way in: `server/src/services/tracker/utils.ts:152`
   (`timestamp: trackingRequest.receivedAt.toISOString()`) then
   `server/src/services/tracker/pageviewQueue.ts:83`
   (`DateTime.fromISO(pv.timestamp).toFormat("yyyy-MM-dd HH:mm:ss")`). `/api/track`
   accepts no timestamp field of any kind.
2. The funnel advances on a STRICT inequality.
   `server/src/api/analytics/funnels/getFunnel.ts:71` — cite **correct**:
   `sa.timestamp > s${index + 1}.step_time`.
3. Entry/exit page has nothing to break a tie with.
   `server/src/api/analytics/getMetric.ts` — the `entry_page`/`exit_page` branch is
   `:170-171`, and the ordering is
   `row_number() OVER (PARTITION BY session_id ORDER BY timestamp ${orderDirection}) as row_num`
   at **`:206`**, not `:205` (`:205` is the `leadInFrame` line above it). Off by one;
   everything else in the cite holds.

### 2.2 Funnel — probe and control

Both cases park just after a wall-clock second boundary before the burst, so the
events cannot straddle a second by accident. ClickHouse was queried directly for
the stored timestamps, so "same second" is read, not inferred.

PROBE, two visitors, `/cart` then `/checkout` with **no** gap:

```
site 10
  track acks: 200 {"success":true} | 200 {"success":true} | 200 {"success":true} | 200 {"success":true}
  clickhouse rows (pathname / timestamp / session):
      /cart       2026-08-20 22:19:05  C6zBnYUPILaRcN
      /cart       2026-08-20 22:19:05  KMYOsWeldyaazT
      /checkout   2026-08-20 22:19:05  C6zBnYUPILaRcN
      /checkout   2026-08-20 22:19:05  KMYOsWeldyaazT
  POST /api/sites/10/funnels/analyze
    -> 200 {"data":[{"step_number":1,"step_name":"Cart","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2},
                    {"step_number":2,"step_name":"Checkout","sessions":0,"conversion_rate":0,"dropoff_rate":100,"visitors":0}]}
```

CONTROL, identical in every other respect, 1500 ms between the two paths:

```
site 11
  clickhouse rows:
      /cart       2026-08-20 22:19:06  rLhc2AET9NvRBI
      /cart       2026-08-20 22:19:06  TGb7f36nxOUT86
      /checkout   2026-08-20 22:19:07  rLhc2AET9NvRBI
      /checkout   2026-08-20 22:19:07  TGb7f36nxOUT86
  POST /api/sites/11/funnels/analyze
    -> 200 {"data":[{"step_number":1,…"sessions":2,…},
                    {"step_number":2,"step_name":"Checkout","sessions":2,"conversion_rate":100,"dropoff_rate":0,"visitors":2}]}
```

Two sessions that demonstrably visited both paths convert 0% when the visits share
a second and 100% when they are one second apart.

### 2.3 Entry/exit page — probe and control

PROBE, one visitor, `/blog/article` then `/checkout`, no gap:

```
site 12
  clickhouse rows:
      /blog/article  2026-08-20 22:19:08  toytcZ_AeLqS3u
      /checkout      2026-08-20 22:19:08  toytcZ_AeLqS3u
  GET /api/sites/12/metric?parameter=entry_page -> 200 {"data":{"data":[{"value":"/blog/article",…}],"totalCount":1}}
  GET /api/sites/12/metric?parameter=exit_page  -> 200 {"data":{"data":[{"value":"/blog/article",…}],"totalCount":1}}
```

CONTROL, same two pageviews 2000 ms apart:

```
site 13
  clickhouse rows:
      /blog/article  2026-08-20 22:19:09  Rz5A6ZP_rF-7Ud
      /checkout      2026-08-20 22:19:11  Rz5A6ZP_rF-7Ud
  GET /api/sites/13/metric?parameter=entry_page -> 200 {"data":{"data":[{"value":"/blog/article",…,"time_on_page_seconds":2,…}],"totalCount":1}}
  GET /api/sites/13/metric?parameter=exit_page  -> 200 {"data":{"data":[{"value":"/checkout",…}],"totalCount":1}}
```

The exit page of a two-page visit is its entry page whenever the two pageviews tie.

---

## 3. F7 — the docs' channel names are not the stored values

### VERDICT: **CONFIRMED (doc drift).** Cite corrected: the doc lines are 35-43, not 37-43.

### 3.1 The doc

`docs/content/docs/(docs)/feature-guides/main-tab.mdx:35-43`:

> ## Traffic Sources
>
> See where your traffic comes from:
> - **Direct** - Typed URL or bookmarks
> - **Search** - Google, Bing, DuckDuckGo, etc.
> - **Social** - Twitter, Facebook, LinkedIn, Reddit
> - **Referral** - Other websites
>
> Click any source to filter the entire dashboard to that traffic.

(`Direct` is `:38`, `Search` `:39`, `Social` `:40`, `Referral` `:41`, and the
"Click any source to filter" instruction `:43`.)

### 3.2 The code

`server/src/services/tracker/getChannel.ts` returns the GA4 names —
`"Organic Search"` at `:238` (and `:35`), `"Organic Social"` at `:240`, `:260`,
`:289`, `"Paid Search"` at `:202`, `:222`, `"Referral"` at `:266`, `:294`,
`"Direct"` at `:173`, `:193`. `server/src/api/analytics/utils/eventSchema.ts:16`
enumerates the stored set, and **neither `Search` nor `Social` appears in it**.

### 3.3 Probe and control

One visit from a Google search, one from Twitter:

```
site 14
track acks: 200 {"success":true} | 200 {"success":true}
GET /api/sites/14/metric?parameter=channel
  -> 200 {"data":{"data":[{"value":"Organic Search","count":1,"percentage":50,…},
                          {"value":"Organic Social","count":1,"percentage":50,…}],"totalCount":2}}

  filter channel == "Search"           -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Social"           -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Organic Search"   -> 200 sessions=1 pageviews=1 users=1
  filter channel == "Organic Social"   -> 200 sessions=1 pageviews=1 users=1
  filter channel == "Referral"         -> 200 sessions=0 pageviews=0 users=0
  filter channel == "Direct"           -> 200 sessions=0 pageviews=0 users=0
```

The doc's instruction, followed literally, narrows the dashboard to nothing. Two
of its four names are wrong.

---

## 4. F8 — the Pages tab drops pageviews with no `page_title`

### VERDICT: **CONFIRMED.** Cites correct.

### 4.1 The doc

`docs/content/docs/(docs)/feature-guides/pages-tab.mdx:8`:

> The Pages tab shows detailed analytics for every URL on your site.

### 4.2 The code

The tab's data comes from `useGetPageTitlesPaginated` (`client/src/app/[site]/pages/components/PagesTable.tsx:101`,
imported `:16`) → `GET /api/sites/:siteId/page-titles`, whose query filters
`server/src/api/analytics/getPageTitles.ts:72-73` — cite **correct**:

```sql
          AND page_title IS NOT NULL
          AND page_title <> ''
```

The path is rendered only as the row's subtitle (`PagesTable.tsx:155-156`), never
as the key.

### 4.3 Probe and control

One titled pageview, one untitled, same site, same second:

```
site 15
track acks: 200 {"success":true} | 200 {"success":true}

PROBE   GET /api/sites/15/page-titles
  -> 200 {"data":[{"value":"Pricing","pathname":"/pricing","count":1,"percentage":100,"pageviews":1,…}]}     (1 row)

CONTROL GET /api/sites/15/metric?parameter=pathname
  -> 200 {"data":{"data":[{"value":"/docs/getting-started",…,"pageviews":1,…},
                          {"value":"/pricing",…,"pageviews":1,…}],"totalCount":2}}                          (2 rows)

CONTROL GET /api/sites/15/overview
  -> 200 {"data":{"sessions":2,…,"pageviews":2,"users":2}}

clickhouse rows (pathname / page_title / timestamp):
/docs/getting-started		2026-08-20 22:20:12
/pricing	Pricing	2026-08-20 22:20:12
```

The untitled pageview is stored, is counted in the overview and appears in the
pathname dimension; it is invisible on the tab whose subject it is.

---

## 5. F10 — `/api/track` acknowledges before the event is queryable

### VERDICT: **CONFIRMED and measured.** Cites correct. The magnitude is bounded by the flush interval, so "~1 s" is the ceiling, not the typical value.

### 5.1 Mechanism

`server/src/services/tracker/pageviewQueue.ts:15-16` — cite **correct**:

```ts
const PAGEVIEW_BATCH_SIZE = 5000;
const PAGEVIEW_FLUSH_INTERVAL_MS = 1000;
```

Used as `batchSize` (`:28`) and `interval` (`:29`). `{"success":true}` means
queued.

### 5.2 Measurement, 12 rounds, random phase

Each round: a fresh site, a random 0-1000 ms delay to decorrelate from the queue's
own interval timer, one `POST /api/track`, then an immediate read followed by a
25 ms poll of `GET /overview?past_minutes_start=5&past_minutes_end=0`.

```
round 8 site 31: POST /api/track -> 200 {"success":true} @T+0
   GET overview @T+17 ms -> 200 {"data":{"sessions":0,"pages_per_session":null,"bounce_rate":null,"session_duration":null,"pageviews":0,"users":0}}
   first non-zero read @T+260 ms
round 11 site 34: POST /api/track -> 200 {"success":true} @T+0
   GET overview @T+10 ms -> 200 {"data":{"sessions":0,…,"pageviews":0,"users":0}}
   first non-zero read @T+972 ms

=== F10 SUMMARY over 12 rounds ===
ack -> queryable, sorted: 30, 81, 184, 260, 300, 494, 555, 687, 702, 760, 939, 972 ms
min 30 ms · median 555 ms · max 972 ms
```

**12 of 12** immediate read-backs (issued 10-24 ms after the 200) answered
`pageviews: 0`. The window is uniform across the 1000 ms interval, exactly as the
mechanism predicts. Nothing in `docs/content/docs/api/` or the tracking guides
names a consistency window.

Nuance worth recording: in the F11 probe, where every round was aligned to just
after a second boundary, the same measurement clustered at 78-286 ms (with one
1102 ms outlier). That is not a different behaviour — it is the queue's fixed-phase
interval timer beating against a fixed-phase caller. Measure F10 at random phase or
the spread is understated.

---

## 6. F11 — a "Today" window hides events stamped in the current second

### VERDICT: **CONFIRMED — reproduced live, 7 of 8 rounds**, with gaps up to 934 ms. Cite corrected: the block is `:283-302`, not `:288-300`.

### 6.1 Mechanism, re-read at this SHA

`server/src/api/analytics/utils/timeWindow.ts`, `whereClause`, `case "date"` at
`:283-302`:

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

The strict `<` is at `:291` and `toTimeZone(now(), 'UTC')` at `:295`. Both sides
are whole seconds (`events.timestamp` is `DateTime`, §2.1; ClickHouse `now()` is
too). Four lines below, `case "pastMinutes"` (`:307-308`) is INCLUSIVE:

```ts
      return `AND ${column} > toDateTime(${SqlString.escape(window.start)}, 'UTC') AND ${column} <= toDateTime(${SqlString.escape(window.end)}, 'UTC')`;
```

So the two windows disagree about the current second, by construction.

### 6.2 Reproduction

The corpus reports this as a ~1-in-20 flake with a 100-250 ms gap. **It is
reproducible on demand**: park just after a second boundary before tracking, so
the event is stamped early in its second and the strict bound has most of that
second left to hide it. Then poll both windows in parallel every 40 ms from the
moment of the ack.

```
round 1 site 16: ack=200 {"success":true} (17 ms, stamped +47 ms into its second) | past_minutes visible at 286 ms | date_range visible at 1008 ms | gap 722 ms
  DIVERGENT at +286 ms:
    GET /api/sites/16/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"dLPMA5mpQWiPXK","user_id":"0d19814f4616",…}
    GET /api/sites/16/sessions?start_date=2026-08-20&end_date=2026-08-20&time_zone=UTC
      -> 200 {"data":[]}

round 6 site 21: ack=200 {"success":true} (12 ms, stamped +42 ms into its second) | past_minutes visible at 84 ms | date_range visible at 1018 ms | gap 934 ms
  DIVERGENT at +84 ms:
    GET /api/sites/21/sessions?time_zone=UTC&past_minutes_start=5&past_minutes_end=0
      -> 200 {"data":[{"session_id":"Pxwi01-dbqpMmz","user_id":"f00f83ccd20a",…}
    GET /api/sites/21/sessions?start_date=2026-08-20&end_date=2026-08-20&time_zone=UTC
      -> 200 {"data":[]}
```

Full board:

| round | stamped at +ms into its second | past_minutes visible | date_range visible | gap |
|---:|---:|---:|---:|---:|
| 1 | 47 | 286 ms | 1008 ms | **722 ms** |
| 2 | 64 | 210 ms | 967 ms | **757 ms** |
| 3 | 67 | 1102 ms | 1103 ms | 1 ms |
| 4 | 49 | 136 ms | 1018 ms | **882 ms** |
| 5 | 53 | 112 ms | 1020 ms | **908 ms** |
| 6 | 42 | 84 ms | 1018 ms | **934 ms** |
| 7 | 39 | 78 ms | 1008 ms | **930 ms** |
| 8 | 47 | 80 ms | 1002 ms | **922 ms** |

**7 of 8 rounds** had a real interval in which one surface held the session and the
other returned `{"data":[]}`. Round 3 is the negative control the mechanism
predicts: its flush landed at +1102 ms, i.e. in the NEXT second, so by the time the
row existed the strict bound had already moved past it and both windows agreed
within 1 ms.

The corpus's 100-250 ms figure and 1-in-20 rate are what an unaligned browser
sees; the ceiling is the remainder of the second, and it is nearly a full second
when the event is stamped early in one.

**This upgrades the finding's practical severity.** It is not a rare flake; it is a
deterministic consequence of when the event lands, and any caller that tracks and
then opens a date-range surface within the same second sees an empty board.

---

## 7. Deliberate red — the Sessions list has no Bounce status

### VERDICT: **CONFIRMED, both halves** (doc wrong, product self-consistent).

### 7.1 The doc

`docs/content/docs/(docs)/feature-guides/sessions.mdx:10-18`, "Each session
displays:" …

> - **Bounce Status** - Whether the user left after one page

### 7.2 The API

`GetSessionsResponse` (`server/src/api/analytics/sessions/getSessions.ts:10-51`)
declares 40 fields and no bounce field of any name; `grep -i bounce` over that file
returns nothing.

Live, with one genuine bounce (a single-pageview visit) and one two-page visit on
the same site:

```
GET /api/sites/36/sessions -> 200
  2 session rows. Keys of row 0:
    ["session_id","user_id","identified_user_id","country","region","city","language","device_type",
     "browser","browser_version","operating_system","operating_system_version","screen_width","screen_height",
     "referrer","channel","hostname","utm_source","utm_medium","utm_campaign","utm_term","utm_content",
     "session_end","session_start","session_duration","entry_page","exit_page","pageviews","events","errors",
     "outbound","button_clicks","copies","form_submits","input_changes","ip","lat","lon","tag","timezone",
     "has_replay","traits"]
  any key matching /bounc/i: []
  whole response contains the substring "bounc": false
  row: entry=/first     exit=/second    pageviews=2 events=0
  row: entry=/only-page exit=/only-page pageviews=1 events=0
```

CONTROL — the bounce *metric* does exist, so this is a missing per-session field,
not a missing feature:

```
GET /api/sites/36/overview
  -> 200 {"data":{"sessions":2,"pages_per_session":1.5,"bounce_rate":50,"session_duration":0.5,"pageviews":3,"users":2}}
```

The response shape is decisive; no browser check was needed. A reader can derive
"bounced" from `pageviews == 1`, but the product ships no such status and the
Sessions tab renders none.

*(Aside, not part of any finding: the live rows carry `tag` and `timezone`, which
`GetSessionsResponse` does not declare, and omit the declared `page_title` and
`querystring`. The type and the payload have drifted apart. Recorded here only
because it was observed while checking this one.)*

---

## 8. Deliberate red — an undocumented exclusion kind still blocks

### VERDICT: **CONFIRMED, both halves.** The doc omits TWO kinds, not one.

### 8.1 The doc

`docs/content/docs/(docs)/filter-traffic.mdx:120-130`:

> ## How Filters Are Evaluated
>
> Rybbit checks exclusions in this order:
>
> 1. IP address
> 2. Country
> 3. Path
> 4. Hostname
> 5. User agent
>
> If any filter matches, the event is accepted with a `200` response but is not tracked.

### 8.2 The code

`server/src/services/sites/siteExclusionDecision.ts` evaluates **seven** kinds:
IP (`:167`), **ASN** (`:171-183`), country (`:185-195`), path (`:199`),
**query param** (`:203-208`), hostname (`:210`), user agent (`:214-223`).

```ts
  if (querystring && configuration.excludedQueryParams.length > 0) {
    const matchedParam = matchesQueryParams(querystring, configuration.excludedQueryParams);
    if (matchedParam) {
      return excluded("query_param", "query param", matchedParam);
    }
  }
```

Neither `filter-traffic.mdx` nor `site-settings.mdx` mentions query-parameter
exclusions anywhere (`grep -rn -i "query param"` over both returns nothing), nor
ASN exclusions in that list.

### 8.3 Probe and control

```
[ 1812ms] declare a QUERY PARAM exclusion
    PUT /api/sites/37/config    -> 200 {"success":true,"message":"Site configuration updated successfully",…}
[ 1821ms] read it back
    GET /api/sites/37/excluded-query-params -> 200 {"success":true,"excludedQueryParams":["preview"]}

PROBE   POST /api/track  (querystring "?preview=1")
    -> 200 {"success":true,"message":"Event not tracked - query param excluded"}

CONTROL POST /api/track  (querystring "?utm_source=x")
    -> 200 {"success":true}
```

The exclusion behaves exactly as the doc's *closing sentence* promises (200,
untracked) for a kind the doc's own list does not name.

---

## 9. Deliberate red — journeys are pageviews-only

### VERDICT: **CONFIRMED, both halves.**

### 9.1 The doc

`docs/content/docs/(docs)/feature-guides/journeys.mdx:12-13`:

> ### Nodes
> Each bar represents a page or event. Its height indicates how many users reached that point.

### 9.2 The code

`server/src/api/analytics/getJourneys.ts:74` filters the session's actions to
`AND type = 'pageview'`. Nine event types exist; eight of them can never be a node.

### 9.3 Probe and control

One session: `/start` → custom event `signup_clicked` → `/middle` → `/end`, each
1.2 s apart so ordering is unambiguous (§2).

```
track acks: 200 {"success":true} | 200 {"success":true} | 200 {"success":true} | 200 {"success":true}

CONTROL the custom event IS stored
    GET /api/sites/38/events/names -> 200 {"data":[{"eventName":"signup_clicked","count":1}]}

PROBE the journeys surface
    GET /api/sites/38/journeys?steps=4
      -> 200 {"journeys":[{"path":["/start","/middle","/end"],"count":1,"percentage":100}]}
```

The event was ingested, is queryable, and sits between two pages of the walk. It is
absent from the journey.

---

## 10. Deliberate red — a lowercase country code is refused, not normalised

### VERDICT: **CONFIRMED, both halves.** The doc that makes the promise is `filter-traffic.mdx:48`, not `site-settings.mdx`.

### 10.1 The doc

`docs/content/docs/(docs)/filter-traffic.mdx:48`, closing the § Country Exclusions
section:

> Country codes are stored as uppercase values in the dashboard and API.

("stored as uppercase" is a normalisation promise — it says what happens to what
you enter, not what you must enter.) `site-settings.mdx:89-91` — the sibling the
brief names — says only:

> ### Country Exclusions
>
> Block all traffic from specific countries using ISO country codes (e.g., `US`, `DE`, `FR`).

which neither promises nor denies normalisation. The corpus's scenario binds
`filter-traffic.mdx` § country-exclusions, which is the right doc.

### 10.2 The code

`server/src/api/sites/updateSiteConfig.ts:18-21`:

```ts
        .string()
        .trim()
        .length(2)
        .regex(/^[A-Z]{2}$/, "Country code must be a 2-letter ISO code (e.g., US, GB, CN)")
```

The write path validates uppercase and never uppercases. (The *read* path does
compare case-insensitively — `siteExclusionDecision.ts:190-191`,
`country.toUpperCase() === countryIso.toUpperCase()` — so the strictness is
purely at the boundary.)

### 10.3 Probe and control

```
CONTROL uppercase US
    PUT /api/sites/39/config              -> 200 {"success":true,…}
CONTROL read back
    GET /api/sites/39/excluded-countries  -> 200 {"success":true,"excludedCountries":["US"]}

PROBE lowercase us
    PUT /api/sites/39/config
      -> 400 {"success":false,"error":"Invalid request data","details":{"formErrors":[],
              "fieldErrors":{"excludedCountries":["Country code must be a 2-letter ISO code (e.g., US, GB, CN)"]}}}

PROBE mixed-case Us
    PUT /api/sites/39/config
      -> 400 {"success":false,…same message…}

read back after the refusals
    GET /api/sites/39/excluded-countries  -> 200 {"success":true,"excludedCountries":["US"]}
```

*(Incidental F5 sighting: the "CONTROL read back" above stamped at +17176 ms
because the probe's own retry loop had to wait out a `403 {"error":"Forbidden"}` on
a site created 10 seconds earlier — an independent, unplanned reproduction of §1.)*

---

## Verdict table

| # | finding | verdict |
|---|---|---|
| 1 | F5 sitesAccessCache not invalidated on site creation | **CONFIRMED** — both cache keys; #980 not fixed at this SHA |
| 2 | F6 whole-second timestamps + strict ordering | **CONFIRMED** — funnel half and entry/exit half |
| 3 | F7 docs name `Search`/`Social`, product stores `Organic Search`/`Organic Social` | **CONFIRMED** (doc drift) |
| 4 | F8 Pages tab drops untitled pageviews | **CONFIRMED** |
| 5 | F10 `/api/track` acks before the event is queryable | **CONFIRMED**, measured: 30-972 ms, median 555 ms, 12/12 immediate reads empty |
| 6 | F11 "Today" window hides the current second | **CONFIRMED live**, 7/8 rounds, gaps to 934 ms (corpus said PARTIAL/flaky) |
| 7 | Sessions list has no Bounce status | **CONFIRMED**, both halves |
| 8 | undocumented exclusion kind still blocks | **CONFIRMED**, both halves (two kinds undocumented, not one) |
| 9 | journeys are pageviews-only | **CONFIRMED**, both halves |
| 10 | lowercase country code refused, not normalised | **CONFIRMED**, both halves |

Ten of ten confirmed. Nothing failed to reproduce.

## Cite corrections (recorded here; `findings.md` was NOT edited)

| where | says | actually at this SHA |
|---|---|---|
| `run-classification.md` rows 9, 10 | "`PUT /sites/{new}/config` → 403" | the PUT (step 2) succeeds; step 3, `GET /sites/{id}/excluded-paths`, is the 403 |
| `findings.md` F6 | `getMetric.ts:205` for the `row_number()` tie-break | `:206` (`:205` is the `leadInFrame` line) |
| `findings.md` F7 | `main-tab.mdx:37-43` | `:35-43` (`Direct` `:38` … `Referral` `:41`, instruction `:43`) |
| `findings.md` F11 | `timeWindow.ts:288-300` | the `case "date"` block is `:283-302`; strict `<` at `:291`, `now()` at `:295`; the inclusive `pastMinutes` bound at `:307-308` |
| brief / corpus prose | lowercase-country promise attributed to `site-settings.mdx` | the promise is `filter-traffic.mdx:48`; `site-settings.mdx:89-91` is silent on normalisation |
| `findings.md` F5 | `invalidateSitesAccessCache` called "from member removal, member site-access edits and two places in `auth.ts`" | also from `applySiteMove.ts:35`, `createTeam.ts:97`, `updateTeam.ts:114`, `deleteTeam.ts:38`. None is the creation path — conclusion unchanged |

## New observations, not in the corpus

1. **F5 has two halves, keyed separately.** `${userId}:false` (goals, funnels,
   `GET /excluded-*`) and `${userId}:true` (`PUT /config`, admin site routes) are
   independent cache entries. The corpus's seeded owner is a better-auth **system
   admin** (first user, `auth.ts:358-360`), and `requireSiteAdminAccess` returns
   early for system admins *before* consulting the cache — so the corpus can never
   observe the admin half. It reproduces for any non-system-admin org owner (§1.3).
2. **F11 is deterministic, not a flake** (§6.2). Aligning the write to just after a
   second boundary reproduces it at will, with gaps up to 934 ms rather than the
   100-250 ms the corpus measured.
3. **F10 must be measured at random phase** (§5.2). A fixed-phase caller beats
   against the queue's fixed-phase interval timer and understates the window
   three-fold.
4. **`GetSessionsResponse` has drifted from the payload it types** (§7.2): the live
   rows carry `tag` and `timezone`, which the type does not declare, and omit
   `page_title` and `querystring`, which it does. Unrelated to any listed finding.

---

## Teardown

Created by this session, and nothing else:

- compose project **`tcverify-rybbit`** — 5 containers (`clickhouse`, `postgres`,
  `redis`, `backend`, `client`), 1 network, 3 volumes.
- scratch scripts under
  `/private/tmp/claude-501/…/scratchpad/rybbit-verify/` (compose copy, seed copy,
  probe scripts and their logs).

No host process was started outside Docker (no `guard-front.mjs`, no proxy, no
server). No image was built, retagged or removed. No file in the repo was modified
except this report.

Torn down with `docker compose -p tcverify-rybbit down -v`:

```
 Container tcverify-rybbit-client-1     Removed
 Container tcverify-rybbit-backend-1    Removed
 Container tcverify-rybbit-postgres-1   Removed
 Container tcverify-rybbit-redis-1      Removed
 Container tcverify-rybbit-clickhouse-1 Removed
 Volume tcverify-rybbit_clickhouse-data Removed
 Volume tcverify-rybbit_redis-data      Removed
 Volume tcverify-rybbit_postgres-data   Removed
 Network tcverify-rybbit_default        Removed
```

Verified afterwards:

```
=== containers named tcverify ===   (none)
=== volumes tcverify ===            (none)
=== networks tcverify ===           (none)
=== my ports still listening ===    14801 free · 14802 free · 14823 free · 14832 free · 14839 free
=== node procs from scratchpad ===  (none)
=== images intact (untouched) ===   tc-rybbit-backend:latest
                                    tc-rybbit-client:latest
=== tc-rybbit state ===             tc-rybbit-client-1      Exited (143) 2 hours ago
                                    tc-rybbit-backend-1     Exited (0)   2 hours ago
                                    tc-rybbit-postgres-1    Exited (0)   2 hours ago
                                    tc-rybbit-redis-1       Exited (0)   2 hours ago
                                    tc-rybbit-clickhouse-1  Exited (0)   2 hours ago
```

`tc-rybbit` was **never started**: its five containers carry the same `Exited`
timestamps after this session as before it, and its volumes were never mounted.
The two shared images survive because they were pre-existing and read-only here.
The scratch working directory was deleted after the transcripts above were
copied into this report.
