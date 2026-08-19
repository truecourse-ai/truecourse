---
finding: C3
target: calcom/cal.diy
route: public issue
title: "[Bug]: POST /v2/bookings/{uid}/attendees returns 201 on a seated booking and creates an attendee with no seat"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: POST /v2/bookings/{uid}/attendees returns 201 on a seated booking and creates an attendee with no seat

### Issue Summary

The published v2 API reference for `POST /v2/bookings/{bookingUid}/attendees` states that the endpoint does not support seated event bookings and that attempting it returns 400. On a self-hosted Cal.diy build the call is accepted: HTTP 201 in 55 ms, with an attendee row created against the seated booking. The identical promise is published for `POST /v2/bookings/{bookingUid}/guests`, whose code path has the same hole.

The row this creates has no `BookingSeat`, which breaks two things inside this repository's own code. `output.service.ts` emits `seatUid: attendee.bookingSeat?.referenceUid`, so a later read of the booking returns a `SeatedAttendee` missing the `seatUid` its own schema marks required. And the two seat counters diverge in opposite directions: the seat gate that decides whether more seats can be sold counts only attendees that have a `BookingSeat`, while the display paths count raw `Attendee` rows.

Two scope notes. Only the 201 is observed by the run below; the seat arithmetic described under Technical details is derived from source, not from this run, and is flagged as such there. And the "Seated Events" paragraph quoted below exists in cal.com's published OpenAPI but not in this repository's own `@ApiOperation` for the same operation, so the refusal may be a guard added on the commercial side after the April 2026 fork and never ported here. That does not make this a non-issue for Cal.diy, because the harm (a seat-less attendee that violates Cal.diy's own required `seatUid` and its own seat arithmetic) is entirely inside Cal.diy code. Nothing here is a claim about the hosted Cal.com product, whose source is not public. Cal.diy users read the cal.com reference because Cal.diy publishes no API reference of its own.

**Docs**

https://cal.com/docs/api-reference/v2/bookings-attendees/add-an-attendee-to-a-booking

> This endpoint does not support seated event bookings. For seated events, each attendee must be added by creating a new booking for the same event type and time slot via `POST /v2/bookings`. Attempting to add an attendee to a seated event booking will return a 400 error.

https://cal.com/docs/api-reference/v2/bookings-guests/add-guests-to-an-existing-booking

> This endpoint does not support seated event bookings. For seated events, each guest must be added by creating a new booking for the same event type and time slot via `POST /v2/bookings`. Attempting to add guests to a seated event booking will return a 400 error.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis from the repo's docker compose.

1. Create a seated event type (the run below used event type 102 with `seatsPerTimeSlot: 10`).
2. Book a seat on it, so there is a seated booking to aim at:

```
POST /v2/bookings
cal-api-version: 2024-08-13
Authorization: <token>

{"eventTypeId":102,
 "start":"2050-09-08T14:00:00.000Z",
 "attendee":{"name":"Booker seated-first","email":"seated-first@example.com","timeZone":"America/New_York"}}
```

3. Add an attendee to that booking:

```
POST /v2/bookings/ptL2busPDT5RbZRbp5Pmi9/attendees
cal-api-version: 2024-08-13
Authorization: <token>

{"name":"Late Arrival","email":"late@example.com","timeZone":"America/New_York"}
```

4. The same call shape against `/guests` with `{"guests":["guest@example.com"]}` exercises the second documented refusal.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

Step 3 returns HTTP 201 with a success envelope and a new attendee, id 79, on booking 73:

```json
{"status":"success",
 "data":{"name":"Late Arrival","email":"late-4f6225c918@example.com",
         "displayEmail":"late-4f6225c918@example.com","timeZone":"America/New_York",
         "language":"en","absent":false,"id":79,"bookingId":73}}
```

Nothing in the server log or stderr relates to the add. No 400, no warning, no `BookingSeat`.

### Expected Results

HTTP 400, refusing the call as the reference states, on both `/attendees` and `/guests`.

If the intended Cal.diy behaviour is to allow the call rather than refuse it, then the fix is to create a `BookingSeat` and honour `seatsPerTimeSlot`, not to leave the row seat-less. What must not happen is the current outcome: an accepted write that produces an attendee the seated schema and the seat gate both consider impossible.

### Technical details

Culprit: `apps/api/v2/src/platform/bookings/2024-08-13/services/booking-attendees.service.ts`, lines 71 to 120, at the tested commit:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/platform/bookings/2024-08-13/services/booking-attendees.service.ts#L71-L120

`addAttendee` loads the booking with `getByUidWithEventType`, checks only that the booking exists (throwing `NotFoundException` when it does not), and delegates straight to the shared service. There is no read of `eventType.seatsPerTimeSlot` and no `BadRequestException` anywhere on the path, so a seated booking is treated exactly like a plain one. The shared service, `packages/features/bookings/services/BookingAttendeesService.ts` lines 89 to 149, is equally seat-blind: `validateUserPermissions`, `validateGuestsFieldEnabled` and `sanitizeAndFilterGuests` none of them look at seats, then `updateBookingAttendees` writes the row with no `BookingSeat`.

The string "does not support seated" appears in no `.ts`, `.tsx`, `.json` or `.md` file in the tested tree, and the controller's own `@ApiOperation` description (`booking-attendees.controller.ts:106-120`) has no "Seated Events" paragraph, while the published OpenAPI for the same `operationId` does.

Consequences of the seat-less row, **derived from source and not observed in this run** (the run stopped at the failing step and nothing re-read the booking):

- `apps/api/v2/src/platform/bookings/2024-08-13/services/output.service.ts:389` emits `seatUid: attendee.bookingSeat?.referenceUid`, so reading the booking back returns a `SeatedAttendee` with no `seatUid`, a field the schema marks required.
- `packages/features/bookings/lib/handleSeats/create/createNewSeat.ts:68-76` gates new seats on `attendees.filter(a => !!a.bookingSeat).length`, so the seat-less row does not consume a seat and the full `seatsPerTimeSlot` can still be sold.
- `apps/web/modules/bookings/components/BookingDetailsSheet.tsx:801-802` (`takenSeats = booking.attendees.length`), `packages/trpc/server/routers/viewer/slots/util.ts:1261` (`attendees: booking._count.attendees`) and `apps/web/modules/bookings/components/AvailableTimes.tsx:118-120` (`bookingFull` when `slot.attendees >= seatsPerTimeSlot`) all count raw `Attendee` rows.

So the two counters drift apart in opposite directions after every such call. Confirming that half takes three calls this run did not make: `GET /v2/bookings/{uid}` after the add, the slots feed for the day, and enough real bookings to reach the seat ceiling.

The guests endpoint has the identical hole: `booking-guests.service.ts` lines 22 to 60 enforce only a 30 guest ceiling, and `packages/trpc/server/routers/viewer/bookings/addGuests.handler.ts` has no seats guard.

Introduced by commit `b1eb5a28091561224be3898e5b1f98c78a867b09`, PR #27759 "feat: api v2 `POST` booking attendees endpoint", 2026-02-18. The endpoint shipped without a seats check on day one; none of the four commits that ever touched the file added one.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/platform/bookings/2024-08-13/services/booking-attendees.service.ts#L71-L120

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

Setup call and its response (the seated booking), verbatim:

```
POST /v2/bookings
cal-api-version: 2024-08-13
{"eventTypeId":102,"start":"2050-09-08T14:00:00.000Z",
 "attendee":{"name":"Booker seated-first","email":"seated-first@example.com","timeZone":"America/New_York"}}
```

HTTP 201, excerpt:

```json
{"status":"success","data":{"id":73,"uid":"ptL2busPDT5RbZRbp5Pmi9",
 "eventTypeId":102,"eventType":{"id":102,"slug":"reference-seated"},
 "start":"2050-09-08T14:00:00.000Z","end":"2050-09-08T14:30:00.000Z",
 "attendees":[{"name":"Booker seated-first","email":"seated-first-4f6225c918@example.com",
               "seatUid":"0943a86d-690b-48ad-87b9-3306c7266b09"}],
 "seatUid":"0943a86d-690b-48ad-87b9-3306c7266b09"}}
```

The server log for that request records the event type as `{id: 102, seatsPerTimeSlot: 10}`.

The failing call and its response, verbatim:

```
POST /v2/bookings/ptL2busPDT5RbZRbp5Pmi9/attendees
cal-api-version: 2024-08-13
{"name":"Late Arrival","email":"late@example.com","timeZone":"America/New_York"}
```

HTTP 201:

```json
{"status":"success",
 "data":{"name":"Late Arrival","email":"late-4f6225c918@example.com",
         "displayEmail":"late-4f6225c918@example.com","timeZone":"America/New_York",
         "language":"en","absent":false,"id":79,"bookingId":73}}
```

Expected status 400, actual status 201. The `/guests` call was never reached because the run stopped here; its refusal is unverified by this run and is reported above as a code-level reading only.

### Related

- PR #27759 (merged 2026-02-17) introduced the endpoint without a seats guard. It is not a report of this bug.
- Nothing in the tracker reports this. Searches over `org:calcom` for seated and seats items updated since 2026-08-01, and for the documented refusal sentence itself, returned nothing.

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
