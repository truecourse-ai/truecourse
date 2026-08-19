---
finding: C14 + C15 (one issue, one decorator, one fix)
target: calcom/cal.diy
route: public issue
title: "[Bug]: The GET /v2/slots response is documented wrongly in two places: default slots are objects, not strings, and seated slots have no attendeesCount"
labels: "🐛 bug"
status: draft
reverified: doc side yes (published reference fetched 2026-08-19, HTTP 200, both errors still served; repo unchanged at main 176037d0afbe572f870a3c702985e7cd83fe6c0c); live API re-run pending
---

# [Bug]: The GET /v2/slots response is documented wrongly in two places: default slots are objects, not strings, and seated slots have no attendeesCount

### Issue Summary

The `@DocsResponse` decorator on `getAvailableSlots` in `apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts` is hand written and has drifted from the DTOs that actually shape the response. Two errors, both exported into `docs/api-reference/v2/openapi.json` and both live on the published reference today:

1. **Default format**: the operation prose says "value is array of slots as string", and the 200-response schema declares `additionalProperties: { type: "array", items: { type: "string" } }`. The endpoint returns an array of **objects**, each with a `start` property. The decorator's own inline example, three lines below its own schema, already shows the object form and contradicts it.
2. **Seated slots**: the 200-response description says "For seated slots each object will have `attendeesCount` and `bookingUid` properties." The emitter sends `seatsBooked`, `seatsRemaining`, `seatsTotal` and, only when the slot already has a booking, `bookingUid`. `attendeesCount` is not in the response, is not in any DTO, and matched no version of this endpoint ever: the predecessor `2024-04-15` emitted `attendees`, not `attendeesCount`.

The shipped behaviour is correct in both cases and is pinned by the repository's own e2e fixtures, so **no behaviour change is being asked for**. The documentation is the wrong artifact.

Filing both together on purpose: both strings live in the same decorator on the same method of the same file, and the same structural fix closes both. Splitting them invites two half-fixes.

Filing here rather than on calcom/docs because the text is generated from this repository's own source, and calcom/docs states in its README that it is obsolete and that developer docs belong in the monorepo `/docs` folder.

### Steps to Reproduce

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31), API v2 built with `yarn workspace @calcom/api-v2 build` and served from `apps/api/v2/dist/apps/api/v2/src/main.js`, against Postgres and Redis in Docker.

**Default format.**

```
GET /v2/slots?eventTypeId=100&start=2050-09-05&end=2050-09-06&timeZone=Europe/Rome
cal-api-version: 2024-09-04
```

**Seated event type.** Book one seat first so the slot has a count to report, then:

```
GET /v2/slots?eventTypeId=102&start=2050-09-01T00:00:00.000Z&end=2050-10-01T00:00:00.000Z
cal-api-version: 2024-09-04
```

Then read either request against https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type , or against `docs/api-reference/v2/openapi.json` in this repository, or generate a client from that spec.

The documentation side was re-verified against the live published reference on 2026-08-19 and still carries both errors (see Evidence). RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check. for the API responses on a freshly built instance; the source that produces them is byte-identical to the tested tree at today's `main`.

### Actual Results

Default format, 200. Each day's value is an array of objects:

```json
{"data":{"2050-09-05":[{"start":"2050-09-05T11:00:00.000+02:00"},{"start":"2050-09-05T11:30:00.000+02:00"}, ... ]},"status":"success"}
```

The time zone half is correct: every `start` carries the requested Europe/Rome offset. Only the element shape contradicts the docs, which say the entries are bare strings.

Seated event type, 200:

```json
{"data":{"2050-09-08":[
  {"start":"2050-09-08T13:00:00.000Z","seatsBooked":0,"seatsRemaining":10,"seatsTotal":10},
  {"start":"2050-09-08T14:00:00.000Z","seatsBooked":4,"seatsRemaining":6,"seatsTotal":10,"bookingUid":"ptL2busPDT5RbZRbp5Pmi9"},
  {"start":"2050-09-08T14:30:00.000Z","seatsBooked":1,"seatsRemaining":9,"seatsTotal":10,"bookingUid":"m11BzNjjqmiSpV22h8txUV"},
  {"start":"2050-09-08T15:00:00.000Z","seatsBooked":0,"seatsRemaining":10,"seatsTotal":10}
]},"status":"success"}
```

The seat arithmetic is correct and richer than the docs promise. `attendeesCount` appears nowhere. `bookingUid` is present only on the two slots that already have a booking, not on every seated slot.

### Expected Results

Either the response matches the published contract, or the published contract matches the response. The response is right, so the contract should be corrected:

- The prose at `slots.controller.ts:89` should read something like "By default return is an object where each key is a date and the value is an array of slot objects, each with a `start` property."
- The schema at `slots.controller.ts:214` should be `items: { type: 'object', properties: { start: { type: 'string' } } }`, or better, reference the existing `Slot_2024_09_04` DTO.
- The 200 description at `slots.controller.ts:205` should read "For seated slots each object also has `seatsBooked`, `seatsRemaining` and `seatsTotal`, and `bookingUid` when the slot already has a booking."
- The `oneOf` schema should reference `SeatedSlot_2024_09_04` and `SeatedRangeSlot_2024_09_04` so a reader who distrusts the prose can recover the right names from the reference. Today neither branch names a single seat field.

### Technical details

The offending decorator is `@DocsResponse` on `getAvailableSlots`, `apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts:202-259`. The wrong strings are line 89 (the `@ApiOperation` prose), line 205 (the seated sentence) and line 214 (`items: { type: "string" }`).

Permalinks at the tested commit:
- https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts#L202-L229 (default format)
- https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts#L202-L259 (seated)

Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/modules/slots/slots-2024-09-04/controllers/slots.controller.ts#L202-L259 , and the generated spec at https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/docs/api-reference/v2/openapi.json#L5439-L5444 (items: string) and `#L5431` (the seated sentence).

The real emitters and types, all correct:

- `services/slots-output.service.ts:85-89` returns `{ start }` for no format and for `format=time`, typed by `Slot_2024_09_04` / `SlotsOutput_2024_09_04` (`packages/platform/types/slots/slots-2024-09-04/outputs/slots.output.ts:4-30`).
- `services/slots-output.service.ts:91-104` (`getAvailableTimeSlotSeated`) and `:188-203` (`getAvailableRangeSlotSeated`) return `{ start, seatsBooked, seatsRemaining, seatsTotal, bookingUid }`, typed by `SeatedSlot_2024_09_04` (`slots.output.ts:10-26`) and `SeatedRangeSlot_2024_09_04` (`:38-54`), whose `@ApiProperty` descriptions are correct.
- The repository's own e2e fixtures pin both shapes: `controllers/e2e/expected-slots.ts:1-9` (used at `reschedule-uid-slots.controller.e2e-spec.ts:250`) for the object shape, and `controllers/e2e/user-event-type-slots.controller.e2e-spec.ts:900-952` for `seatsBooked` / `seatsRemaining` / `seatsTotal`.

Because the `@DocsResponse` schema is hand written and never references the DTOs, the type system cannot catch the contradiction, which is how it drifted. That is the root fix: point the decorator at `Slot_2024_09_04`, `SeatedSlot_2024_09_04` and `SeatedRangeSlot_2024_09_04` rather than hand-writing the response schema.

Both wrong lines were born with the endpoint, in `5dc81e8677c14525242d88419cc2544741c08fdb` (PR #18758, "feat: v2 slots new version", merged 2025-02-13). `git log -S` on each phrase returns only that commit, and the same commit already emitted objects and seat counts, so neither sentence was ever true of any shipped build.

### Evidence

Captured from the run described above: the two full responses quoted verbatim under Actual Results, from a live instance at the tested commit, with `cal-api-version: 2024-09-04` sent and honoured.

The published reference was checked directly on 2026-08-19, not only in a snapshot. One unauthenticated GET of https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type.md returned HTTP 200 and the served markdown still contains:

- "value is array of slots as string" (twice, at lines 33 and 86 of the served file),
- `additionalProperties.items.type: string` in the 200-response schema at lines 245-248, immediately above the `range` branch at lines 260-263 which correctly says `type: object`,
- "For seated slots each object will have attendeesCount and bookingUid properties." at line 237.

So a client generated from the published spec today gets `Record<string, string[]>` for the default slots response and will parse a JSON object as a timestamp string at runtime, and a reader looking for the seat count reads `slot.attendeesCount` and gets `undefined` for every seated slot. The correct names appear nowhere in the published reference.

### Related

- PR #21196 "docs: correct documentation for slot format in 2024-09-04 API" (merged 2025-05-14) edited the very sentence that carries error 1 and fixed only the parameter name, `slotFormat` to `format`. "array of slots as string" survived. It is the nearest prior art and it is not a report of this.
- PR #22189 (closed unmerged 2025-07-11) is the only org-wide hit for the token `attendeesCount`; it touches a local variable in the slots reserve path, not the response shape.
- Searches for "slots as string", "slots format documentation", "openapi slots schema", "attendeesCount" and "seatsRemaining" across the org returned nothing describing either error. Those are weak negatives (a query matching PR #21196's own title also returned nothing), so if a duplicate exists we did not find it.

Found by TrueCourse running the published Cal.com v2 API reference against a live Cal.diy instance built from source; the full transcript (requests, responses) is available on request.
