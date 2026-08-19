---
finding: C13
target: calcom/cal.diy
route: public issue
title: "[Bug]: The documented attendee-address prefill URL selects the option but leaves the address input empty"
labels: "🐛 bug"
status: draft
reverified: pending (source re-checked 2026-08-19 at calcom/cal.diy main 176037d0afbe572f870a3c702985e7cd83fe6c0c: the whole prefill path is byte-identical to the tested tree and every cited line number is current)
---

# [Bug]: The documented attendee-address prefill URL selects the option but leaves the address input empty

### Issue Summary

The help centre's worked example for prefilling an attendee address, `location={"value":"attendeeInPerson","optionValue":"Delhi"}`, half works. The "In Person (Attendee Address)" option is selected, so the link looks correct, but the address input that option reveals is empty. The `optionValue` never reaches the form, silently, with no error anywhere.

The mechanism itself is alive on the same build. Minutes apart in the same run, `location={"value":"phone","optionValue":"%2B919999999999"}` did populate its option input with `+91 99999-99999`. So the `radioInput` `optionValue` path works for the phone variant and fails for the address variant.

An integrator who builds a documented prefill link ships something that looks right and drops the data: the booker has to retype the address, or submits with no address at all.

The reproduction is on Cal.diy built from source. The same code is on `main` today.

The documentation, https://cal.com/help/bookings/prefill-fields , section "Prefilling location" / "Pre-filling Attendee Address":

> Different type of locations are selected using different values of location. location param value has to be a valid JSON.

> ```
> ...other-params...&location={"value":"attendeeInPerson","optionValue":"Delhi"}
> ```

"Delhi" is the doc's own example value, so this is the documented example failing, not an edge case we invented.

### Steps to Reproduce

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31), `@calcom/web` 6.2.0, built with `yarn build` and served with `yarn workspace @calcom/web start`, against Postgres and Redis in Docker. Browser: headless Chromium driven by Playwright.

1. Create an event type whose locations include "In Person (Attendee Address)". In the reproduction it is `/reference-host/multi-location`, which offers attendee in-person, two organizer addresses and a link meeting.
2. Open the booking form directly with the documented location parameter:

```
/reference-host/multi-location?month=2027-03&date=2027-03-15&slot=2027-03-15T10:00:00.000Z&location={"value":"attendeeInPerson","optionValue":"Delhi"}
```

3. Look at the address input the selected option reveals.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.. The source was re-read at `main` on 2026-08-19 and every file on this prefill path is byte-identical to the tested tree.

### Actual Results

The "In Person (Attendee Address)" radio is selected, so the `value` half of the parameter took effect. The address input it reveals is empty: it shows only its placeholder, "Enter address". Reading the input's `value` attribute returns nothing. "Delhi" appears nowhere on the page.

The page loaded fully in about 2 seconds, the check retried for 10 seconds, and a 19 second screen recording shows the input empty in every frame from the first paint of the form onward, so this is not a race with a late-arriving value.

### Expected Results

The address input holds `Delhi`, the value the documented `optionValue` carried.

### Technical details

`apps/web/modules/form-builder/components/Components.tsx`, the `radioInput` factory at lines 399-522.

Permalink at the tested commit: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/web/modules/form-builder/components/Components.tsx#L399-L522
Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/web/modules/form-builder/components/Components.tsx#L399-L522

The form value for the location field ends up as `{value: 'attendeeInPerson', optionValue: ''}`. Line 500 picks the option input from `optionsInputs[value.value]` (`attendeeInPerson` maps to `{type:'address',required:true}` in `packages/features/bookings/lib/getBookingFields.ts:145-160`), and line 512 feeds `value?.optionValue` into it, so an empty `optionValue` renders the empty `AddressInput` that the evidence shows.

The path that should have supplied "Delhi" is `packages/features/bookings/Booker/hooks/useInitialFormValues.ts:100-167` (parse the query with `getBookingResponsesPartialSchema`, then `bookingForm.reset` in `packages/features/bookings/Booker/hooks/useBookingForm.ts:94-99`) feeding `packages/features/bookings/lib/getBookingResponsesSchema.ts:60-75`, which JSON-parses the `radioInput` parameter and returns `{value, optionValue}` verbatim for non-phone option inputs. Reading that whole path, we could not find the line that drops the address. The partial schema accepts the parsed object, and the `radioInput` `superRefine` at lines 251-274 raises no issue when `optionValue` is non-empty.

**Two branches remain, and this is the one thing we could not settle from the evidence. Stating it rather than guessing:**

- **(a)** the whole `location` response was dropped before `bookingForm.reset`, in which case the effect at `Components.tsx:411-418` (`if (!value) setValue({value: options[0]?.value, optionValue: ""})`) re-created exactly the observed shape, since `options[0]` for this event type **is** `attendeeInPerson`. If (a) holds, the scope is wider than the address field: the whole `location` parameter would be ignored, and "the option is pre-selected" would be a coincidence.
- **(b)** the reset carried the value and only `optionValue` was lost afterwards.

One page load with the parsed responses logged answers this. So does loading the same event type with a **non-first** option, which is the cheap discriminator:

```
/reference-host/multi-location?...&location={"value":"NYC","optionValue":""}
/reference-host/multi-location?...&location={"value":"link","optionValue":""}
```

If those select their options, branch (b) holds. If they fall back to the first option, branch (a) holds and the whole parameter is being discarded.

Provenance: `Components.tsx:411-418` traces to `517cfde5b8a0e4910ea27f21445a516ea372a3ce` (PR #6560, 2023-03-02). The newer half of the interaction is the URL-prefill parse, whose `radioInput` branch was last rewritten by `ad65fbbd811` "fix: change URL prefill behavior to skip only invalid fields (#26982)" (2026-02-18), which introduced the per-field rescue (`preprocessField` try/catch at lines 415-426 and `delete responses[field.name]` at lines 496-503) beside the pre-existing whole-prefill fallback `preprocessed.catch(() => ({}))` at lines 507-513. Treat that as the site of the observed value, not a proven culprit line.

### Evidence

Captured from the run described above:

- A deterministic read of the address input's `value` attribute: no value.
- A full-page screenshot of the rendered form with "In Person (Attendee Address)" selected and the address input showing only the placeholder "Enter address"; an independent visual check of that screenshot reported "no 'Delhi' text is visible" and "the address input contains only the placeholder".
- A 19 second screen recording in which the input is empty in every frame.
- The page text, which lists the four location options and shows the form fully rendered.
- The control, in the same run and on the same instance: `/reference-host/phone-location?...&location={"value":"phone","optionValue":"%2B919999999999"}` produced a phone option input holding `+91 99999-99999` with the India flag selected. Same `radioInput` `optionValue` mechanism, working.

Screenshots, video and the full transcript are available on request.

### Related

- Issue #17394 "Location URL prefill breaks input form" (closed 2024-11-20). Same feature, opposite outcome: the reporter closed his own bug after being told that the documented JSON form `location={"value":"attendeeInPerson","optionValue":"Italy"}` is the working shape, linking this very help article. That is the exact shape that fails here, so this is a regression against a shape that was the accepted working answer in late 2024. There is no open issue describing the current symptom.
- Searches for "prefill location", "optionValue prefill" and "attendeeInPerson" across the org turned up nothing else relevant.

Found by TrueCourse running the product's own help centre documentation against a live instance; the full transcript (page text, screenshots, video) is available on request.
