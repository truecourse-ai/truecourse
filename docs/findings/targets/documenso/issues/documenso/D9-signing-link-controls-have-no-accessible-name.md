---
finding: D9
target: documenso/documenso
route: public issue
title: Both routes to a document's signing links are icon-only controls with no accessible name
labels: bug (bug-report.yml declares labels ['bug']; the repo's real label is `type: bug`)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# Both routes to a document's signing links are icon-only controls with no accessible name

## Issue Description

On the document page, the two controls that lead to a recipient's signing link are both icon-only and both have an empty accessible name:

1. The per-recipient copy control, `CopyTextButton`, is a `<Button>` whose only content is a lucide `CopyIcon` svg. It has no `aria-label`, no `title` and no visually hidden text. The words "Copy Signing Links" exist only as Radix `TooltipContent`, which Radix wires as `aria-describedby` (a description, not a name) on the wrapping `<div>` trigger rather than on the button, and which is force-open only for the first recipient.
2. The document page's three-dots actions trigger is `<DropdownMenuTrigger data-testid="document-page-view-action-btn">` containing only a `MoreHorizontal` svg. `data-testid` is not an accessible name. That menu holds the only textually named route to the links, the "Signing Links" item that opens the recipient link dialog.

A screen reader user therefore hears two unlabelled buttons and has no way to know that either one leads to the signing links, and no role-plus-name locator can address either control.

This matters most immediately after a distribution-method None send, where the docs promise the sender will be shown the signing links and these two unnamed controls are the only routes to them. That flow is reported separately; this report is about the naming, which is a different fix with a different audience.

Both are one-line fixes: an `aria-label` (or sr-only text inside the button). `CopyTextButton` is a shared primitive, so labelling it once covers every use.

### Docs

The user docs point at this affordance without naming a control, https://docs.documenso.com/docs/users/documents/send, section "Distribution Without Email" (`apps/docs/content/docs/users/documents/send.mdx`, the last step of that section, a few lines after the redirect sentence at line 218 of today's head):

> Copy the links and share them through your preferred channel (SMS, messaging app, etc.).

### Cause

`packages/ui/components/common/copy-text-button.tsx:40-71` (https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/ui/components/common/copy-text-button.tsx#L40-L71) returns `<Button type="button" variant="none" className=... onClick=...>` whose only child is the lucide `<CopyIcon>` / `<CheckSquareIcon>` at line 66. lucide-react emits a bare `<svg>` with no `<title>`, so the accessible name computation has nothing to work with and the result is the empty string.

The label text lives elsewhere: `apps/remix/app/components/general/document/document-page-view-recipients.tsx:217-220` renders `<TooltipContent>Copy Signing Links</TooltipContent>` attached to the wrapping `<div>` `TooltipTrigger` at line 200. Radix exposes tooltip content as `aria-describedby`, which is a description and never a name, and here the tooltip is only forced open for `i === 0`.

`apps/remix/app/components/general/document/document-page-view-dropdown.tsx:72-75` is `<DropdownMenu><DropdownMenuTrigger data-testid="document-page-view-action-btn"><MoreHorizontal className="h-5 w-5 text-muted-foreground" /></DropdownMenuTrigger>`. The "Signing Links" menu item further down the same file (lines 162-171) is the only textually named path to `DocumentRecipientLinkCopyDialog`, and it sits behind that unnamed trigger.

`CopyTextButton` was created without an accessible name by PR #1449 "feat: add signing link copy" (merged 2024-11-06) and has never had one. PR #2102 "fix: envelope styling" (merged 2025-10-27) added the pulse-and-tooltip handling around it.

Still present at today's head: all three files are byte-identical between v2.16.0 and v2.17.0, and `#3107 feat: migrate to react 19` did not touch any of them. https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/ui/components/common/copy-text-button.tsx#L40-L71 and https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/remix/app/components/general/document/document-page-view-dropdown.tsx#L72-L75

### Related

- #1449 (merged 2024-11-06) introduced `CopyTextButton` unnamed.
- #2102 (merged 2025-10-27) added the tooltip-and-pulse treatment around it.
- #2490 "Signing Links copy : can't get url for sign" (closed as stale 2026-08-03): a user who could not get a URL out of this exact control.
- #3201 "Multiselect remove/clear buttons lack `type="button"` and submit the surrounding form" (open): a different shared-primitive markup defect, filed as an ordinary issue and already picked up by two competing PRs (#3236, #3256). Useful precedent for this class, and a warning that trivial shared-primitive fixes here attract duplicates.
- A companion report covers the None-distribution send landing page, where these two controls are the only routes to the links the docs promise.
- A tracker search for "accessibility" returns 25 items with none about an accessible name or an unlabeled control, so this appears to be unreported.

## Steps to Reproduce

Tested on tag `v2.16.0` (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17, driven with headless Chromium.

1. Sign in, upload a PDF, add one recipient, and send the document (any distribution method).
2. Open the document page at `/t/<team>/documents/envelope_<id>`.
3. In the Recipients card, inspect the small copy control beside the recipient's email: `<button type="button">` containing only an `<svg>`, with no `aria-label`, no `title` and no text node. Its computed accessible name is empty.
4. Inspect the three-dots control in the page header: `<button data-testid="document-page-view-action-btn">` containing only an `<svg>`. Also empty.
5. Equivalently, try to address either by name, for example `page.getByRole('button', { name: 'Copy Signing Links' })`. It matches 0 elements even though the string "Copy Signing Links" is present in the page text, because that string is the tooltip's content.

Scope note, stated plainly: on the run that produced this report the step that exercises the copy control never executed, because the preceding step (the None-send landing page, reported separately) failed first. Both controls were confirmed by reading the source at the tested tag and by the run's page-text capture, which shows "Copy Signing Links" appearing twice as tooltip text (Radix renders a visually hidden duplicate) and never as a control label. No screen-reader session was run.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces, converted from source reading to an executed observation. The recipient-row CopyTextButton and the three-dots trigger (data-testid document-page-view-action-btn) both snapshot as a bare "- button", and 5 of the 9 buttons on the page have an empty accessible name; inside the dialog the same copy action does get the name "Copy".

## Expected Behavior

Both controls carry an accessible name, so a screen reader announces what they do and a role-plus-name locator can reach them. For example, `aria-label="Copy signing link"` on `CopyTextButton` (or sr-only text inside the button, which also keeps the name in sync with the tooltip), and `aria-label="Document actions"` on the three-dots `DropdownMenuTrigger`.

## Current Behavior

Both controls compute an empty accessible name. The rendered page text on the document page ends with the tooltip content, duplicated by Radix, which is the only place the phrase appears:

```
Recipients
377c10250e@documenso.test    Viewer    Pending
Recent activity: You created the document (1 sec. ago), You sent the document (0 sec. ago)
Copy Signing Links
Copy Signing Links
```

## Operating System

macOS 26.5

## Browser

Chromium (headless, via Playwright 1.62.1)

## Version

2.16.0 (tested build). Re-checked in source against v2.17.0 (`75330166cc`, today's `main`): `copy-text-button.tsx`, `document-page-view-recipients.tsx` and `document-page-view-dropdown.tsx` are all byte-identical, so both unnamed controls ship in the current release.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (clicks, page text, screenshots, server log) is available on request.
