---
finding: C6
target: calcom/cal.diy
route: public issue
title: "[Bug]: Rescheduling a declined booking answers 404 \"Could not find original booking\" instead of 400, outside the v2 error envelope"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: Rescheduling a declined booking answers 404 "Could not find original booking" instead of 400, outside the v2 error envelope

### Issue Summary

The v2 reference lists five booking statuses for `POST /v2/bookings/{bookingUid}/reschedule`, two reschedulable and three not, and says the three non-reschedulable ones answer `400 Bad Request`. Both `cancelled` cases do exactly that. A `rejected` booking, one the host declined, answers **404 with the message "Could not find original booking"**, on a booking the same API had returned 45 ms earlier. The body is also raw `{"statusCode":404,"message":"..."}` rather than the v2 error envelope every other error in the run used, so generic client error parsers see an unrecognised shape.

A client cannot distinguish a bad uid from a non-reschedulable status, and the message is a false statement about a booking that demonstrably exists. `awaiting_host`, the third documented non-reschedulable status, has the identical hole in the same two places; that half is derived from source and was not exercised, because instant meetings were not seeded.

Reproduction is on Cal.diy built from source. The code involved predates the Cal.diy fork. Nothing here is a claim about what the hosted Cal.com product returns for a rejected booking; its source is not public and that cannot be checked.

**Docs**

https://cal.com/docs/api-reference/v2/bookings/reschedule-a-booking

> Non-reschedulable booking statuses (endpoint responds with `400 Bad Request`):
> - `cancelled` — the booking has already been cancelled. If it was cancelled because it was previously rescheduled, the error message includes the UID of the booking it was rescheduled to.
> - `rejected` — the host declined the original confirmation-required request. Create a new booking instead.
> - `awaiting_host` — an instant meeting that is live and waiting for a host to join. Create a new booking instead.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis from the repo's docker compose.

1. Book a requires-confirmation event type, so the booking lands `pending`:

```
POST /v2/bookings
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"eventTypeId":101,
 "start":"2050-09-08T10:00:00.000Z",
 "attendee":{"name":"Booker to-decline","email":"to-decline@example.com","timeZone":"America/New_York"}}
```

2. Decline it, which is what makes it `rejected`:

```
POST /v2/bookings/5nYuQT6CWvEiGY2Ua9iCWn/decline
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"reason":"the host declined"}
```

The 200 response reads the booking back with `status: "rejected"`.

3. Reschedule that same uid:

```
POST /v2/bookings/5nYuQT6CWvEiGY2Ua9iCWn/reschedule
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"start":"2050-09-08T10:30:00.000Z"}
```

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

HTTP 404 with a body that is not the v2 error envelope:

```json
{"statusCode":404,"message":"Could not find original booking"}
```

The booking exists. Step 2 returned it, by that uid, 45 ms earlier.

### Expected Results

HTTP 400 in the same shape the two `cancelled` cases already produce, naming the status. For comparison, from the same run and build, the cancelled case answers:

```json
{"status":"error","timestamp":"...","path":"/v2/bookings/fvrGvwHzP48D2bbUQxqL4Y/reschedule",
 "error":{"code":"BadRequestException",
          "message":"Can't reschedule booking with uid=fvrGvwHzP48D2bbUQxqL4Y because it has been cancelled. Please provide uid of a booking that is not cancelled.",
          "details":{"error":"Bad Request","statusCode":400}}}
```

Whatever the wording, the status must be 400 and the body must be the v2 envelope.

### Technical details

Culprit: `apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts`, lines 824 to 841, at the tested commit:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts#L824-L841

`canRescheduleBooking` is the guard that produces the documented 400s, and it only tests `booking.status === "CANCELLED"`, twice, with and without `booking.rescheduled`. `REJECTED` and `AWAITING_HOST` are never tested, so a declined booking sails past it into `regularBookingService.createBooking`. That path reaches `getOriginalRescheduledBooking` (`packages/features/bookings/lib/handleNewBooking/originalRescheduledBookingUtils.ts:8-21`), which delegates to `BookingRepository.findOriginalRescheduledBooking` (`packages/features/bookings/repositories/BookingRepository.ts:1170-1177`). That query filters `status: { in: [ACCEPTED, CANCELLED, PENDING] }`. `REJECTED` and `AWAITING_HOST` are absent from the list even though both are real `BookingStatus` values (`packages/prisma/schema.prisma:843-849`), so `findFirst` returns null for a booking that exists, and the util throws:

```ts
throw new HttpError({ statusCode: 404, message: "Could not find original booking" });
```

Two secondary points, both verified in the tested tree:

- The catch block at `RegularBookingService.ts:476-483` carries the comment "For other errors (like booking not found), let the service handle it later" but re-throws anything that is an `HttpError`, and this 404 is one. Line 660 would throw the identical 404 a moment later anyway, so that is a detail of which throw wins, not the cause.
- `@calcom/lib`'s `HttpError` is **not** a Nest `HttpException`, so `HttpExceptionFilter` (`apps/api/v2/src/filters/http-exception.filter.ts:31-36`, the source of the `{status, timestamp, path, error:{code, message, details}}` envelope) never sees it, and Nest's built-in unknown-error handler duck-types it into the raw `{statusCode, message}` body observed on the wire.

Two independent fixes belong together here:

1. Extend `canRescheduleBooking` to `REJECTED` and `AWAITING_HOST`, returning 400 in the same style as the two cancelled branches.
2. Route `@calcom/lib` `HttpError` through the v2 error envelope, with a `@Catch(HttpError)` filter alongside the five already registered in `apps/api/v2/src/bootstrap.ts`, so no v2 route can answer with a raw `{statusCode, message}` body.

Introduced by commit `a2c13e576e145300dc688d22d1f43f6668d105bd`, PR #21643 "refactor: v2 dont allow rescheduling cancelled,rescheduled bookings", 2025-05-30, which added `canRescheduleBooking` implementing exactly the two `cancelled` bullets and never covering the other two. The 404 it falls through to is older: the status filter blames to commit `b4f1b5aebe`, PR #15673, 2024-10-02, which only moved the query into the repository, so the `REJECTED` exclusion itself is older still.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts#L824-L841

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

The three calls, verbatim, in order, from one run.

Create, HTTP 201, excerpt:

```json
{"status":"success","data":{"id":72,"uid":"5nYuQT6CWvEiGY2Ua9iCWn","status":"pending",
 "eventTypeId":101,"eventType":{"id":101,"slug":"reference-confirm"},
 "start":"2050-09-08T10:00:00.000Z","end":"2050-09-08T10:30:00.000Z"}}
```

Decline, `POST /v2/bookings/5nYuQT6CWvEiGY2Ua9iCWn/decline` with `{"reason":"the host declined"}`, HTTP 200, excerpt. Note the API returns the booking, by uid, with its new status:

```json
{"status":"success","data":{"id":72,"uid":"5nYuQT6CWvEiGY2Ua9iCWn","status":"rejected",
 "start":"2050-09-08T10:00:00.000Z","end":"2050-09-08T10:30:00.000Z"}}
```

Reschedule, `POST /v2/bookings/5nYuQT6CWvEiGY2Ua9iCWn/reschedule` with `{"start":"2050-09-08T10:30:00.000Z"}`, HTTP 404:

```json
{"statusCode":404,"message":"Could not find original booking"}
```

Expected status 400, actual 404, and the body is outside the v2 envelope.

Both documented `cancelled` arms passed in the same run against the same build, which is what isolates this to the missing statuses: one returned the 400 quoted under Expected Results, and the previously-rescheduled one returned a 400 naming the successor uid ("... has been cancelled and rescheduled already to booking with uid=dkhyRmj1BvTKMTTQuCjoxs ...").

The server log for the failing request records the stack: `HttpError` thrown by `getOriginalRescheduledBooking`, called from `validateRescheduleRestrictions` inside `RegularBookingService.handler`, reached through `BookingsService_2024_08_13.rescheduleBooking`. There is no "Outgoing Response" log line for it, because the throw is not a Nest `HttpException` and so bypasses `HttpExceptionFilter`.

### Related

Nothing in the tracker reports this. Searches over `org:calcom` for the exact message "Could not find original booking" and for rejected/declined reschedule behaviour returned only unrelated items (#7399 from 2023, and number-matched noise).

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
