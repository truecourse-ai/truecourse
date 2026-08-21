---
finding: R1
target: rybbit-io/rybbit
route: public issue
title: "Creating a site never invalidates sitesAccessCache, so the creator gets 403 on their own new site for ~15s"
labels: "none. rybbit-io/rybbit applies no labels: both issue templates declare `labels: ''` and all 40 most recent issues carry an empty label array. No suggested-labels line is included, deliberately."
status: filed
filed_url: https://github.com/rybbit-io/rybbit/issues/1132
filed_at: 2026-08-20
reverified: "2026-08-20 live re-run against a docker compose stack built from master @ 64f8c4fb7f394bdfe9379717de8e6c21758b1ac2, all three phases plus their controls re-executed, ClickHouse and Postgres read directly; evidence in docs/findings/targets/rybbit/live/R1/repro.md and live/R1/r1.log"
format_note: "bug_report.md is a classic Markdown template, not a YAML form, and no template-enforcing workflow exists on this repo. Body matches its bold-label section shape verbatim and in template order: **Describe the bug**, **To Reproduce**, **Expected behavior**, **Screenshots**, **Desktop (please complete the following information):**. Issue 980 is referred to in plain words rather than hash-number syntax."
---

# Creating a site never invalidates sitesAccessCache, so the creator gets 403 Forbidden on their own new site for ~15s (issue 980, closed as completed, still reproduces on master)

**Describe the bug**

`POST /api/organizations/:organizationId/sites` returns `201`, and then for the next ~15 seconds the account that just created the site is refused access to it. Goals, funnels, the `excluded-*` reads, and (for an org owner who is not a system admin) the config write all answer `403 {"error":"Forbidden"}` on a site that caller owns. Nothing else changes; wait out the cache TTL and the identical request succeeds.

I measured the window at **15451 ms** on a fresh build of `master`, and in one place a config **read** answered `403` about ten milliseconds after its own successful **write** to the same site with the same cookie.

This is fail-closed, so it is a correctness and usability defect rather than a privilege escalation, and I did not route it through a security channel.

**This was reported before.** It is issue 980 (https://github.com/rybbit-io/rybbit/issues/980), closed as completed on 2026-05-22 with the comment "Will be fixed in the next version!". It still reproduces at `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, and I could not find a commit that adds invalidation to the creation path. Two readings look equally plausible from the outside: the issue was closed a little ahead of the fix, or a fix landed on a neighbouring path and this one was missed. The nearest change to the relevant files is commit `672a65c5` ("Enhance funnel and goal deletion logic with site ID validation", 2026-05-21), which lands the day before the close and does touch `auth-utils.ts` and `auth-middleware.ts`, but it adds site-id validation to `deleteFunnel`, `deleteGoal` and `updateGoal` and adds no cache invalidation on any creation path. If that was the change the close was tracking, the creation path was not covered by it. Also worth knowing: `v2.8.0` (2026-07-26) is an ancestor of the commit I tested, so the shipped release carries this too.

I filed a fresh issue rather than commenting on 980 because an outside contributor cannot reopen an issue someone else closed, and I did not want the report to sit in a closed thread. **If you would rather reopen 980 and close this one as a duplicate, please do; that is the better bookkeeping and I have no attachment to the issue number.**

The scope is also wider than 980 records. That reporter saw it on `POST /goal` and `POST /funnel`. It affects every route behind `requireSiteAccess`, including the whole `GET /sites/:id/excluded-*` family, and for any org owner who is not a better-auth system admin it also affects every route behind `requireSiteAdminAccess`.

#### What the docs promise

`docs/content/docs/api/organizations/create-site.mdx:18`, on the very endpoint involved:

> Creates a new site within an organization. Requires admin or owner role in the organization.

So you must already be an admin or an owner to reach this endpoint. And admins and owners are exactly the roles the docs say are never access-restricted. `docs/content/docs/(docs)/inviting-users.mdx:38`:

> Site access restrictions only apply to members. Admins and owners always have full access to all sites.

`docs/content/docs/(docs)/teams.mdx:22` repeats it:

> Admins and owners always have access to all sites regardless of team assignments.

And `docs/content/docs/api/getting-started.mdx:553` defines what the status code returned here is supposed to mean:

> - **403** - Forbidden (no access to site)

The caller in the transcripts below is the organization owner and the site's own creator. "No access to site" is not true of them at any point.

#### Root cause

Read at `64f8c4fb`. `server/src/lib/auth-utils.ts:122-126`:

```ts
const sitesAccessCache = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
  useClones: false, // Don't clone objects for better performance with promises
});
```

`getSitesUserHasAccessTo(req, adminOnly = false)` at `:152` keys that cache on `` `${userId}:${adminOnly}` `` (`:168`), reads it at `:171` and writes it at `:291`. `invalidateSitesAccessCache` at `:297-300` clears both halves of the key for a user:

```ts
export function invalidateSitesAccessCache(userId: string) {
  sitesAccessCache.del(`${userId}:true`);
  sitesAccessCache.del(`${userId}:false`);
}
```

`grep -rn` over `server/src` (tests excluded) gives its complete caller set at this commit, eight sites:

```
server/src/lib/auth.ts:180                          member removal
server/src/lib/auth.ts:566                          (auth hook)
server/src/lib/auth.ts:589                          (auth hook)
server/src/api/memberAccess/updateMemberSiteAccess.ts:86
server/src/api/sites/applySiteMove.ts:35
server/src/api/teams/createTeam.ts:97
server/src/api/teams/updateTeam.ts:114
server/src/api/teams/deleteTeam.ts:38
```

**Site creation is not one of them.** `server/src/api/sites/addSite.ts`, the handler behind `fastify.post("/organizations/:organizationId/sites", orgAdminSitesWrite, addSite)` at `server/src/index.ts:471`, imports only `siteConfigurationLifecycle` and never calls it. It is worth saying that `siteConfigurationLifecycle.ts` does call `siteConfig.invalidate(site)` at `:347`, `:364` and `:384`, but that is the per-site **config** cache, a different cache from the sites-access one, so creation currently invalidates nothing on the authorization path.

Adding `invalidateSitesAccessCache(createdBy)` on the creation path, the way `applySiteMove` and the three team handlers already do, looks like the whole fix, but you are better placed than I am to decide where it belongs.

#### One environment fact that decides which half of the bug you can even see

`server/src/lib/auth-middleware.ts:252-258`, inside `requireSiteAdminAccess`, returns early for a better-auth system admin **before** the cache is ever consulted:

```ts
    // Better Auth system admins have account-wide authority and do not need
    // an admin/owner membership in the organization that owns the site.
    const isSystemAdmin = await getIsUserAdmin(request);
    if (isSystemAdmin) {
      const session = await getSessionFromReq(request);
      if (session?.user) request.user = session.user;
      return;
    }
```

and `server/src/lib/auth.ts:358-360` promotes the first user in a fresh database to `role: "admin"`:

```ts
          // If this is the first user, make them an admin
          if (users.length === 1) {
            await db.update(user).set({ role: "admin" }).where(eq(user.id, users[0].id));
          }
```

So on any freshly seeded instance the obvious test account is a system admin, `PUT /sites/:id/config` can never 403 for it, and the `${userId}:true` half of the cache is invisible. That may be why a quick internal check looked green. Phase C below uses a second, deliberately non-promoted account to reach it.

**To Reproduce**

Stack: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, clean working tree, images built from the repo's own `server/Dockerfile` and `client/Dockerfile`, backend on `127.0.0.1:14701`. Virgin Postgres. Seeded owner `guard-owner@rybbit.test`, organization `lKLmCtV3I7G1PFIQP3iUQxLkNE2CRzbv`. All calls are session-cookie authenticated as that owner unless stated otherwise. Bracketed values are milliseconds since the start of the run.

Confirmed on the instance before starting, since it decides which half is observable:

```
$ docker exec ...-postgres-1 psql -U frog -d analytics -c 'select id,email,role from "user";'
                id                |          email          | role
----------------------------------+-------------------------+-------
 qVi0orIAbDjPSreDwfr0s77yImf6VZvj | guard-owner@rybbit.test | admin

GET /api/auth/get-session -> 200  role="admin"  id=qVi0orIAbDjPSreDwfr0s77yImf6VZvj
```

#### Phase A: the `${userId}:false` key (goals, funnels, exclusion reads)

1. Idle 16 seconds so both cache halves expire.
2. Create site A, then touch it once so the cache is warm and definitely holds a value that predates the next site.
3. Create site B.
4. Immediately call a site-scoped route on B.

```
--- idle 16 s so both cache halves expire ---
[  16099ms] POST /api/organizations/lKLm.../sites      -> 201 {"id":"54dced450562","siteId":1,"name":"tcref-r1a-a11c5412",…}
[  16121ms] POST /api/sites/1/goals   (warms userId:false)   -> 201 {"success":true,"goalId":1}
[  16137ms] PUT  /api/sites/1/config  (warms userId:true)    -> 200 {"success":true,"message":"Site configuration updated successfully",…}
[  16145ms] POST /api/organizations/lKLm.../sites      -> 201 {"id":"4b8411bd26f2","siteId":2,"name":"tcref-r1b-a11c5412",…}
[  16150ms] PROBE  POST /api/sites/2/goals             -> 403 {"error":"Forbidden"}
[  16154ms] PROBE  POST /api/sites/2/funnels           -> 403 {"error":"Forbidden"}
```

Control, nothing changed but the clock:

```
--- idle 16 s (stdTTL is 15) then repeat, nothing else changed ---
[  47659ms] POST /api/sites/2/goals    -> 201 {"success":true,"goalId":2}
[  47676ms] POST /api/sites/2/funnels  -> 201 {"success":true,"funnelId":1}
```

The window, measured by polling `GET /api/sites/2/excluded-paths` every 500 ms from the moment of the probe:

```
first non-403 at +15451 ms after the probe
```

15.45 seconds of `403` on a site the caller had just created, which is `stdTTL: 15` plus the poll granularity.

#### Phase B: the same key on the read side, and the sharpest single piece of evidence

```
--- idle 16 s ---
[  63696ms] POST /api/organizations/lKLm.../sites          -> 201  siteId 3
[  63708ms] GET  /api/sites/3/excluded-paths (warms key)   -> 200 {"success":true,"excludedPaths":[]}
[  63716ms] POST /api/organizations/lKLm.../sites          -> 201  siteId 4
[  63727ms] PUT  /api/sites/4/config                       -> 200 {"success":true,…"excludedPaths":["/admin/*"]…}
[  63731ms] PROBE GET /api/sites/4/excluded-paths          -> 403 {"error":"Forbidden"}
```

The write succeeded and the read of that same write was Forbidden, same cookie, same site, in the same breath. The run's own summary records the gap as `"writeToReadMs": 10`. Control:

```
--- idle 16 s, same GET ---
[  79779ms] GET /api/sites/4/excluded-paths  -> 200 {"success":true,"excludedPaths":["/admin/*"]}
```

That pair is the one I would look at first: it is the same request path disagreeing with itself milliseconds apart, with the site's own state proving the write went through.

#### Phase C: the `${userId}:true` key, which needs a non-system-admin account

The seeded owner is a system admin, so `PUT /config` short-circuits past the cache for it (see Phase B at `+63727 ms`). A second account was signed up, so the first-user promotion misses it and the response shows `"role":"user"`, then given its own organization where it is org owner but not a system admin:

```
[  79937ms] POST /api/auth/sign-up/email
            -> 200 {"token":"toHsm…","user":{…,"email":"tcverify-second-a11c5412@rybbit.test",…,"role":"user",…}}
[  79977ms] POST /api/auth/organization/create      -> 200 {…,"id":"rJy4NV4MS7q0ExBdkdQ7aAP1WyQ4IPFH",…}
--- idle 16 s ---
[  96048ms] user2 creates site C                    -> 201  siteId 5
[  96078ms] PUT /api/sites/5/config (warms userId:true)  -> 200 {"success":true,…}
[  96087ms] user2 creates site D                    -> 201  siteId 6
[  96094ms] PROBE PUT /api/sites/6/config           -> 403 {"error":"Forbidden"}

--- CONTROL: idle 16 s, same PUT ---
[ 112133ms] PUT /api/sites/6/config                 -> 200 {"success":true,…}
```

Both cache keys carry the defect. The system-admin short-circuit is the only reason an owner-seeded account never sees the admin half.

#### Scope note, so the blast radius is not overstated

`GET /sites/:id/goals` answered `200 {"data":[],…}` on the just-created site in the same breath as the 403s above, because that route is `publicGoalsRead` and falls through to the site's `public: true` flag. The affected surface is the authenticated site-scoped one, not every read.

#### Independent sighting, not planned as part of this

A separate probe in the same session had to wait **10427 ms** before `GET /api/sites/38/excluded-countries` stopped answering `403` on a site it had just created. Another one happened to land on a warm key and waited 11 ms. The variance is just where in the 15 second TTL the creation falls.

**Expected behavior**

Creating a site invalidates the creator's `sitesAccessCache` entries, so the very next request from that account on the new site is authorized. Concretely: step 4 of Phase A answers `201`, not `403`; the `GET` in Phase B answers `200` with the `excludedPaths` the `PUT` four milliseconds earlier just stored; and the `PUT` in Phase C answers `200` for the org owner who created the site. A `403` from these routes should mean what `getting-started.mdx:553` says it means, that the caller has no access to the site, and never that a cache has not caught up yet.

**Screenshots**

None. This is an API-level defect with no visual component, and the verbatim request and response transcripts above are the evidence. The dashboard symptom a user would actually notice is the one issue 980 describes: creating a site and then being unable to add a goal or funnel to it for a few seconds.

**Desktop (please complete the following information):**

- OS: macOS 26.5 (build 25F71), Apple silicon
- Browser: not applicable. Every request above was issued directly against the backend over HTTP, no browser involved
- Version: `rybbit-io/rybbit` `master` @ `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`, self-hosted via the repo's own docker compose. `v2.8.0` (2026-07-26) is an ancestor of this commit, so the shipped release carries the same defect
- Deployment: docker compose, backend `127.0.0.1:14701`, ClickHouse, Postgres and Redis all local to the stack. `CLUSTER_WORKERS=0`, `DISABLE_SIGNUP=false`, `DISABLE_TELEMETRY=true`, virgin database

This finding came from running the product's published documentation against a live instance. The full transcript, including the raw request log and the result summary, is available on request.
