---
finding: C11
target: calcom/cal.diy
route: public issue
title: "[Bug]: The booking form's phone control has no accessible name, and its visible label points at an id nothing carries"
labels: "🐛 bug"
status: draft
reverified: pending (source re-checked 2026-08-19 at calcom/cal.diy main 176037d0afbe572f870a3c702985e7cd83fe6c0c: PR #29740 edited the same JSX block on 2026-08-05 and added no id or aria-label, so the defect is unchanged)
---

# [Bug]: The booking form's phone control has no accessible name, and its visible label points at an id nothing carries

### Issue Summary

On every public booking page that shows a phone field, the `<input type="tel">` has no `id`, no `aria-label` and no `aria-labelledby`, and its placeholder is empty, so its accessible name is empty. The visible "Phone number" label is rendered as `<Label htmlFor="attendeePhoneNumber">` against an input that carries no such id, so the label is orphaned markup: screen reader and voice control users address an unnamed edit box, and clicking the visible label does not focus the field.

This bites hardest on a phone-only event type, where the phone control is the only confirmation channel the booker can supply and the email field is deliberately absent.

Every other widget in the same factory file gets an id. The email factory three lines below the phone factory passes `id={props.name}`. The phone factory does not.

Note on scope: PR #29740 (merged 2026-08-05) edited this exact JSX block, three lines above the offending `inputProps`, and fixed a different bug (the `attendeePhoneNumber` prefill). It did not add an id or an aria-label. This issue is not covered by that PR.

The reproduction is on Cal.diy built from source. The same code is on `main` today.

### Steps to Reproduce

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31), `@calcom/web` 6.2.0, built with `yarn build` and served with `yarn workspace @calcom/web start`, against Postgres and Redis in Docker. Browser: headless Chromium driven by Playwright 1.62.

1. Create an event type whose booking form shows a phone field. Either works: a phone-only event type (Advanced, confirmation by phone), or any event type with the system "Phone number" booking question unhidden.
2. Open its public booking page, pick a day and a time so the booking form is shown. For example `/reference-host/phone-only`, then day 15, then the first `:00` slot.
3. In the rendered form, inspect the phone control, or query it by role and accessible name.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.. The source was re-read at `main` on 2026-08-19 and the three lines above are unchanged.

### Actual Results

The field is plainly visible under the label "Phone number *", and it cannot be addressed by name. A Playwright query for `getByRole('textbox', { name: 'Phone number' })` (substring matching, so a trailing asterisk still matches) resolves 0 elements. The same run resolves `textbox "Your name"` and `textbox "Email address"` on other booking pages, so the lookup works on this app's other inputs. Only the phone control is unnamed.

Page text captured from the live phone-only page:

```
Reference Host
Phone Only
Tuesday, September 15, 2026
10:00 - 10:30 am
30m
UTC
Your name*
Phone number
*
Additional notes
Add guests
By proceeding, you agree to Cal.diy's Terms and Privacy Policy.
Back
Confirm
```

The rendered input is `<input type="tel" name="attendeePhoneNumber" ...>` with no `id`, no `aria-label`, no `aria-labelledby` and an empty placeholder, while the label above it is `<label for="attendeePhoneNumber">`.

The one place the control does appear named is the attendee-phone **location** variant, and only by accident: `BookingFields.tsx:190-195` gives that variant a runtime placeholder, `t("enter_phone_number")`, and the placeholder is the only accessible-name source the control has. The booking-question variant has no placeholder, so it has no name at all.

### Expected Results

The phone input has an accessible name matching its visible label, and the label's `for` attribute points at the input's `id`, so assistive technology can identify the field and clicking the label focuses it. WCAG 1.3.1 and 4.1.2.

### Technical details

Three files, all three still current on `main`.

Permalink at the tested commit: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/web/components/phone-input/PhoneInput.tsx#L105-L132
Same block on `main` today (shifted down three lines by PR #29740): https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/web/components/phone-input/PhoneInput.tsx#L105-L135

1. `apps/web/modules/form-builder/components/FormBuilderField.tsx:174-180` (called with `htmlFor={field.name}` at `:277`) renders `<Label htmlFor={field.name}>`, so for the system field the label declares `for="attendeePhoneNumber"`.
2. `apps/web/modules/form-builder/components/Components.tsx:192-209`, the phone factory, forwards only `{...props}` to `PhoneInput` and never passes `id`. The email factory at `:210-228` passes `id={props.name}` at line 220. Text, textarea, number, address and select do the same.
3. `apps/web/components/phone-input/PhoneInput.tsx` declares `id?: string` at line 17 and never uses it. `BasePhoneInputWeb` spreads `{...rest}` onto `react-phone-input-2` and builds `inputProps={{ name, required: rest.required, placeholder: rest.placeholder, autoComplete: "tel" }}` (lines 127-132 on `main`). `react-phone-input-2` 2.15.x renders its `<input type="tel">` from a fixed prop list (className, style, handlers, value, placeholder, disabled, type) plus `inputProps` only, and drops a top-level `id`.

`attendeePhoneNumber` is defined with `defaultLabel: "phone_number"` and no `defaultPlaceholder` (`packages/features/bookings/lib/getBookingFields.ts:122-135`), so the placeholder resolves to `""` and the accessible name is empty.

The fix is two coordinated lines and **both** are needed:

- pass `id={props.name}` in the `Components.tsx` phone factory, as the email factory already does, and
- forward it through `PhoneInput` inside `inputProps`, because `react-phone-input-2` silently drops a bare top-level `id`.

Doing either one alone changes nothing.

The label side traces to `8dbd96a2f9f` (2024-08-08, PR #15742), and no caller has ever put that id on the `react-phone-input-2` input, so this has been true since the label was introduced.

Supporting detail worth a maintainer's attention: the repository's own e2e code already works around this. `apps/web/playwright/lib/testUtils.ts:212` selects the control as `[name="attendeePhoneNumber"]` rather than by role and name.

### Evidence

Captured from the run described above, on two different event types in the same run:

- Phone-only event type: page text quoted above, plus a screenshot of the rendered form showing "Your name *", "Phone number *" with a US flag selector and a "+1" value, and "Additional notes". An independent visual check of that screenshot reported the field "plainly present visually", confirming the page rendered and the lookup, not the page, is what failed.
- Phone-question event type at `/reference-host/phone-question`: the same 0-element result for `textbox "Phone number"`, on a page whose text lists "Phone number" between "Email address" and "Additional notes".
- Control in the same run: on the attendee-phone **location** page, `textbox "Phone"` does resolve, with value `+91 99999-99999`, because that variant is given the `enter_phone_number` placeholder. Same component, named only when a placeholder happens to be supplied.
- A DOM fixture of both shapes under Playwright 1.62 reproduces it in isolation: the dangling `for=` plus an empty placeholder gives 0 matches for "Phone" and "Phone number", while a properly labelled input matches.

Screenshots and the full transcript are available on request.

### Related

- PR #29740 "fix(bookings): provide stable country fallback for phone input" (merged 2026-08-05) changed one line inside this same JSX block and added no id or aria-label. Please do not close this as covered by it.
- PR #29761 (open) "fix(booking-page): hide duplicate phone fields for attendee phone location" touches `BookingFields.tsx`, the file that injects the only accessible name the location variant has. It adds no id or aria-label either.
- PR #26367 (open) "feat(api): allow skipping label for phone field in the v2 create event api's booking fields" would let a caller suppress the visible label, which makes this worse rather than better: no label at all instead of an orphaned one.
- Searches for "aria-label accessibility input" and "PhoneInput label" across the org returned 0 results each, so this appears unreported.

Found by TrueCourse running the product's own help centre documentation against a live instance; the full transcript (page text, screenshots, video) is available on request.
