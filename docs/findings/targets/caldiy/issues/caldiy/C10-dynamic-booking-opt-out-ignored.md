---
finding: C10
target: calcom/cal.diy
route: public issue
title: "[Bug]: A dynamic group link containing a user who turned dynamic bookings off still renders a bookable group page"
labels: "🐛 bug"
status: draft
reverified: pending (source re-checked 2026-08-19 at calcom/cal.diy main 176037d0afbe572f870a3c702985e7cd83fe6c0c: unchanged, and `allowDynamicBooking` still appears nowhere in the culprit file) [MEDIUM CONFIDENCE: needs the live re-run to confirm before filing]
---

# [Bug]: A dynamic group link containing a user who turned dynamic bookings off still renders a bookable group page

### Issue Summary

Dynamic group booking is documented as an opt-in that a user can turn off. Turning it off has no effect on what a booker sees. Opening `/{userA}+{userB}` where `userB` has `allowDynamicBooking = false` still renders a complete, apparently bookable group page: the group title, the duration chips, the location select and a live calendar. The opt-out is enforced only downstream, after the page has rendered, and the reason never reaches the booker: the slots query fails with 401 "Some of the users in this group do not allow dynamic booking", and the Booker turns that into the generic "No availability in September" dialog, which is indistinguishable from a genuinely full calendar.

Enforcement itself holds, so nothing unwanted gets booked (the slots query returns 401 and the booking POST returns 400). The defect is that the opted-out user is still assembled into a public page and that nobody, booker or host, is told the link can never be booked.

Filing this as "the opt-out has no effect on the public page", not as "the link should 404". The remedy is a product decision: the product's own historical behaviour was a 200 page reading "Unavailable / Some of the users in the group have currently disabled dynamic group bookings", not a 404.

The reproduction is on Cal.diy built from source. The same code is on `main` today.

The documentation this contradicts, https://cal.com/help/event-types/dynamic :

> This is an opt-in feature where a cal.com user can enable/disable if they wish to participate in this and allow the bookers to add them as part of a dynamic collective group.

### Steps to Reproduce

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31), `@calcom/web` 6.2.0, built with `yarn build` and served with `yarn workspace @calcom/web start`, against Postgres and Redis in Docker. Browser: headless Chromium driven by Playwright.

1. Have two users, `reference-host` and `opted-out-host`, both with a working availability schedule.
2. On `opted-out-host`, turn off dynamic group bookings (Settings, My account, General, the dynamic group links toggle). Equivalently, set `allowDynamicBooking = false` on that user row.
3. As a logged-out visitor, open `/reference-host+opted-out-host`.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

The request 302-redirects to `/reference-host+opted-out-host/dynamic?user=reference-host%2Bopted-out-host&duration=30&month=2026-09` and returns 200 with the Booker fully rendered. Page text captured from the live page:

```
Group Meeting
Join us for a meeting with multiple people
15m  30m  45m  1h  1h 30m
Cal Video
Select...
September 2026
MON TUE WED THU FRI SAT SUN
1 2 3 ... 30
No availability in September
Close
View next month
```

Both `viewer.slots.getSchedule` calls fail, from the browser console:

```
Failed to load resource: the server responded with a status of 401 (Unauthorized)
<< query #1 viewer.slots.getSchedule ... TRPCClientError: Some of the users in this group do not allow dynamic booking
Failed to load resource: the server responded with a status of 401 (Unauthorized)
<< query #4 viewer.slots.getSchedule ... TRPCClientError: Some of the users in this group do not allow dynamic booking
```

So the server computed the precise reason and the client discarded it. The booker sees "No availability in September" and nothing else. There is no notice about the opt-out anywhere on the page.

### Expected Results

The opted-out user is not assembled into a public group page. Either the address does not resolve, or the page renders the state the product used to have for exactly this case: "Unavailable / Some of the users in the group have currently disabled dynamic group bookings". Whichever is chosen, the booker learns why the link is not bookable.

### Technical details

`apps/web/server/lib/[user]/[type]/getServerSideProps.ts`, `getDynamicGroupPageProps` at lines 114-166.

Permalink at the tested commit: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/web/server/lib/%5Buser%5D/%5Btype%5D/getServerSideProps.ts#L114-L166
Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/web/server/lib/%5Buser%5D/%5Btype%5D/getServerSideProps.ts#L114-L166

`getDynamicGroupPageProps` loads the members with `UserRepository.findUsersByUsername`, which does select `allowDynamicBooking` (`packages/features/users/repositories/UserRepository.ts:109`), and then returns `notFound` only when the user list is empty (line 145) or when `getPublicEvent` returns nothing (line 164). It never inspects `user.allowDynamicBooking`. `git grep allowDynamicBooking` over that file on `main` returns zero hits. `getPublicEvent`'s dynamic branch (`packages/features/eventtypes/lib/getPublicEvent.ts:297-341`) builds the default event and `subsetOfUsers` unconditionally as well.

The gate exists only downstream, after the page is already rendered: `packages/trpc/server/routers/viewer/slots/util.ts:201-207` throws `TRPCError UNAUTHORIZED`, and `packages/features/bookings/lib/handleNewBooking/loadAndValidateUsers.ts:98-107` throws `HttpError 400`. The client renders the schedule failure through the ordinary empty-days path (`packages/features/calendars/components/NoAvailabilityDialog.tsx:78`), which is why the reason is lost.

Two pieces of the repository's own state say this is unintended rather than a design choice:

- The comment immediately above the exported `getServerSideProps` still reads, at lines 312-313: "Booker page fetches a tiny bit of data server side, to determine early whether the page should show an away state or dynamic booking not allowed".
- The string `user_dynamic_booking_disabled` ("Some of the users in the group have currently disabled dynamic group bookings") is still shipped in every locale (`packages/i18n/locales/en/common.json:584`) and is referenced by no source file.

Introduced by `b364a85ed857d94a046a278ad5549d3b716b5111` (PR #10053, "chore: removed old booker and make new booker as a default", merged 2023-07-11). This is a regression, not an original omission. Up to `bed3595314` (2023-06-16), `apps/web/pages/[user]/[type].tsx` computed `allowDynamicBooking: !users.some(u => !u.allowDynamicBooking)` in `getServerSideProps` and rendered the dedicated "Unavailable" state. PR #10053 removed both the prop computation and that branch while keeping the now-unread `allowDynamicBooking` in the Prisma select.

Suggested fix: in `getDynamicGroupPageProps`, after `findUsersByUsername`, return `notFound` when `users.some(u => !u.allowDynamicBooking)`, or thread a `dynamicBookingDisabled` prop through to the Booker and re-wire the still-shipped `user_dynamic_booking_disabled` string.

Note for whoever picks this up: `apps/web/server/lib/[user]/getServerSideProps.ts:102-119` has the same gap, redirecting a group address to `/dynamic` unconditionally, and that file currently has four competing community PRs on it for an unrelated query-parameter bug: #28688 and #28734 are open, #28789 and #29273 are closed. A fix there will collide with them.

### Evidence

Captured from the run described above: the rendered page text quoted under Actual Results, the two console errors quoted verbatim from the browser console, a full-page screenshot of the rendered group page showing the duration chips, the location select and the "No availability in September" dialog, and a screen recording of the page load. The tRPC error text is itself the proof that `opted-out-host` really had `allowDynamicBooking = false`, so this is not a fixture problem, and the 401s are the product's own deliberate `UNAUTHORIZED`, not an auth misconfiguration in the harness.

### Related

- Issue #9060 "[CAL-1743] Bring back the Dynamic Group booking opt-out toggle" (closed 2023-05-30): restored the setting control, six weeks before PR #10053 removed the booker-facing enforcement. Nobody has since noticed the restored toggle no longer changes what the group link renders.
- Issue #3755 (closed, 2022): a self-hoster hitting the old page-level notice, which is evidence the removed state was user visible and understood as the surface for this setting.
- PR #10053 (merged 2023-07-11): the change that removed the page-level gate.
- Searches for `allowDynamicBooking` (23 hits) and for dynamic-group activity since 2026-06-01 (5 hits) turned up no report of this.

Found by TrueCourse running the product's own help centre documentation against a live instance; the full transcript (page text, console, screenshots, video) is available on request.
