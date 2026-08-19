---
finding: C4
target: calcom/cal.diy
route: security disclosure
title: The /v2/slots/reservations/{uid} route family has no authentication guard and no ownership check
labels: none (private advisory)
status: draft
reverified: pending (source re-checked 2026-08-19 at calcom/cal.diy main 176037d0afbe572f870a3c702985e7cd83fe6c0c: unchanged, byte-identical to the tested tree)
---

# The /v2/slots/reservations/{uid} route family has no authentication guard and no ownership check

Private report via the GitHub private advisory form on calcom/cal.diy (https://github.com/calcom/cal.diy/security/advisories/new), with a copy to security@cal.com per SECURITY.md. This is a source-level report about self-hosted Cal.diy built from the public repository. It makes no claim about the hosted Cal.com service; that source is not public and was not tested.

## Summary

`POST /v2/slots/reservations` is guarded and enforces ownership. The three sibling routes on the same resource, `GET`, `PATCH` and `DELETE /v2/slots/reservations/{uid}`, carry no guard and no ownership check at all. Anyone who has a reservation uid can read another booker's hold, move it to a different start time or a different event type, extend it to an arbitrary number of minutes, or cancel it, with no credential.

The published request schema states that `reservationDuration` is "ONLY for authenticated requests". `POST` enforces that with 401 and 403 and has tests for it. `PATCH` accepts the field from an anonymous caller and applies it. So one half of this is a documented rule that is enforced on one route and unenforced on its sibling, and the other half is a missing authorization check that no published sentence covers.

## Affected

- Component: `apps/api/v2` (`@calcom/api-v2`), slots module version `2024-09-04`.
- Routes: `GET /v2/slots/reservations/{uid}`, `PATCH /v2/slots/reservations/{uid}`, `DELETE /v2/slots/reservations/{uid}`.
- Introduced by `5dc81e8677c14525242d88419cc2544741c08fdb` (PR #18758, "feat: v2 slots new version", merged 2025-02-13), which shipped the route family, the authenticated-only rule and its `POST` enforcement together. This is an original omission, not a regression.
- Still present on `main` at `176037d0afbe572f870a3c702985e7cd83fe6c0c` (2026-08-08) and in the newest tag, `v6.2.0`.

## Details

The published schema for the shared request body says, of `reservationDuration`:

> ONLY for authenticated requests with api key, access token or OAuth credentials (ID + secret).
>
> For how many minutes the slot should be reserved - for this long time noone else can book this event type at `start` time. If not provided, defaults to 5 minutes.

Page: https://cal.com/docs/api-reference/v2/slots/update-a-reserved-slot (`components.schemas.ReserveSlotInput_2024_09_04.properties.reservationDuration`). The same DTO, `packages/platform/types/slots/slots-2024-09-04/inputs/reserve-slot.input.ts:25-33`, is the body type of both `POST /v2/slots/reservations` and `PATCH /v2/slots/reservations/{uid}`, so `PATCH` publishes a rule it never applies.

The create path enforces the rule. `reserveSlot` (`services/slots.service.ts:95-117`) takes an `authUserId`, throws `UnauthorizedException` when `reservationDuration` is present without a user, and then throws `ForbiddenException` when the authenticated user is not the event type owner, a member sharing a membership, or a member of the event type's team or organization. Its route carries `@UseGuards(OptionalApiAuthGuard)` and `@GetOptionalUser` at `controllers/slots.controller.ts:271-296`.

The update path has none of that:

- `@Patch("/reservations/:uid")` at `controllers/slots.controller.ts:314-332` has no guard and no user parameter. It calls `this.slotsService.updateReservedSlot(body, uid)`.
- `updateReservedSlot` (`services/slots.service.ts:271-332`) has no `authUserId` parameter at all, and at line 319 does `const reservationDuration = input.reservationDuration ?? DEFAULT_RESERVATION_DURATION;`, handing the caller-supplied value straight to `slotsRepository.updateSlot`, which writes `releaseAt = now + duration` (`slots.repository.ts:83-103`).
- `updateReservedSlot` never checks that `dbSlot.eventTypeId` matches `input.eventTypeId`, and `slots.repository.ts:96-101` writes `eventTypeId` from the body, so an anonymous caller can also move a hold onto a different event type.
- `reservationDuration` has no upper bound anywhere in the DTO (`@IsInt` only), so the accepted value can be arbitrarily large.
- `@Get("/reservations/:uid")` (`controllers/slots.controller.ts:298-312`) and `@Delete("/reservations/:uid")` (`:334-355`) are likewise unguarded and do no ownership check, so the same uid grants read and cancel.

Permalink at the tested commit: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts#L314-L332

Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts#L314-L332

The asymmetry is visible in the repository's own e2e suite. `apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/e2e/user-event-type-slots.controller.e2e-spec.ts` asserts 401 for an unauthenticated `POST` carrying `reservationDuration` (line 650) and 403 for an unrelated authenticated user (line 663). The only `PATCH` test (line 563) sends no `reservationDuration` and just asserts the default 5.

## Proof of concept

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31), API v2 built with `yarn workspace @calcom/api-v2 build` and served from `apps/api/v2/dist/apps/api/v2/src/main.js`, against Postgres and `redis:7-alpine` in Docker. Every request below carries `cal-api-version: 2024-09-04` and no `Authorization` header.

1. Read the available slots of an event type so the target start time is known.

```
GET /v2/slots?eventTypeId=100&start=2050-09-01T00:00:00.000Z&end=2050-10-01T00:00:00.000Z
cal-api-version: 2024-09-04
```

Answers 200 with `2050-09-30` holding `{"start":"2050-09-30T09:00:00.000Z"}` and the rest of the day.

2. Take a hold anonymously. No credential is presented, and none is required (this is intended: the anonymous booker flow depends on it).

```
POST /v2/slots/reservations
cal-api-version: 2024-09-04

{"eventTypeId":100,"slotStart":"2050-09-30T09:00:00.000Z"}
```

Answers 201:

```json
{"status":"success","data":{"eventTypeId":100,"slotStart":"2050-09-30T09:00:00.000Z","slotEnd":"2050-09-30T09:30:00.000Z","slotDuration":30,"reservationUid":"0a82208a-c044-4a67-9171-e7e25e94ceff","reservationDuration":5,"reservationUntil":"2026-08-13T10:56:02.967Z"}}
```

3. Still anonymous, move the hold to a different start and ask for the authenticated-only 30 minute duration.

```
PATCH /v2/slots/reservations/0a82208a-c044-4a67-9171-e7e25e94ceff
cal-api-version: 2024-09-04

{"eventTypeId":100,"slotStart":"2050-09-30T09:30:00.000Z","reservationDuration":30}
```

**Observed**, 200:

```json
{"status":"success","data":{"eventTypeId":100,"slotStart":"2050-09-30T09:30:00.000Z","slotEnd":"2050-09-30T10:00:00.000Z","slotDuration":30,"reservationUid":"0a82208a-c044-4a67-9171-e7e25e94ceff","reservationDuration":30,"reservationUntil":"2026-08-13T11:21:02.986Z"}}
```

The anonymous caller both moved the hold from 09:00 to 09:30 and extended it from 5 minutes to 30.

**Expected**: the same 401 the `POST` route returns for an anonymous request carrying `reservationDuration`, and a 401 or 403 for any caller who does not own the reservation.

Note on the uid: the uid used above was the caller's own only because that was the shortest way to exercise the route. Nothing in the code path ties the uid to the caller, so the same three requests work against any uid, which is the substance of the report. Step 3 is the only step exercised anonymously in the recorded run; `GET` and `DELETE` were read from source, not requested, and are reported as a code-level finding.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

## Impact

- An anonymous caller can read a reservation belonging to another booker (`GET`), retarget it to a different start time or event type, extend its lifetime, or release it (`DELETE`), given only the uid. Reservation uids are handed to whoever created the hold and travel through the booker front end.
- A documented authenticated-only field is accepted from anonymous callers, so the documented distinction between an anonymous 5 minute hold and an authenticated custom hold does not exist on this route.
- Because `reservationDuration` has no upper bound, the same unguarded route also lets an anonymous caller pin a host's slot for an arbitrary time. That availability consequence is secondary to the authorization gap and is stated last deliberately.
- No booking is created and no attendee data is exposed by these routes.

## Suggested severity

Moderate. CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N` (6.5), on the authorization gap alone. Counting the unbounded `reservationDuration` as an availability impact raises it, which is why it is listed separately above. CWE-862 (missing authorization) with a CWE-639 (authorization bypass through user-controlled key) component.

## Suggested fix

Put `@UseGuards(OptionalApiAuthGuard)` and `@GetOptionalUser` on the `PATCH`, `GET` and `DELETE` routes, thread the user id into `updateReservedSlot`, and reuse the checks `reserveSlot` already has (the 401 branch plus `canSpecifyCustomReservationDuration`). Separately, verify `dbSlot.eventTypeId` matches `input.eventTypeId`, and add an upper bound to `reservationDuration`. The anonymous booker flow still needs to move and release its own hold, so an ownership check bound to the reservation record rather than a blanket authentication requirement is the shape that keeps that flow working.

## Related

- PR #18758 (merged 2025-02-13): shipped the endpoint set, the authenticated-only rule, its `POST` enforcement and the unguarded `PATCH` in one change.
- PR #29383 "fix(security): add ownership validation to prevent IDOR vulnerabilities" (opened 2026-05-17, closed unmerged 2026-05-18): the same class of bug on the tRPC path (`removeSelectedSlotMark`). It does not touch `apps/api/v2`, so it never covered these REST routes.
- PR #23222 (merged 2025-10-10): the only other merged change to this service, about round-robin reservation overlap, nothing auth related.
- No open or closed issue or PR reports this. Searches: `reservationDuration` (3 hits, all accounted for above), `slots/reservations` (25 hits, only #29383 auth related), `OptionalApiAuthGuard` (13 hits, none adds the guard here), and a 2026-05-01 onward search for "slot reservation IDOR unauthenticated" (0 hits).

Found by TrueCourse running the published Cal.com v2 API reference against a live Cal.diy instance built from source; the full transcript (requests, responses, server log) is available on request. Disclosure hygiene note, since the repository asks for it: the work was carried out by an AI agent pipeline (TrueCourse, Claude models) that executed the documented requests against a local instance, the text of this report was drafted by that pipeline, and a human reviewed and verified it before sending. No traffic was sent to any Cal.com or Cal.diy hosted infrastructure, and no automated scanner was run against it.
