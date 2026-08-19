---
finding: C7
target: calcom/cal.diy
route: public issue
title: "[Bug]: A slot reservation is still offered by the next GET /v2/slots, because the 2 s slots cache is never invalidated by a reservation write"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: A slot reservation is still offered by the next GET /v2/slots, because the 2 s slots cache is never invalidated by a reservation write

### Issue Summary

`POST /v2/slots/reservations` is documented as making a slot unavailable for others to book for the reservation duration. Immediately after a successful reservation, the very next `GET /v2/slots` for the same event type and window still lists the reserved slot. The read path serves a Redis-cached payload computed before the reservation existed, and nothing on the reservation write path invalidates that cache. The window is `SLOTS_CACHE_TTL`, 2000 ms by default, and it cuts both ways: a released reservation stays hidden for the same window.

That is exactly the concurrent-booker race the reserve endpoint exists to close. The damage is bounded, and it is fair to say so: a second `POST /v2/slots/reservations` for the same slot is still refused with 422, because the reserve path reads the database directly. So the outcome is a wrong slot grid rather than a double booking. The cache also cannot be switched off in a real deployment, because the v2 API halts without `REDIS_URL`.

Upstream's own e2e suite already encodes the contract this violates: `apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/e2e/user-event-type-slots.controller.e2e-spec.ts:431`, "should reserve a slot and it should not appear in available slots", reserves and re-reads with no wait. It only passes because the preceding queries in that suite are older than the TTL or use different parameters, which makes the coverage timing-dependent rather than real.

Reproduction is on Cal.diy built from source. The code involved predates the Cal.diy fork (PR #22787, August 2025). Nothing here is a claim about the hosted Cal.com product, whose source is not public.

**Docs**

https://cal.com/docs/api-reference/v2/slots/reserve-a-slot

> Make a slot not available for others to book for a certain period of time.

And the same page's `ReserveSlotOutput_2024_09_04.reservationDuration`:

> For how many minutes the slot is reserved - for this long time noone else can book this event type at `start` time.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis (`REDIS_URL=redis://localhost:6379`) from the repo's docker compose. `SLOTS_CACHE_TTL` unset, so the 2000 ms default applies.

Two `GET /v2/slots` calls with identical query input inside 2 s, straddling a reservation. The first call is what warms the cache; in a real deployment any other caller's read does that for you.

1. Read the slots, which populates the cache:

```
GET /v2/slots?eventTypeId=100&start=2050-09-01T00:00:00.000Z&end=2050-10-01T00:00:00.000Z
cal-api-version: 2024-09-04
```

2. Within 2 s, reserve one of the returned slots:

```
POST /v2/slots/reservations
cal-api-version: 2024-09-04

{"eventTypeId":100,"slotStart":"2050-10-01T09:00:00.000Z"}
```

3. Within 2 s of step 1, repeat the exact request from step 1 and look for `2050-10-01T09:00:00.000Z`.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

Step 2 returned HTTP 201 with a live reservation (`reservationUid` `26108a7f-698d-45b6-8110-50b651d1c3c2`, `slotStart` `2050-10-01T09:00:00.000Z`, `reservationUntil` about 5 minutes out). Step 3, 16 ms later, returned HTTP 200 with a body byte-identical to step 1's, still listing `2050-10-01T09:00:00.000Z` as available.

The server log names the mechanism directly: `[slots/util] [CACHE HIT] Available slots` for both step 1 and step 3, on cache key

```json
{"isTeamEvent":false,"startTime":"2050-09-01T00:00:00.000Z","endTime":"2050-10-01T23:59:59.000Z",
 "eventTypeId":100,"eventTypeSlug":"reference-consult","usernameList":[],"orgSlug":null,"rescheduleUid":null}
```

The value behind that key had been written by a cache miss 0.8 s before the reservation.

The exclusion logic itself works. That same freshly computed payload already omits three slots reserved before it was computed (2050-09-29T09:30, 2050-09-29T13:00, 2050-09-30T09:30). The only reason the newly reserved slot survived is the stale cache entry.

### Expected Results

Step 3 does not list `2050-10-01T09:00:00.000Z`. A reservation is visible to the next read of the slot grid, with no waiting period, which is what the endpoint's documented purpose requires and what the repository's own e2e test asserts.

### Technical details

Culprit: `packages/trpc/server/routers/viewer/slots/util.ts`, the `withSlotsCache` wrapper at lines 104 to 140 (and the `DEFAULT_SLOTS_CACHE_TTL = 2000` at line 79, and `getAvailableSlots` wrapping `_getAvailableSlots` in it at lines 889 to 894), at the tested commit:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/packages/trpc/server/routers/viewer/slots/util.ts#L104-L140

The cache key is nothing but `JSON.stringify(args.input)` (line 109), the value is the whole rendered slot map, and the TTL is `parseInt(process.env.SLOTS_CACHE_TTL ?? "", 10) || DEFAULT_SLOTS_CACHE_TTL` written with `redis SET ... PX`. Reservation state is computed **inside** `_getAvailableSlots` (`_getReservedSlotsAndCleanupExpired` at lines 146 to 174, feeding `busySlotsFromReservedSlots` and `checkForConflicts` at lines 1209 to 1225), so it lives entirely under the cache. Nothing on the write side clears the key: `apps/api/v2/src/modules/slots/slots-2024-09-04/slots.repository.ts:59-110` (`createSlot`, `updateSlot`, `deleteSlot`) only touches Prisma, and `SlotsService_2024_09_04.reserveSlot` has no Redis dependency at all.

The v2 API always has a live Redis (`apps/api/v2/src/modules/redis/redis.service.ts:13-14` throws "Misconfigured Redis, halting." without `REDIS_URL`), so the window exists in every real deployment, not only in a test sandbox. Raising `SLOTS_CACHE_TTL` widens it proportionally.

Two further observations on the same code, worth fixing in the same patch:

- The key omits the request context entirely, while `_getAvailableSlots` personalises the result by `ctx.req.cookies.uid` (line 1104, filter at line 164). One booker's payload, which deliberately still shows that booker's own hold, can therefore be served to a different booker inside the TTL on the trpc and web path.
- A cache hit also skips the expired-reservation cleanup that `_getReservedSlotsAndCleanupExpired` performs as a side effect.

Fix options: delete the cache keys touched by a reservation write (create, update and delete in `slots.repository.ts`), or fold the reservation state and the caller identity into the cache key.

Introduced by commit `b71d8baccc446066337a05c2e0eb371c06fa61b5`, PR #22787 "chore: Implement short-lived redis cache for slots", merged 2025-08-05. The cache is the new code; the reservation-exclusion logic it hides is older (PR #22340, 2025-07-09), and the SelectedSlots feature older still. The bug is the interaction: an input-keyed shared cache placed in front of a computation whose result depends on mutable reservation rows and on the caller, with no invalidation on the write path.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/packages/trpc/server/routers/viewer/slots/util.ts#L104-L140

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

The three calls, verbatim, in order, from one run against the tested build.

Step 1, `GET /v2/slots?eventTypeId=100&start=2050-09-01T00:00:00.000Z&end=2050-10-01T00:00:00.000Z` with `cal-api-version: 2024-09-04`, HTTP 200. Tail of the body:

```json
"2050-10-01":[{"start":"2050-10-01T09:00:00.000Z"},{"start":"2050-10-01T09:30:00.000Z"},
              {"start":"2050-10-01T10:00:00.000Z"},{"start":"2050-10-01T10:30:00.000Z"},
              {"start":"2050-10-01T11:00:00.000Z"},{"start":"2050-10-01T11:30:00.000Z"},
              {"start":"2050-10-01T12:00:00.000Z"},{"start":"2050-10-01T12:30:00.000Z"}]
```

Step 2, `POST /v2/slots/reservations` with `{"eventTypeId":100,"slotStart":"2050-10-01T09:00:00.000Z"}`, HTTP 201:

```json
{"status":"success","data":{"eventTypeId":100,
 "slotStart":"2050-10-01T09:00:00.000Z","slotEnd":"2050-10-01T09:30:00.000Z","slotDuration":30,
 "reservationUid":"26108a7f-698d-45b6-8110-50b651d1c3c2",
 "reservationDuration":5,"reservationUntil":"2026-08-13T10:56:04.293Z"}}
```

Step 3, the identical request to step 1, 16 ms after step 2, HTTP 200. Same tail, the reserved slot still on offer:

```json
"2050-10-01":[{"start":"2050-10-01T09:00:00.000Z"},{"start":"2050-10-01T09:30:00.000Z"}, ...]
```

Expected: the body does not contain `2050-10-01T09:00:00.000Z`. Actual: it does, and the whole body is byte-identical to step 1's.

Server log lines for steps 1 and 3, 49 ms apart, both `[slots/util] [CACHE HIT] Available slots` on the cache key quoted under Actual Results.

### Related

- PR #22787 (merged 2025-08-05) introduced the cache. It is the culprit change, not a report of the symptom.
- Nothing in the tracker reports this. Searches over `org:calcom` for slots cache staleness, for `SLOTS_CACHE_TTL` (two unrelated env-file PRs, #23251 and #24028) and for slot items updated since 2026-08-01 found nothing about the cache.

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
