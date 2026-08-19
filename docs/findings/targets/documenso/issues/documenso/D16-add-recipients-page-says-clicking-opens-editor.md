---
finding: D16
target: documenso/documenso
route: public issue
title: add-recipients.mdx says clicking a document in the dashboard opens the editor; it opens the read-only document page
labels: bug (bug-report.yml declares labels ['bug']; `type: documentation` is the fitting maintainer label)
status: draft
reverified: not re-run (source and doc re-checked 2026-08-19 at v2.17.0)
---

# add-recipients.mdx says clicking a document in the dashboard opens the editor; it opens the read-only document page

## Issue Description

Step 1 of the Add Recipients guide tells the reader to open the document editor by clicking a document in the Documents dashboard. Clicking the row title navigates to `/t/<team>/documents/envelope_<id>`, the read-only document page, not to `/edit`. The guide's next instruction, "In the Recipients section, click **+ Add Signer**", then has nothing to click, because that section only exists in the editor. The editor is one further click away, through the row's Edit action or the Edit button on the document page.

This is the smallest of a batch of findings: a single sentence describing navigation the product has never had. The correction is already visible in the product, so both lines of the same step should be fixed together.

### Docs

https://docs.documenso.com/docs/users/documents/add-recipients, section "Add a Recipient > Open the document editor" (`apps/docs/content/docs/users/documents/add-recipients.mdx`, line 17 at today's head, https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/docs/content/docs/users/documents/add-recipients.mdx#L17):

> Open the document editor
>
> You can access the document editor by clicking on a document in your Documents dashboard.
>
> If you're uploading a document, you'll be redirected to the document editor after the upload is complete automatically.

The second sentence is accurate; only the first is wrong. The next step on the same page reads:

> Click add signer
>
> In the Recipients section, click **+ Add Signer** to add a new recipient row.

### Cause

`apps/remix/app/components/tables/documents-table-title.tsx:36-44` (https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/apps/remix/app/components/tables/documents-table-title.tsx#L36-L44) links the row title to `${documentsPath}/${row.envelopeId}` for the owner (or a current-team document), which is the document detail route `apps/remix/app/routes/_authenticated+/t.$teamUrl+/documents.$id._index.tsx`.

That route is a deliberately read-only page: lines 214-250 render the status heading, the draft copy "This document is currently a draft and has not been sent", and a `DocumentPageViewButton` whose draft branch links to `${documentsPath}/${envelope.id}/edit` (`document-page-view-button.tsx:30,67`). The editor is reached only through that button, or through the row's own Edit action (`documents-table-action-button.tsx:42,59-66`, which builds `${documentsPath}/${row.envelopeId}/edit` for drafts). The layout loader `documents.$id._layout.tsx` only redirects a legacy numeric id to the envelope id; there is no draft-to-editor redirect anywhere. The behavior is intentional and coherent.

The sentence was written by PR #2460 "feat: docs v2" (`b92c53dbb2`, 2026-02-27) and was already inaccurate the day it landed. The title link has pointed at the document detail page since `a849c6431f` "fix: data table links for recipients" (2023-09-12); `7f09ba72` "feat: add envelopes (#2025)" (2025-10-14) only swapped `row.id` for `row.envelopeId`.

Still present at today's head: `git log 3cf2963cd0..origin/main` returns nothing for either the doc page or `documents-table-title.tsx`, so both halves are byte-identical between v2.16.0 and v2.17.0.

Suggested replacement for line 17:

> Open the editor by clicking **Edit** on the document's row in your Documents dashboard, or by opening the document and clicking **Edit** on the document page.

Sibling pages under `docs/users/documents/` are worth grepping for the same phrasing before shipping the patch.

### Related

None. Tracker searches for the user docs and for dashboard navigation return nothing, and no PR in the current community docs stack goes near `apps/docs/content/docs/users` (that stack is entirely under `docs/developers` plus four tRPC types files).

## Steps to Reproduce

Tested on tag `v2.16.0` (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17, driven with headless Chromium.

1. Sign in and upload a PDF, which lands in the editor as the doc's second sentence correctly says.
2. Add a recipient, then navigate away to `/t/<team>/documents`.
3. Find the document's row and click its title link.
4. Read the address bar.

D16 was not part of the live re-verification run. The doc text and the read-only document-page behavior were re-checked in source at v2.17.0 (75330166cc) on 2026-08-19, but the click-through itself was not re-run live.

## Expected Behavior

Following the guide's step 1 puts the reader in the document editor at `/t/<team>/documents/envelope_<id>/edit`, where step 2's "Recipients section" and "+ Add Signer" exist. Since the product does not navigate that way and by design should not, the fix is to the sentence: name the Edit control, in the row or on the document page, as the way into the editor.

## Current Behavior

Clicking the row title lands on `/t/<team>/documents/envelope_yfmooatberybzovc`, the read-only document page. There is no redirect and no `/edit` suffix. The rendered page is the detail view:

```
Documents / tc-draft-5a3d5582fb.pdf / Draft / 1 Recipient
Page 1 of 1
Document draft
This document is currently a draft and has not been sent
Edit
Information: Uploaded by You, Created August 14, 2026, Last modified 7 seconds ago, Document ID (Legacy) 358
Recipients
5a3d5582fb@documenso.test    Signer
Recent activity: You created the document (7 sec. ago)
```

There is no Recipients section with a "+ Add Signer" control on this page; the single green "Edit" button is the way onward.

## Operating System

macOS 26.5

## Browser

Chromium (headless, via Playwright 1.62.1)

## Version

2.16.0 (tested build). Re-checked in source against v2.17.0 (`75330166cc`, today's `main`): `add-recipients.mdx` and `documents-table-title.tsx` are both unchanged, so the sentence and the behavior it describes still disagree in the current release.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (clicks, page text, screenshots, server log) is available on request.
