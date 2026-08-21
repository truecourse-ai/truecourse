# R1 — creating a site never invalidates `sitesAccessCache`

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:35 UTC) |
| build | `rybbit-io/rybbit` master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, working tree clean (the hand-verification ran at `613cd015`; the four commits since touch none of the files below) |
| stack | compose project `tc-rybbit` from `reference/seed/compose.yml`, images built here (`docker compose build`, 2m29s). Backend `127.0.0.1:14701`, client `:14702`, clickhouse `:14723`, postgres `:14732`, redis `:14739` |
| seed | `reference/seed/guard-seed.mjs` unmodified. Owner `guard-owner@rybbit.test`, org `lKLmCtV3I7G1PFIQP3iUQxLkNE2CRzbv` |
| raw | `r1.log`, `r1.json`, `r1.stdout` |

## VERDICT: **still reproduces** — all three halves, including the `${userId}:true` half that needs a non-system-admin account.

---

## Mechanism, re-read at `64f8c4fb`

`server/src/lib/auth-utils.ts:122-126`:

```ts
const sitesAccessCache = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
  useClones: false, // Don't clone objects for better performance with promises
});
```

Every caller of `invalidateSitesAccessCache` at this SHA (`grep -rn` over `server/src`, tests excluded):

```
server/src/lib/auth.ts:180                          member removal
server/src/lib/auth.ts:566                          (auth hook)
server/src/lib/auth.ts:589                          (auth hook)
server/src/api/memberAccess/updateMemberSiteAccess.ts:86
server/src/api/teams/createTeam.ts:97
server/src/api/teams/updateTeam.ts:114
server/src/api/teams/deleteTeam.ts:38
server/src/api/sites/applySiteMove.ts:35
```

`server/src/api/sites/addSite.ts` — the whole file was read at this SHA — imports only
`siteConfigurationLifecycle` and never calls it. **Site creation is still not on that
list.** Upstream #980, closed "completed" 2026-05-22, is not fixed at this SHA.

The environment fact that decides which half you can see: `server/src/lib/auth.ts:358-360`
promotes the first user in a fresh database to `role: "admin"`, and
`requireSiteAdminAccess` (`server/src/lib/auth-middleware.ts`) returns early for a
better-auth system admin **before** it ever consults the cache:

```ts
    // Better Auth system admins have account-wide authority and do not need
    // an admin/owner membership in the organization that owns the site.
    const isSystemAdmin = await getIsUserAdmin(request);
    if (isSystemAdmin) { ... return; }
```

Confirmed live on this instance:

```
$ docker exec tc-rybbit-postgres-1 psql -U frog -d analytics -c 'select id,email,role from "user";'
                id                |          email          | role
----------------------------------+-------------------------+-------
 qVi0orIAbDjPSreDwfr0s77yImf6VZvj | guard-owner@rybbit.test | admin

GET /api/auth/get-session -> 200 role="admin" id=qVi0orIAbDjPSreDwfr0s77yImf6VZvj
```

---

## Phase A — the `${userId}:false` key (goals, funnels). PROBE

```
--- idle 16 s so both cache halves expire ---
[  16099ms] create site A
    POST /api/organizations/lKLmCtV3I7G1PFIQP3iUQxLkNE2CRzbv/sites
    -> 201 {"id":"54dced450562","siteId":1,"name":"tcref-r1a-a11c5412",…}
[  16121ms] goal on A (warms userId:false)
    POST /api/sites/1/goals
    -> 201 {"success":true,"goalId":1}
[  16137ms] PUT config on A (warms userId:true)
    PUT /api/sites/1/config
    -> 200 {"success":true,"message":"Site configuration updated successfully",…}
[  16145ms] create site B
    POST /api/organizations/lKLmCtV3I7G1PFIQP3iUQxLkNE2CRzbv/sites
    -> 201 {"id":"4b8411bd26f2","siteId":2,"name":"tcref-r1b-a11c5412",…}
[  16150ms] PROBE goal on B (immediate)
    POST /api/sites/2/goals
    -> 403 {"error":"Forbidden"}
[  16154ms] PROBE funnel on B (immediate)
    POST /api/sites/2/funnels
    -> 403 {"error":"Forbidden"}
```

### CONTROL — nothing changed but the clock

```
--- CONTROL A: idle 16 s (stdTTL 15) then repeat, nothing else changed ---
[  47659ms] CONTROL goal on B (after 16 s)
    POST /api/sites/2/goals
    -> 201 {"success":true,"goalId":2}
[  47676ms] CONTROL funnel on B (after 16 s)
    POST /api/sites/2/funnels
    -> 201 {"success":true,"funnelId":1}
```

### The window, measured

Polling `GET /api/sites/2/excluded-paths` every 500 ms from the moment of the probe:

```
    (403 window measured on GET /api/sites/2/excluded-paths: first non-403 at +15451 ms after the probe)
```

15.45 s of Forbidden on a site the caller had just created, which is `stdTTL: 15`
plus the poll granularity.

---

## Phase B — the same key on the READ side, and the four-millisecond contradiction

```
--- idle 16 s ---
[  63696ms] create site A2                       -> 201  siteId 3
[  63708ms] GET excluded-paths on A2 (warms userId:false)
    GET /api/sites/3/excluded-paths
    -> 200 {"success":true,"excludedPaths":[]}
[  63716ms] create site B2                       -> 201  siteId 4
[  63727ms] PUT config on B2 (admin path, immediate)
    PUT /api/sites/4/config
    -> 200 {"success":true,"message":"Site configuration updated successfully",…"excludedPaths":["/admin/*"]…}
[  63731ms] PROBE GET excluded-paths on B2 (immediate)
    GET /api/sites/4/excluded-paths
    -> 403 {"error":"Forbidden"}
```

**The write succeeded and the read of that same write, 10 ms later, same cookie, same
site, was Forbidden.**

### CONTROL

```
--- CONTROL: idle 16 s, same GET ---
[  79779ms] CONTROL GET excluded-paths on B2 (after 16 s)
    GET /api/sites/4/excluded-paths
    -> 200 {"success":true,"excludedPaths":["/admin/*"]}
```

---

## Phase C — the `${userId}:true` key, proved with a SECOND non-system-admin account

The seeded owner is a system admin, so `PUT /config` can never 403 for it (Phase B,
`+63727 ms`). A second account was signed up — the first-user promotion misses it, and
the response shows `"role":"user"` — and given its own organization, where it is org
owner but not a system admin:

```
[  79937ms] sign up a second user
    POST /api/auth/sign-up/email
    -> 200 {"token":"toHsm…","user":{…,"email":"tcverify-second-a11c5412@rybbit.test",…,"role":"user",…}}
    user2 session role="user" id=fdwi2LwbkdfauaNRknK3VVQ1Z33Xeihz
[  79977ms] user2 creates its own organization
    POST /api/auth/organization/create
    -> 200 {…,"id":"rJy4NV4MS7q0ExBdkdQ7aAP1WyQ4IPFH",…}
--- idle 16 s ---
[  96048ms] user2 creates site C                  -> 201  siteId 5
[  96078ms] user2 PUT config on C (warms userId:true)
    PUT /api/sites/5/config                       -> 200 {"success":true,…}
[  96087ms] user2 creates site D                  -> 201  siteId 6
[  96094ms] PROBE user2 PUT config on D (immediate)
    PUT /api/sites/6/config                       -> 403 {"error":"Forbidden"}
```

### CONTROL

```
--- CONTROL: idle 16 s, same PUT ---
[ 112133ms] CONTROL user2 PUT config on D (after 16 s)
    PUT /api/sites/6/config                       -> 200 {"success":true,…}
```

**Both cache keys carry the defect.** The system-admin short-circuit is the only reason
an owner-seeded account never sees the admin half.

---

## Independent, unplanned sighting

The R10 probe's own read-back of a site config had to wait **10427 ms** for the same
window before `GET /api/sites/38/excluded-countries` stopped answering 403 — see
`../R10/r10.log`. R8's read-back happened to fall on a warm key and waited 11 ms.

## Result summary

```json
{
  "phaseA": {"siteA":1,"siteB":2,"probeGoal":403,"probeFunnel":403,"controlGoal":201,"controlFunnel":201,"window403Ms":15451},
  "phaseB": {"siteA2":3,"siteB2":4,"putStatus":200,"probeGet":403,"controlGet":200,"writeToReadMs":10},
  "phaseC": {"email2":"tcverify-second-a11c5412@rybbit.test","role2":"user","siteC":5,"siteD":6,"probePut":403,"controlPut":200}
}
```
