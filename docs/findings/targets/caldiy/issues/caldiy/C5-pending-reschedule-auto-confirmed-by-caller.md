---
finding: C5
target: calcom/cal.diy
route: public issue
title: "[Bug]: Rescheduling a pending booking with rescheduledBy set to the attendee returns it accepted, skipping host confirmation"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: Rescheduling a pending booking with rescheduledBy set to the attendee returns it accepted, skipping host confirmation

### Issue Summary

`rescheduledBy` is documented, in the v2 API reference and in this repository's own DTO description, as the field that decides whether a rescheduled confirmation-required booking lands accepted or pending: the event type owner's email auto-confirms it, an attendee email or no email leaves it for the owner to confirm. The rule is unconditional as written. In practice the value is discarded whenever it equals the attendee's own address, and the decision is made by the **caller's credential** instead. A host or platform backend that reschedules on an attendee's behalf with its own API key, and correctly declares the attendee in `rescheduledBy` exactly as the docs instruct, gets the booking auto-accepted. The host never sees a confirmation request and a requires-confirmation event type is booked without approval.

The evidence below contains its own control. The same request shape against the same kind of booking returns `pending` when the caller is a non-owner key and `accepted` when the caller is the owner key. Only the credential differs.

This is not an edition question: the documented sentence ships in the Cal.diy tree as the DTO's own swagger description (`packages/platform/types/bookings/2024-08-13/inputs/reschedule-booking.input.ts`, `RESCHEDULED_BY_DOCS`), so it is this repository's own contract. The code involved predates the Cal.diy fork. Reproduction is on Cal.diy built from source; nothing here is a claim about the hosted Cal.com product, whose source is not public.

**Docs**

https://cal.com/docs/api-reference/v2/bookings/reschedule-a-booking , `RescheduleBookingInput_2024_08_13.rescheduledBy` (repeated verbatim for `RescheduleSeatedBookingInput_2024_08_13`):

> Email of the person who is rescheduling the booking - only needed when rescheduling a booking that requires a confirmation. If event type owner email is provided then rescheduled booking will be automatically confirmed. If attendee email or no email is passed then the event type owner will have to confirm the rescheduled booking.

The same page's header adds:

> `pending` — a booking awaiting host confirmation can be rescheduled. The new booking stays `pending` until the host confirms or declines it.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis from the repo's docker compose.

1. Create an event type that requires confirmation (event type 101 below), owned by a user who holds an API key.
2. Book it, so there is a pending booking. Using the owner's API key:

```
POST /v2/bookings
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"eventTypeId":101,
 "start":"2050-09-08T12:00:00.000Z",
 "attendee":{"name":"Booker pending again","email":"pending2@example.com","timeZone":"America/New_York"}}
```

The response is `status: "pending"`.

3. Reschedule it with the **owner's** API key, declaring the attendee in `rescheduledBy` as the docs instruct:

```
POST /v2/bookings/uRaPUKxn8ZDJpDbQgi5LoR/reschedule
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"start":"2050-09-08T12:30:00.000Z","rescheduledBy":"pending2@example.com"}
```

4. Control: repeat steps 2 and 3 with a valid API key of an account that owns nothing (any other user's key) at step 3, everything else identical.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

Step 3, owner key, attendee address in `rescheduledBy`: HTTP 201 with `data.status: "accepted"` and `data.rescheduledByEmail: "pending2-5ed06ce52e@example.com"`. The booking is confirmed without the host acting.

Step 4, non-owner key, same request shape, same kind of booking: HTTP 201 with `data.status: "pending"`, which is the documented outcome.

So `rescheduledBy` is not what decides. The caller's credential is.

### Expected Results

Step 3 returns `data.status: "pending"`. An attendee address in `rescheduledBy` leaves the rescheduled booking awaiting the owner's confirmation, whoever made the HTTP call.

If maintainers decide the caller identity should keep precedence, then the reference and `RESCHEDULED_BY_DOCS` both need a caller-identity sentence, because today they state an unconditional rule that the code does not implement.

### Technical details

Culprit: `apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts`, lines 766 to 777, at the tested commit; the offending expression is line 769:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts#L766-L777

The documented rule is implemented correctly one layer down, in `input.service.ts:544-548`, which resolves an acting `userId` from `rescheduledBy` **only** when `rescheduledBy` differs from the attendee's own email. For the docs' "attendee email or no email" arm it deliberately leaves `userId` undefined, so `packages/features/bookings/lib/handleNewBooking/getRequiresConfirmationFlags.ts:77-93` computes `isUserReschedulingOwner(undefined, organizerId) = false`, `determineIsConfirmedByDefault` returns false, and the new booking stays pending.

`bookings.service.ts:769` then defeats that:

```ts
userId: bookingRequest.userId ?? authUser?.id,
```

The `undefined` that **encoded** "the attendee is rescheduling" falls back to the authenticated API-key owner (the route is guarded by `OptionalApiAuthGuard` / `GetOptionalUser`). When that caller is the event type organizer, `userId === originalRescheduledBookingOrganizerId`, `isUserReschedulingOwner` is true, `determineIsConfirmedByDefault` short-circuits to true, and `RegularBookingService.ts:668-675` writes the new booking ACCEPTED. The value the caller explicitly supplied is discarded exactly in the case the parameter exists for.

This is a regression, and naming it should make the fix easier. PR #19833 (commit `76b9b9b0fe`, 2025-03-11, "fix: v2 rescheduled booking with confirmation") deliberately **replaced** `userId = createBookingRequestOwnerId(request)` with the `rescheduledBy`-derived userId, precisely so the API-key owner would stop deciding confirmation. PR #24640 (commit `b0b94b91fe`, 2025-10-30, "fix: allow org admin to cancel and reschedule seated bookings") restored the owner fallback seven months later as the one-line `?? authUser?.id`, as a side effect of an org-admin seated-booking fix.

Suggested fix shape, since the org-admin case #24640 was solving is real: keep the `authUser` fallback but make it lose to an explicit `rescheduledBy`. Have `input.service.ts` return a tri-state instead of encoding "attendee is rescheduling" as an `undefined` that `??` cannot distinguish from "not supplied": `rescheduledBy` absent, fall back to `authUser`; `rescheduledBy` present and resolvable to a user, that user, after verifying the caller may act as them; `rescheduledBy` present and equal to the attendee, explicitly no acting user.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts#L766-L777

A separate concern on the same code, **derived from source and not exercised by this run**, so treat it as a lead and not as a report: `input.service.ts:544-548` resolves the acting user with `usersRepository.findByEmail(rescheduledBy)` and never checks that the caller is that person, and the route's `OptionalApiAuthGuard` returns null rather than rejecting when no auth is supplied. On that reading an unauthenticated caller who knows a booking uid could pass the event type owner's address in `rescheduledBy` and get the same auto-confirm. That variant deserves its own handling if it is confirmed. The issue reported here is the confirmation bypass above, which is fully evidenced.

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

The failing call and its response, verbatim.

Request:

```
POST /v2/bookings/uRaPUKxn8ZDJpDbQgi5LoR/reschedule
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"start":"2050-09-08T12:30:00.000Z","rescheduledBy":"pending2-5ed06ce52e@example.com"}
```

Response, HTTP 201, excerpt:

```json
{"status":"success","data":{
 "id":67,"uid":"wc7oWdb4S6wFciyBGykimP",
 "status":"accepted",
 "rescheduledByEmail":"pending2-5ed06ce52e@example.com",
 "rescheduledFromUid":"uRaPUKxn8ZDJpDbQgi5LoR",
 "start":"2050-09-08T12:30:00.000Z","end":"2050-09-08T13:00:00.000Z",
 "eventTypeId":101,"eventType":{"id":101,"slug":"reference-confirm"},
 "attendees":[{"name":"Booker pending again","email":"pending2-5ed06ce52e@example.com"}]}}
```

Expected `data.status` "pending", actual "accepted".

The control, from the same run and build. Same request shape, attendee address in `rescheduledBy`, pending booking, but a **non-owner** API key:

```
POST /v2/bookings/9oo43wwXYvFEZPqaffHXB9/reschedule
cal-api-version: 2024-08-13
Authorization: <non-owner api key>

{"start":"2050-09-08T10:30:00.000Z","rescheduledBy":"pending-5ed06ce52e@example.com"}
```

```json
{"status":"success","data":{"id":62,"uid":"jPT6htBjNWEq4hKML2HEEu",
 "status":"pending","rescheduledByEmail":"pending-5ed06ce52e@example.com", ...}}
```

For completeness, the owner arm of the documented rule does behave: rescheduling with `rescheduledBy` set to the **owner's** address returned `status: "accepted"`, as documented. So three of the four combinations are right and the failing one is the attendee arm under an owner caller.

### Related

- #16877 (open) "[CAL-4431] RescheduledBy feature needs more fixes" is about the web reschedule flow losing the `?rescheduledBy=` URL parameter, not about the API confirm decision. Adjacent, not a duplicate.
- #25100 (closed 2025-11-26) "fix: v2 api rescheduledBy" fixed a different symptom, `rescheduledByEmail` coming back null. That fix is present in the tested build; the field is populated correctly above.
- #21630 (closed 2025-06-16) is the same endpoint with an auth symptom (a spurious 401), not this.
- PR #19833 (merged 2025-03-11) and PR #24640 (merged 2025-10-30) are the two commits named under Technical details.

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
