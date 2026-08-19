---
finding: C8
target: calcom/cal.diy
route: public issue
title: "[Bug]: Both reassign endpoints return 200 success with a reassignedTo object and do nothing, because the community-edition stubs are silent no-ops"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: Both reassign endpoints return 200 success with a reassignedTo object and do nothing, because the community-edition stubs are silent no-ops

### Issue Summary

`POST /v2/bookings/{bookingUid}/reassign/{userId}` and `POST /v2/bookings/{bookingUid}/reassign` answer HTTP 200 with `{"status":"success","data":{"bookingUid":...,"reassignedTo":{...}}}` and change nothing. Not for round robin bookings, not for any booking: on Cal.diy the round-robin reassignment implementation was removed with the rest of the EE code and replaced with two empty async functions in `packages/platform/libraries/index.ts` whose entire body is the comment `// No-op in community edition`. The routes, the service, the output shaping and the success envelope all survived. `reassignedTo` is built from the booking's existing user, so the response names the host the booking already had.

Any caller with `BOOKING_WRITE` gets a confirmation that a host handoff happened. The original host stays on the call and nobody is notified.

This is the fork's own convention broken in one file. The four sibling stubs immediately below these two, `createApiKeyHandler`, `createNewUsersConnectToOrgIfExists`, `sendVerificationCode` and `verifyPhoneNumber`, all throw "not available in community edition", and `verifyCodeAuthenticated` returns a safe false. Only the two reassignment stubs return a silent success.

This is a Cal.diy-only defect, created by the fork commit, and it is not a claim about the commercial Cal.com product, which still ships the real round-robin engine and whose source is not public.

One correction to head off a wrong reading of the scenario that surfaced this. The finding is **not** "a non-round-robin booking should have been refused". The pre-fork implementation had no `schedulingType` gate at all: it threw `invalid_round_robin_host` only when the target user was not among the event type's hosts, and fell back to `eventType.users` for an individual event type, so the same call would have been accepted upstream too. The published sentence "Currently only supports reassigning host for round robin bookings" is a capability caveat, not a documented error contract, and neither page names a status code. The defect is the other one: on Cal.diy the endpoint can never do anything, for any booking, and reports success anyway.

**Docs**

https://cal.com/docs/api-reference/v2/bookings/reassign-a-booking-to-a-specific-host (and, word for word, https://cal.com/docs/api-reference/v2/bookings/reassign-a-booking-to-auto-selected-host )

> Currently only supports reassigning host for round robin bookings. The provided authorization header refers to the owner of the booking.

The same page publishes `ReassignBookingOutput_2024_08_13` with a required `status` of `success|error` and a required `data` object, so a success envelope is a positive claim that a reassignment happened. The tested tree carries the same `@ApiOperation` description and the same DTO, so this is Cal.diy's own published contract, not only cal.com's.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis from the repo's docker compose.

1. Create any booking. In the run below, event type 100, a plain individual event type, host user id 1:

```
POST /v2/bookings
cal-api-version: 2024-08-13
Authorization: <owner api key>

{"eventTypeId":100,
 "start":"2051-01-18T13:00:00.000Z",
 "attendee":{"name":"Booker booker","email":"booker@example.com","timeZone":"America/New_York"}}
```

2. Reassign it to a named host:

```
POST /v2/bookings/cW2D5sw1gGqKMxAN4fbgpM/reassign/1
cal-api-version: 2024-08-13
Authorization: <owner api key>

{}
```

3. The auto route, `POST /v2/bookings/cW2D5sw1gGqKMxAN4fbgpM/reassign`, behaves the same way. It was not reached in this run, but `roundRobinReassignment` at lines 140 to 150 of the same file is the identical no-op, so it returns success identically.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

HTTP 200 with a success envelope naming a host:

```json
{"status":"success",
 "data":{"bookingUid":"cW2D5sw1gGqKMxAN4fbgpM",
         "reassignedTo":{"id":1,"name":"Reference Host","email":"reference-host@example.com",
                         "displayEmail":"reference-host@example.com"}}}
```

`reassignedTo` is the host the booking already had. Nothing moved. Corroborating that no work ran: the call returned in 20 ms of server time (against 6.3 s for the booking create), there is not a single log line between the incoming request and the outgoing response, and no reassignment email was even attempted.

### Expected Results

The endpoint reports that it cannot do the thing. Concretely, any of these, in preference order:

1. Make the two stubs throw like their four siblings in the same file, "Round robin reassignment is not available in community edition", and have the service surface it as a 501 (or a 400) rather than a 500.
2. Or unregister the two routes, so the API returns 404 for a feature this edition does not have.

What must not happen is the current outcome: a 200 success envelope with a `reassignedTo` object, for a call that did nothing.

### Technical details

Culprit: `packages/platform/libraries/index.ts`, lines 125 to 150, at the tested commit:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/packages/platform/libraries/index.ts#L125-L150

The region opens with `// === Stubs for deleted EE features still imported by API v2 ===` and `// Round-robin reassignment removed (EE feature) - stubs for API v2`. `roundRobinManualReassignment` (lines 126 to 138) and `roundRobinReassignment` (lines 140 to 150) are empty async functions whose only body is `// No-op in community edition`.

`apps/api/v2/src/platform/bookings/2024-08-13/services/bookings.service.ts:1089-1109` awaits the stub, re-reads the booking with `getByUidWithUser`, and hands it to `output.service.ts:539-553`, which builds `reassignedTo` out of `databaseBooking.user`, that is, the unchanged original host. `bookings.controller.ts:439-468` wraps that in `SUCCESS_STATUS`. Nothing on the path can produce an error for the stubbed case: the service's only two catch branches translate `invalid_round_robin_host` and `no_available_users_found_error`, which the real implementation threw and the stub never does.

The same file shows the convention these two break. Starting at line 153, `createApiKeyHandler`, `createNewUsersConnectToOrgIfExists`, `sendVerificationCode` and `verifyPhoneNumber` all throw "X is not available in community edition", and `verifyCodeAuthenticated` returns a safe false. The one-line ask is to make these two stubs behave like those.

Introduced by commit `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c`, PR #28903 "refactor: Cal.diy", 2026-04-15, the fork commit that stripped the EE code. `git log -L 123,151` on that file returns that single commit: it deleted `packages/features/ee/round-robin/roundRobinManualReassignment.ts` and `roundRobinReassignment.ts` and added the no-op stubs in the same change. The endpoint, the service and the output shaping are older, unmodified upstream code; the bug is the interaction.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/packages/platform/libraries/index.ts#L125-L150

A separate, smaller documentation defect found on the same endpoints, mentioned here so it is not lost: the NestJS envelope class and the platform-types data class are both named `ReassignBookingOutput_2024_08_13`, so Nest's Swagger plugin collapses them and the published OpenAPI `$ref`s the envelope from its own `data` property. Both reassign pages therefore document zero response fields, and the surrounding prose still names `ReassignAutoBookingOutput` and `ReassignManualBookingOutput`, which exist nowhere in the codebase.

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

The two calls, verbatim, from one run against the tested build.

Setup, `POST /v2/bookings`, HTTP 201, excerpt:

```json
{"status":"success","data":{"id":58,"uid":"cW2D5sw1gGqKMxAN4fbgpM",
 "hosts":[{"id":1,"name":"Reference Host","email":"reference-host@example.com","username":"reference-host"}],
 "status":"accepted","start":"2051-01-18T13:00:00.000Z","end":"2051-01-18T13:30:00.000Z",
 "eventTypeId":100,"eventType":{"id":100,"slug":"reference-consult"}}}
```

The failing call:

```
POST /v2/bookings/cW2D5sw1gGqKMxAN4fbgpM/reassign/1
cal-api-version: 2024-08-13
Authorization: <owner api key>

{}
```

HTTP 200:

```json
{"status":"success",
 "data":{"bookingUid":"cW2D5sw1gGqKMxAN4fbgpM",
         "reassignedTo":{"id":1,"name":"Reference Host","email":"reference-host@example.com",
                         "displayEmail":"reference-host@example.com"}}}
```

The host in `reassignedTo` (id 1, Reference Host) is the same host the booking carried before the call, visible in the setup response above.

The server log shows both routes registered at the version sent (`/v2/bookings/:bookingUid/reassign` and `/:bookingUid/reassign/:userId`, version 2024-08-13), a response time of 20 ms, and no log line at all between the incoming request and the outgoing response. stderr for the run contains only the unrelated SMTP failure from the booking create.

### Related

- #25920 (open) "RR reassignment with Host Groups" is a pre-fork issue about round-robin reassignment semantics, not about the community-edition no-op.
- PR #17460 (merged 2024-11-08) "feat: api v2 reassign" introduced both routes, the `{bookingUid, reassignedTo}` data class and the same-name envelope class behind the empty published schema noted above.
- PR #20755 (merged 2025-04-17) is pre-fork work on the auto reassign route's error envelope, that is, the error path the no-op stub now bypasses.
- #21485 (closed 2025-05-23) "docs: document that reassign is only for round robin" is about the round-robin-only restriction, not the response.
- Nothing post-fork reports this. Searches over `org:calcom` for reassign items updated since 2026-04-15 and for "community edition" found nothing about the EE stubs.

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
