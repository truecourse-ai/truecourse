---
finding: C1
target: calcom/cal.diy
route: public issue
title: "[Bug]: An out of office entry does not block bookings when the host's availability comes from date overrides"
labels: 🐛 bug (applied automatically by .github/ISSUE_TEMPLATE/bug_report.md)
status: draft
reverified: pending [MEDIUM CONFIDENCE: needs the live re-run to confirm before filing]
---

# [Bug]: An out of office entry does not block bookings when the host's availability comes from date overrides

### Issue Summary

The help centre says an out of office entry "immediately blocks new bookings for that date range", and that the reason's emoji "shows on your booking page during the OOO period". On a self-hosted Cal.diy build the entry is ignored whenever the host's availability for that period comes from date overrides rather than from a weekly working-hours schedule. The covered day is still rendered as an ordinary selectable date, its slots are still offered, and no emoji replaces the date. A host who blocked a vacation day keeps taking bookings through it, with no warning to the host and no signal to the booker.

The cause is a weekday filter in `calculateOutOfOfficeRanges`: it only records an out of office day if that day's weekday appears in the union of the `days` arrays of the user's availability rows. Date-override rows carry a date and an **empty** `days` array, so for a schedule made of date overrides that union is empty and every day of every out of office entry is dropped. The same filter was copied into the Holidays path, so country holidays inherit the identical hole.

Two notes on scope, so nobody triages this into the wrong tree. The sentences quoted below come from the cal.com help centre, which documents the commercial product; Cal.diy publishes no substitute for that page. The reproduction below is on Cal.diy built from source, and the whole out of office render path (`OutOfOfficeEntry` to `calculateOutOfOfficeRanges` to `slots.ts` to `DatePicker.tsx`) ships in this repo. The code involved predates the Cal.diy fork: the filter was added by PR #13621 in April 2024. Nothing here is a claim about the hosted Cal.com product, whose source is not public.

**Docs**

https://cal.com/help/availabilities/out-of-office

> Out of office (OOO) lets you mark periods where you're unavailable so people can't book you

> Choose a **reason** from the dropdown (for example, vacation, sick leave, public holiday). Each reason has an emoji that shows on your booking page during the OOO period.

> The entry appears in your list and immediately blocks new bookings for that date range.

### Steps to Reproduce

Build tested: `calcom/cal.diy` `main` @ `038381aeca6261635357957d66b8ba85cdb29737`, run from source. Web app started with `yarn workspace @calcom/web start`, Postgres and Redis from the repo's docker compose, browser driven headless.

1. Create a user with one event type (30 minutes) and a schedule whose availability for the target period is a **date override**, not a weekly day. For the run below the seeded host `reference-host` was bookable only on 2030-06-12, 09:00 to 12:00, and on no weekday at all.
2. Add an out of office entry for that same date (2030-06-12), pick a reason whose emoji is 🏝️, and leave the note at its default (private) privacy.
3. Open the host's public booking page for that month: `GET /reference-host/ooo-consult?month=2030-06`.
4. Look at 12 June in the calendar and at the slot column beside it.

Minimal variant without the UI, for a maintainer who wants it in one step: one user, one availability row that is a date override on day D from 09:00 to 12:00, one out of office entry covering D, then read the slots for D. `calculateOutOfOfficeRanges` returns `{}` and the day comes back with `away: false` and live slots.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

### Actual Results

12 June 2030 is rendered as a normal, selectable day labelled `12`, is auto-selected, and offers six bookable 30 minute slots: 9:00am, 9:30am, 10:00am, 10:30am, 11:00am, 11:30am. No element named 🏝️ exists anywhere on the page. The out of office entry has no effect on either the calendar or the slot list.

### Expected Results

12 June 2030 is not selectable and offers no slots, and the day cell shows the reason's emoji 🏝️ in place of the date, which is what `DatePicker.tsx` renders once the day carries `away: true`.

### Technical details

Culprit: `packages/features/availability/lib/getUserAvailability.ts`, lines 744 to 755, at the tested commit:

https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/packages/features/availability/lib/getUserAvailability.ts#L744-L755

`calculateOutOfOfficeRanges` builds the `datesOutOfOffice` map that drives both symptoms. Before recording an out of office day it computes

```ts
const flattenDays = Array.from(new Set(availability.flatMap((a) => ("days" in a ? a.days : []))))
```

and then skips the day with `if (!flattenDays?.includes(dayNumberOnWeek)) { continue; }`. Only weekly working-hours rows carry `days`; date-override rows carry a date and an empty `days` array. A schedule whose availability for the period is date-specific therefore yields `flattenDays = []` and every day of every entry is skipped, so the function returns `{}`. That empty map is passed to `buildDateRanges` as `outOfOffice`, so `packages/features/schedules/lib/date-ranges.ts` never overwrites the day's range with a zero-length one and `oooExcludedDateRanges` equals the ordinary `dateRanges`. The same empty map reaches `packages/features/schedules/lib/slots.ts` (lines 188 to 218), the only place a slot is stamped `away: true` and given an emoji, so `packages/features/calendars/components/DatePicker.tsx` computes `away = false` and renders the date instead of the emoji. One filter explains both the live slots and the missing emoji.

The intent of the filter is reasonable, do not paint out of office on days the host never works. It is simply blind to date overrides, which are precisely the rows that make an otherwise non-working day bookable.

Introduced by commit `880ba8f1dd`, PR #13621 "feat: ooo-v2", 2024-04-09 (then at `packages/core/getUserAvailability.ts`; the later blame hits are pure file moves). Commit `12e07f20d4`, PR #25561 "feat: Add Holidays feature to block availability on public holidays", 2025-12-15, copied the identical guard into `calculateHolidayBlockedDates` in the same file, around lines 860 and 870, with the comment "Match OOO pattern", so the Holidays feature has the same defect.

Still present on today's default branch, byte-identical and at the same line numbers, at `176037d0afbe572f870a3c702985e7cd83fe6c0c`:

https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/packages/features/availability/lib/getUserAvailability.ts#L744-L755

Worth knowing while fixing it: `calculateOutOfOfficeRanges` has no unit test anywhere in the repo. The only out of office coverage, `packages/features/schedules/lib/date-ranges.test.ts` line 548, hands `buildDateRanges` a pre-built `outOfOffice` map and so drives straight past this filter.

Node.js version was not captured in the run metadata; everything else about the build is above.

### Evidence

Captured page text of `/reference-host/ooo-consult?month=2030-06` (excerpt, the full screenshot `step-1.png` and the session recording are available):

```
OOO Consult
30m
Select...
June 2030
MON TUE WED THU FRI SAT SUN
1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30
Wed12
12h 24h
9:00am
9:30am
10:00am
10:30am
11:00am
11:30am
```

Assertion result: expected the day button named 🏝️ to be present and disabled; actual, no button named 🏝️ is on the page, and the buttons on the page are the plain dates `1` through `20`. The page finished loading normally (10.4 s, no timeout) and the slot query resolved, so this is not a harness timeout. Console output carried only unrelated warnings (`markdownToSafeHTML` client-side import, a zustand deprecation, react-i18next init).

One limitation stated plainly: this run did not read the seeded `OutOfOfficeEntry` row back out of the database afterwards, so the trigger is inferred from the fact that the entry was seeded and the day was still fully bookable. The seed created an event type dedicated to this case (`ooo-consult`) and pinned the emoji and note values. A maintainer can settle it in one shot with the minimal variant in the steps above.

### Related

- #29951 (open) "[Bug]: Out of Office allows saving overlapping date ranges without any warning" names the same function, `calculateOutOfOfficeRanges`, but a different defect: two overlapping entries collapse into one date-keyed map entry with last write wins and no deterministic ordering. It says nothing about the weekday filter or about date overrides. Not a duplicate, cross-linked so the two are not merged by mistake.

Found by TrueCourse running the published documentation against a live instance; the full transcript (page text, screenshot, console output, server log) is available on request.
