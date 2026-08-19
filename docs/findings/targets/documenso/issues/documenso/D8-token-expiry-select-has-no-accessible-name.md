---
finding: D8
target: documenso/documenso
route: public issue
title: The "Expires in" chooser in the Create API token dialog has no accessible name
labels: bug (bug-report.yml declares labels ['bug']; the repo's real label is `type: bug`)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# The "Expires in" chooser in the Create API token dialog has no accessible name

## Issue Description

In Settings > API Tokens > Create token, the expiry chooser renders a visible "Expires in" label above a Radix select trigger, but the two are not associated: the label's `htmlFor` points at an id that never lands on a DOM element, and the trigger carries no `aria-label` or `aria-labelledby`. The control's accessible name is empty. A screen reader announces role and current value ("3 months") with no indication of what is being selected, clicking the "Expires in" text does not focus or open the control, and no role-plus-name locator can address it, which is how this was found: `getByRole('combobox', { name: 'Expires in' })` matches zero elements on the open dialog.

The Name field in the same dialog is the cleanest possible contrast: its `FormControl` child is `<Input>`, a real DOM element, so the Slot's id lands, the label associates, and `getByRole('textbox', { name: 'Name' })` resolves without trouble.

This is not one isolated field. In the tested tree the same `FormControl` wrapping `Select` pattern appears 46 times, and exactly 1 of 84 `SelectTrigger`s carries an `aria-label`. One change to the shared pattern fixes all of them.

A separate, smaller wording matter on the same control, mentioned here because it is one word and lives in `apps/docs/` in this same repo: the docs enumerate the expiry periods as "never expires, 7 days, 1 month, 3 months, 6 months, or 1 year" while the dialog labels the longest period "12 months". The durations are identical (`ONE_YEAR` resolves to `Duration.fromObject({ years: 1 })`), so this is a label mismatch, not a functional one, and the fix belongs on whichever side the maintainers prefer. This half is a documentation matter (`apps/docs/content/docs/developers/getting-started/authentication.mdx`) and may warrant the `type: documentation` label.

### Docs

https://docs.documenso.com/docs/developers/getting-started/authentication, section "Create an API Token > Generate a new token" (`apps/docs/content/docs/developers/getting-started/authentication.mdx`, line 51 at today's head; it was line 49 at the tested tag):

> * Select an expiration period: never expires, 7 days, 1 month, 3 months, 6 months, or 1 year

### Cause

`apps/remix/app/components/dialogs/token-create-dialog.tsx:203-231` (https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/apps/remix/app/components/dialogs/token-create-dialog.tsx#L203-L231).

`FormControl` (`packages/ui/primitives/form/form.tsx:96-111`) is a Radix `Slot` that applies `id={formItemId}`, `aria-describedby` and `aria-invalid` to its single child, and `FormLabel` (lines 78-95) renders `<label htmlFor={formItemId}>`. In this field the Slot's child is `<Select>`, which is `SelectPrimitive.Root` (`packages/ui/primitives/select.tsx:10`), a non-DOM provider component that does not spread unknown props onto the trigger. The id is dropped, so the label's `htmlFor` dangles. `SelectTrigger` (`select.tsx:16-46`) forwards no `aria-label` or `aria-labelledby` of its own, and the Radix trigger renders `<button role="combobox">`; `combobox` is not a name-from-content role, so the visible value text "3 months" does not name it either. Net effect: no accessible name at all.

The dialog was re-authored by PR #3076 "feat: redesign api tokens settings page" (`3ff7f70a7d`, 2026-07-15), which carried the defect rather than creating it: the file it replaced had the identical `FormControl` > `Select` > `SelectTrigger` nesting, blaming back to `b9e5905469` (2024-02-20). The "12 months" label predates the redesign too.

Still present at today's head, and one plausible incidental fix has been ruled out: `#3107 feat: migrate to react 19` landed in this window and touched neither the dialog nor `form.tsx` nor `select.tsx`, all three of which are byte-identical to the tested tree. https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/remix/app/components/dialogs/token-create-dialog.tsx#L203-L231

The minimal fix is the shadcn convention: move `FormControl` to wrap `SelectTrigger` instead of `Select`, so the Slot's id lands on the real button. Adding `aria-label` to this one `SelectTrigger` also works but only fixes this field.

### Related

- #3076 (merged 2026-07-15) is the redesign that ships the current markup.
- #2349 (closed unmerged) touched this same field's validation and never its accessible name.
- #3201 "Multiselect remove/clear buttons lack type="button" and submit the surrounding form" (open) is a different defect on a different primitive, listed because it is the nearest precedent that shared-primitive markup bugs are accepted as issues here.
- #3230 "feat: last used column for api tokens" (open) edits the API tokens settings page this dialog belongs to, so a fix here may need rebasing around it.
- A tracker search for "accessibility" returns 25 items and not one concerns an accessible name, an `aria-label` or an unlabeled control, so this appears to be unreported.

## Steps to Reproduce

Tested on tag `v2.16.0` (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17, driven with headless Chromium.

1. Sign in and go to `/t/<team>/settings/tokens`.
2. Click **Create token**. The dialog opens with a Name textbox and, below it, a visible "Expires in" label over a trigger reading "3 months".
3. Inspect the trigger: `<button type="button" role="combobox" class="bg-background ...">` with no `id`, no `aria-label` and no `aria-labelledby`, while the label above it is `<label for="...-form-item">` pointing at an id that is on no element in the document.
4. Equivalently, from a test or the accessibility tree, try to address it by name, for example `page.getByRole('combobox', { name: 'Expires in' })`. It matches 0 elements. For contrast, `page.getByRole('textbox', { name: 'Name' })` in the same dialog resolves immediately.
5. Click the "Expires in" text. Nothing focuses and the list does not open.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. getByRole('combobox', {name:'Expires in'}).count() is 0 and the aria snapshot reads "combobox: 3 months" with no name; clicking positionally reveals the six options as 7 days, 1 month, 3 months, 6 months, 12 months and Never, so the previously unobserved "12 months" vs docs "1 year" mismatch is now recorded.

## Expected Behavior

The expiry chooser is programmatically labelled by its visible "Expires in" label, so a screen reader announces the field's purpose, clicking the label focuses the control, and the control is addressable by role and name. The same applies to the other 45 `FormControl` wrapping `Select` sites, which a single change to the shared pattern would fix.

Separately, the label of the longest expiry period and the documented list agree: either the dialog says "1 year" or `authentication.mdx` says "12 months".

## Current Behavior

The trigger's accessible name is empty. The step that opens the chooser cannot act at all: after a 10.1s wait the runner reported "no combobox named 'Expires in' is on the page", while the page inventory shows exactly one combobox whose inner text is "3 months". The dialog's own rendered text at that moment lists all six periods, so the options exist and are simply unreachable by name:

```
Create API token
Use API tokens to authenticate with the Documenso API.
Name*
A name to help you identify this token later.
Expires in
3 months
7 days
1 month
3 months
6 months
12 months
Never
Cancel
Create token
```

Note in that listing the sixth period reads "12 months" where the docs say "1 year".

## Operating System

macOS 26.5

## Browser

Chromium (headless, via Playwright 1.62.1)

## Version

2.16.0 (tested build). Re-checked in source against v2.17.0 (`75330166cc`, today's `main`): `token-create-dialog.tsx`, `packages/ui/primitives/form/form.tsx` and `packages/ui/primitives/select.tsx` are all byte-identical, so the unnamed control ships in the current release.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (clicks, page text, screenshots, server log) is available on request.
