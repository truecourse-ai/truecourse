---
finding: C2
target: calcom/cal.diy
route: public issue
title: "[Bug]: GET /v2/slots with usernames and format=range returns every slot with end equal to start"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending
---

# [Bug]: GET /v2/slots with usernames and format=range returns every slot with end equal to start

### Issue Summary

The v2 API reference says a dynamic event (the `usernames=a,b` form, no `eventTypeId`) defaults to 30 minute slots, and that with `format=range` each slot comes back as an object with `start` and `end`. On the dynamic path the `end` is always identical to the `start`: every slot is zero minutes long, behind HTTP 200 with no warning. A booking UI that renders `end - start` shows empty slots, and any booking window built from the range is invalid.

The scope is narrow and worth stating, because it is what makes this actionable. Only the dynamic form (`usernames=a,b`, no `eventTypeId`) with `format=range` is affected. A real event type asked with `format=range` is correct, and the default `format=time` output for the dynamic form is fine because it never emits an `end`. Sending `&duration=N` on the dynamic request works around it.

The reproduction is on Cal.diy built from source. The page quoted is cal.com's published v2 API reference, which Cal.diy has no substitute for, but the faulty code is this repository's own and predates the fork (PR #18758, February 2025). Nothing here is a claim about the hosted Cal.com product, whose source is not public.

**Docs**

https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type

> duration: Only use for event types that allow multiple durations or for dynamic event types. If not passed for multiple duration event types defaults to default duration. For dynamic event types defaults to 30 aka each returned slot is 30 minutes long. So duration=60 means that returned slots will be each 60 minutes long.

And, from the same page's OpenAPI block, the 200 response description:

> A map of available slots indexed by date, where each date is associated with an array of time slots. If format=range is specified, each slot will be an object with start and end properties denoting start and end of the slot.

The "Range format (when format=range)" example on that page shows every `end` as the `start` plus the slot length.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. API v2 built with `yarn workspace @calcom/api-v2 build` and started with `node apps/api/v2/dist/apps/api/v2/src/main.js`, Postgres and Redis from the repo's docker compose.

1. Have two users who share availability in the requested window (in the run below, two members of one organization, both bookable on 2050-09-28 from 13:00 to 17:00 UTC).
2. Ask for their shared slots through the dynamic form with `format=range`:

```
GET /v2/slots?usernames=reference-org-member,reference-org-member-2&organizationSlug=reference-org&start=2050-09-28T13:00:00.000Z&end=2050-09-28T17:00:00.000Z&format=range
cal-api-version: 2024-09-04
```

3. Read the `end` of any slot in the response.

Control, in the same run and against the same build: the same endpoint with a real `eventTypeId` and `format=range` returns correct ends, both with `duration=60` (15:00 to 16:00) and with no `duration` at all (15:00 to 15:30). So `format=range` itself works; only the dynamic path is broken.

Workaround for callers: add `&duration=30` (or any duration) to the dynamic request and the ends are correct.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

HTTP 200, `status: success`, eight slots on a correct 30 minute grid, every one of them zero length:

```json
{"data":{"2050-09-28":[
 {"start":"2050-09-28T13:00:00.000Z","end":"2050-09-28T13:00:00.000Z"},
 {"start":"2050-09-28T13:30:00.000Z","end":"2050-09-28T13:30:00.000Z"},
 {"start":"2050-09-28T14:00:00.000Z","end":"2050-09-28T14:00:00.000Z"},
 {"start":"2050-09-28T14:30:00.000Z","end":"2050-09-28T14:30:00.000Z"},
 {"start":"2050-09-28T15:00:00.000Z","end":"2050-09-28T15:00:00.000Z"},
 {"start":"2050-09-28T15:30:00.000Z","end":"2050-09-28T15:30:00.000Z"},
 {"start":"2050-09-28T16:00:00.000Z","end":"2050-09-28T16:00:00.000Z"},
 {"start":"2050-09-28T16:30:00.000Z","end":"2050-09-28T16:30:00.000Z"}]},
 "status":"success"}
```

The 30 minute spacing of the grid shows the availability engine did use `dynamicEvent.length = 30`. Only the range serialization lost it.

### Expected Results

Each slot's `end` is its `start` plus 30 minutes, the documented dynamic default:

```json
{"start":"2050-09-28T13:00:00.000Z","end":"2050-09-28T13:30:00.000Z"}
```

### Technical details

Culprit: `apps/api/v2/src/modules/slots/slots-2024-09-04/services/slots-output.service.ts`, lines 106 to 176, at the tested commit; the defect itself is at 112 to 114 and 130, 131, 153:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/modules/slots/slots-2024-09-04/services/slots-output.service.ts#L106-L176

For the dynamic form, `SlotsInputService_2024_09_04.getEventType` (`slots-input.service.ts:115`) returns the synthetic `dynamicEvent` object from `packages/features/eventtypes/lib/defaultEvents.ts`, which has `length: 30` but `id: 0` (inherited from `commons`). `transformGetSlotsQuery` keeps only `eventTypeId = eventType.id` (0) and `duration = query.duration` (undefined here) and throws the resolved 30 away. `SlotsOutputService_2024_09_04.getAvailableRangeSlots` then re-derives the length from the database:

```ts
const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);
...
const slotDuration = duration ?? eventType?.length;
```

`getEventTypeById(0)` is `prisma.eventType.findUnique({ where: { id: 0 } })`, which returns null because no row has id 0, so `slotDuration` is `undefined` and the end is computed as `DateTime.fromISO(slot.time, { zone: "utc" }).plus({ minutes: slotDuration }).toISO()`. Luxon's `normalizeObject` skips undefined units, so `plus({ minutes: undefined })` is a no-op that still yields a valid DateTime: `end === start`. Verified directly with the pinned luxon 3.4.4. The `if (!start || !end) throw new BadRequestException(...)` guard at line 155 cannot catch this, because luxon returns a valid DateTime rather than an Invalid one. The same undefined value reaches the `timeZone` branch at lines 130 to 133, so the bug is independent of the `timeZone` parameter.

Introduced by commit `5dc81e8677c14525242d88419cc2544741c08fdb`, PR #18758 "feat: v2 slots new version", 2025-02-13. Blame puts both halves in that one commit: the re-fetch by id in `slots-output.service.ts` and the synthetic `dynamicEvent` with `id: 0` in `slots-input.service.ts`. Later touches to the surrounding lines (`0965fad72a0`, `7ef10509469`) did not change the duration logic.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/modules/slots/slots-2024-09-04/services/slots-output.service.ts#L106-L176

Suggested fix: stop re-deriving the length from the database in the output service. `transformGetSlotsQuery` already holds the resolved event type (a real row, or `dynamicEvent` with the right length), so carry that length through `InternalGetSlotsQuery` and use it. At minimum, make the undefined case loud instead of emitting a zero-length range.

Two adjacent smells in the same function, both still present at head, worth cleaning up in the same patch:

- the `if (!start || !end)` guard at line 155 can never fire for a missing duration, for the luxon reason above;
- `getAvailableRangeSlotSeated` is declared with `eventTypeSeatsPerTimeslot: number` yet called with `eventType.seatsPerTimeSlot ?? undefined` at lines 148 and 166.

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

Request and response as sent and received, verbatim.

Request:

```
GET /v2/slots?usernames=reference-org-member,reference-org-member-2&organizationSlug=reference-org&start=2050-09-28T13:00:00.000Z&end=2050-09-28T17:00:00.000Z&format=range
cal-api-version: 2024-09-04
```

Response: HTTP 200, body as quoted under Actual Results.

The server log for that request records the internal query the API built, which shows the dynamic pseudo event id reaching the output service:

```json
{"isTeamEvent":false,"eventTypeId":0,"eventTypeSlug":"dynamic","usernameList":["reference-org-member","reference-org-member-2"],"orgSlug":"reference-org"}
```

No error and no warning were logged.

Control request and response from the same run and build (a real event type, `format=range`, no duration), showing correct ends:

```
GET /v2/slots?eventTypeId=116&start=2050-09-05&end=2050-09-06&format=range
cal-api-version: 2024-09-04
```

```json
{"data":{"2050-09-05":[{"start":"2050-09-05T15:00:00.000Z","end":"2050-09-05T15:30:00.000Z"},
                       {"start":"2050-09-05T15:30:00.000Z","end":"2050-09-05T16:00:00.000Z"}, ...]},
 "status":"success"}
```

### Related

Nothing in the tracker reports this. Searches over `org:calcom` for `"format=range"`, for slot items updated since 2026-08-01, and for dynamic-usernames slot behaviour returned only unrelated items (#28939 rolling windows, #29550 buffer prefetch, #13746 durations).

Found by TrueCourse running the published API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
