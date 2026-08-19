---
finding: D7
target: documenso/documenso
route: public issue
title: After a distribution-method None send, the document page shows no signing link
labels: bug (bug-report.yml declares labels ['bug']; the repo's real label is `type: bug`)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# After a distribution-method None send, the document page shows no signing link

## Issue Description

The user docs say that choosing **None** as the distribution method redirects the sender to the document page "where signing links are displayed", and that the sender should then copy those links and share them. The product performs the redirect and displays no link. On the landing page the only trace of the promise is a CSS pulse on the recipient rows plus a tooltip forced open on the first recipient; no `/sign/` URL is rendered anywhere on the page. The sender who chose None did so precisely because they intend to distribute the links themselves, so this is the one flow where the links have to be reachable, and it is the flow that surfaces them least.

The mechanism is small and the fix is cheap: Documenso already has a dialog that lists every recipient's signing link, `DocumentRecipientLinkCopyDialog`, and it is already mounted on this very page. It auto-opens on `?action=view-signing-links`. The send dialog redirects with a different value, `?action=copy-links`, which only triggers the pulse-and-tooltip handler. The template flow, whose docs make the identical promise, sends `view-signing-links` and does get the dialog.

Two resolutions are defensible and a maintainer may want both. Code: have the None-distribution redirect use the existing `view-signing-links` action so the promised links are surfaced, which also removes the divergence between the send path and the template path. Docs: the word "displayed" overstates what the product does anywhere, because even that dialog renders the recipient's email plus a Copy button and never the URL text itself, so the accurate wording would be that the document page offers per-recipient copy controls plus a "Signing Links" item in the document's actions menu. A docs-only resolution here is legitimate and this report is not asserting that the code is the wrong half.

### Docs

https://docs.documenso.com/docs/users/documents/send, section "Distribution Without Email" (`apps/docs/content/docs/users/documents/send.mdx`; the redirect sentence is line 218 at today's head):

> If you choose **None** as the distribution method:
>
> The document is sent without notifying recipients.
>
> You're redirected to the document page where signing links are displayed.
>
> Copy the links and share them through your preferred channel (SMS, messaging app, etc.).

The same promise is repeated for templates at `apps/docs/content/docs/users/templates/use.mdx:107`: "you're redirected to the document page where signing links are displayed for you to copy and share."

### Cause

`apps/remix/app/components/dialogs/envelope-distribute-dialog.tsx:185-191` (https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/apps/remix/app/components/dialogs/envelope-distribute-dialog.tsx#L185-L191) appends `?action=copy-links` to the redirect when `meta.distributionMethod === DocumentDistributionMethod.NONE`.

`apps/remix/app/components/general/document/document-page-view-recipients.tsx` reads that value at line 48 and does not reveal any link with it. It sets `shouldHighlightCopyButtons`, which applies `animate-pulse` to every recipient row (line 202) and forces a Radix tooltip reading "Copy Signing Links" open for the first recipient only (line 199, `open={shouldHighlightCopyButtons && i === 0}`); the flag is cleared by the first click anywhere in the wrapper (line 203). On a multi-recipient None send, recipients 2..N therefore pulse with no explanation at all.

Meanwhile the same route mounts `DocumentRecipientLinkCopyDialog` (`apps/remix/app/routes/_authenticated+/t.$teamUrl+/documents.$id._index.tsx:111-113`), whose auto-open effect keys on `actionSearchParam === 'view-signing-links'` (`apps/remix/app/components/general/document/document-recipient-link-copy-dialog.tsx:61`), a value produced only by the template path (`template-use-dialog.tsx:177`).

The likely reason the two paths diverged is visible in the identifiers: at `document-page-view-recipients.tsx:46-48` the comment says "Check for action=view-tokens query parameter", the variable is `hasViewTokensAction`, the value compared is `copy-links`, and the sibling flow uses `view-signing-links`. Three names for one concept.

Introduced by PR #2102 "fix: envelope styling" (commit `5cdd7f8623`, 2025-10-27), which added the post-send redirect and chose the new `copy-links` value plus the pulse handler rather than the pre-existing `view-signing-links` value. The copy-only design and the `view-signing-links` convention come from PR #1449 "feat: add signing link copy" (2024-11-06). The doc sentence was written later, by PR #2460 "feat: docs v2" (2026-02-27), four months after the code it describes.

Still present at today's head: both files are byte-identical between v2.16.0 and v2.17.0, so v2.17.0 ships the same behavior. https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/remix/app/components/dialogs/envelope-distribute-dialog.tsx#L185-L191 and https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/remix/app/components/general/document/document-page-view-recipients.tsx#L194-L223

### Related

- #2490 "Signing Links copy : can't get url for sign" (closed as stale 2026-08-03): a self-hosted user who could not get a URL out of this exact control.
- #1169 "Copy signing link to send to recipients" (closed): the original request; the reporter's own follow-up is a discoverability complaint about this control ("I found the option now, I need to click in the signer email to copy the link").
- #1449 (merged 2024-11-06) created the link dialog, the `view-signing-links` action and the unnamed copy button.
- #2102 (merged 2025-10-27) is the change that introduced the redirect with the weaker action value.
- #3197 "Send dialog keeps the subject/message captured at first mount" (open) is a different defect in the same send dialog with an open fix PR #3246, so expect line drift in `envelope-distribute-dialog.tsx`.
- A companion report covers the two unnamed controls on this page (the copy button and the three-dots trigger). They are what makes this failure unrecoverable for a screen reader user, but they have a different fix and are filed separately.

## Steps to Reproduce

Tested on tag `v2.16.0` (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17, driven with headless Chromium.

1. Sign in and go to `/t/<team>/documents`.
2. Upload a PDF. The browser lands in the editor at `/t/<team>/documents/envelope_<id>/edit`.
3. Add one recipient (email address, name) and set the role to "Needs to view" (a VIEWER, so that the send is not blocked by the missing signature field a SIGNER would need).
4. Click **Send Document**.
5. In the send dialog, choose the **None** tab. It confirms with "We won't send anything to notify recipients".
6. Click **Generate Links**.
7. The browser is redirected to `/t/<team>/documents/envelope_<id>?action=copy-links`, a toast says "Envelope distributed", and the query parameter is then stripped. Read the page.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. After a distribution-method None send the document page carries no /sign/ in its text, in any anchor href, or in any input value; the redirect carries ?action=copy-links, and the "Copy Signing Links" dialog behind the unnamed three-dots menu does not display the link either, only a Copy button.

Screenshot of the landing page from the run is available on request.

## Expected Behavior

After a None distribution send, the document page surfaces the recipients' signing links, as `send.mdx` and `templates/use.mdx` both state. The shortest version of that is to redirect with `?action=view-signing-links` so the already-mounted `DocumentRecipientLinkCopyDialog` opens with every recipient listed, which is what the template flow does today. If instead the pulse-the-copy-icon design is intended as-is, then the two doc sentences should be corrected to describe copy controls rather than displayed links.

## Current Behavior

The redirect happens, the document is distributed correctly (status Pending, recipient Pending), and the page renders no signing link. The full rendered page text on the landing page was:

```
Documents / tc-nomail-377c10250e.pdf / Pending / 1 Recipient
Page 1 of 1
Document pending
Waiting on 1 recipient
Edit
Information: Uploaded by You, Created August 14, 2026, Last modified 0 seconds ago, Document ID (Legacy) 371
Recipients
377c10250e@documenso.test    Viewer    Pending
Recent activity: You created the document (1 sec. ago), You sent the document (0 sec. ago)
Copy Signing Links
Copy Signing Links
```

There is no `/sign/` substring anywhere in it. The only occurrence of the words "Copy Signing Links" is the Radix tooltip content, which appears twice because Radix also renders a visually hidden copy; it is tooltip text, not a label on a control.

## Operating System

macOS 26.5

## Browser

Chromium (headless, via Playwright 1.62.1)

## Version

2.16.0 (tested build). Re-checked in source against v2.17.0 (`75330166cc`, today's `main`): both culprit files and both doc pages are byte-identical, so the behavior is unchanged in the current release.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (clicks, page text, screenshots, server log) is available on request.
