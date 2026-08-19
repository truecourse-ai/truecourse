---
finding: S10
target: strapi/strapi
route: public issue
title: Bulk unpublish confirmation dialog shows a generic Confirm button instead of the Unpublish button the action asks for
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# Bulk unpublish confirmation dialog shows a generic Confirm button instead of the Unpublish button the action asks for

## Environment (BUG_REPORT.yml required fields)

| Field | Value |
|---|---|
| Node Version | 24.14.1 |
| Package Manager | yarn |
| Package Manager Version | 4.12.0 |
| Strapi Version | 5.52.1 |
| Operating System | MacOS |
| Database | SQLite |
| Javascript or Typescript | JavaScript |

Surface: the admin panel (Content Manager list view), on MacOS, headless Chromium at 1440x900.

## Bug Description

In the Content Manager list view, selecting entries and clicking the bulk **Unpublish** button opens a confirmation dialog whose confirm button reads **Confirm**. The action's own code asks for **Unpublish**: `UnpublishAction` sets `confirmButton: formatMessage({ id: 'app.utils.unpublish', defaultMessage: 'Unpublish' })`, but the shared dialog renderer reads a property named `confirmLabel`, so the value is silently dropped and the generic fallback is rendered. The documentation for bulk unpublishing describes the **Unpublish** button in the dialog, so its step 3 cannot be followed as written.

This is label-only: the `onConfirm` handler is intact and clicking **Confirm** does unpublish the selected entries. The cost is in localization and consistency. The confirm button loses its `app.utils.unpublish` string in every locale and falls back to `app.components.Button.confirm`, so every translation of the intended label is unused. The sibling bulk-publish dialog, which uses a different renderer, does end on a button named **Publish**, so the two bulk flows disagree with each other as well as with the docs.

### What the docs say

https://docs.strapi.io/cms/features/draft-and-publish, section "Usage > Bulk actions > Bulk unpublishing content":

> To unpublish several entries at the same time:
>
> 1. From the list view of the Content Manager, select your entries to unpublish by ticking the box on the left side of the entries' record.
> 2. Click on the **Unpublish** button located above the header of the table.
> 3. In the confirmation dialog box, confirm your choice by clicking again on the **Unpublish** button.

The docs are accurate about the rest of the flow and about the neighbouring dialogs: the same page's single-entry unpublish section says to click **Confirm**, which matches that dialog, and the bulk-publish section's step 6 says to click the **Publish** button, which matches that one. Only the bulk-unpublish dialog has drifted from what the page describes.

### Observed

Steps 1 and 2 of the documented flow work: the bulk action bar appears with exactly two buttons, **Unpublish** and **Delete**, and clicking **Unpublish** opens the dialog. The dialog, read from the DOM, is:

```
alertdialog "Confirmation"
  heading "Confirmation" [level=2]
  img
  text: Are you sure you want to unpublish these entries?
  contentinfo:
    button "Cancel"
    button "Confirm"
```

Buttons in the dialog: `["Cancel", "Confirm"]`. Buttons in the dialog with the accessible name `Unpublish`: **0**. Screenshot: `step-4.unpublish-dialog.png` (attached). The title and body text match the code and the docs exactly; only the confirm button's label differs. The bulk-bar **Unpublish** button is still in the DOM behind the modal, but it is inert under the Radix dialog, so it is not reachable by pointer, keyboard or screen reader, which is what a user following step 3 would try next.

Clicking **Confirm** unpublishes both entries: the rows change to `Draft`.

For comparison, on the same instance, the bulk **Publish** dialog ("Publish entries") exposes `["Close modal", "Cancel", "Refresh", "Publish"]`. Screenshot: `step-5.publish-dialog.png`.

### Cause

`packages/core/content-manager/admin/src/pages/ListView/components/BulkActions/Actions.tsx:180-209` (https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/content-manager/admin/src/pages/ListView/components/BulkActions/Actions.tsx#L180-L209). `UnpublishAction` returns a descriptor whose dialog sets `confirmButton: ...` at lines 203-206. Nothing reads that property. The dialog is rendered by `DocumentActionConfirmDialog` in `packages/core/content-manager/admin/src/pages/EditView/components/DocumentActions.tsx`, whose `DialogOptions` interface declares the custom-label field as `confirmLabel` (line 109) and whose footer renders `{confirmLabel ?? formatMessage({ id: 'app.components.Button.confirm', defaultMessage: 'Confirm' })}` (lines 588-592). `confirmButton` is not a member of `DialogOptions`, `NotificationOptions` or `ModalOptions`, so `DocumentActionButton`'s `{...action.dialog}` spread drops it and the fallback is shown. Renaming that one property to `confirmLabel` is the whole fix.

This is a regression, not an original bug. The `confirmButton: 'Unpublish'` line was written by PR #20235 (e1b9d9adee, merged 2024-05-09) and worked at the time: `BulkActions/Actions.tsx` still had its own local `BulkActionConfirmDialog` whose footer read that exact property. PR #20431 (11011e9804, merged 2024-06-10) deleted the local renderer and repointed bulk actions at the shared `DocumentActionButton` / `DocumentActionConfirmDialog`, which has no `confirmButton` support, and left the now-dead property behind. `git tag --contains 11011e9804` includes v5.0.0, so the dialog has said "Confirm" in every Strapi 5 release. PR #26736 (2dcf71afcd, merged 2026-06-25) added the supported `confirmLabel` field to `DialogOptions` for the draft-relations publish warning but did not migrate bulk unpublish. Today's head still has both sides: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/admin/src/pages/ListView/components/BulkActions/Actions.tsx#L180-L209

One note for whoever fixes it: the type checker cannot catch this class of typo in the current shape. The descriptor is returned from an arrow function typed by a contextual annotation (`DescriptionComponent<Props, BulkActionDescription>`), so the returned object literal loses freshness and TypeScript's excess-property check never runs. Reproduced on the same type shape with tsc 5.9.3: a direct `const x: DialogOptions = { ..., confirmButton: 'y' }` errors with TS2353, while the same literal returned from a contextually typed arrow function compiles clean. Annotating the descriptor explicitly (`const description: BulkActionDescription = {...}; return description;`) restores the error, and the other `DescriptionComponent` implementations are worth auditing for the same silently dropped keys.

### Related

- #20235 (merged 2024-05-09) wrote the `confirmButton` line, correct at the time.
- #20431 (merged 2024-06-10) is the regression: it removed the local `BulkActionConfirmDialog` that honored `confirmButton`.
- #26736 (merged 2026-06-25) added the supported `confirmLabel` field without migrating bulk unpublish.

No existing issue reports the label. Searches for "bulk unpublish confirm", `confirmButton` and `confirmLabel` on strapi/strapi return nothing.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), admin panel built with `corepack yarn workspace getstarted build` and served with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`. The instance reports 5.52.1 on node v24.14.1. Driven with playwright-core 1.62.1, headless Chromium, viewport 1440x900, on MacOS. The original run was on 5.52.0 @ `c43e9ee1e2`.

1. Sign in to the admin panel as a super admin. On a fresh admin user a four-step guided-tour popover ("Content manager, Step 1 of 4") overlays the list and swallows clicks; dismiss it with its "Skip" button.
2. Create two entries of a collection type with Draft & Publish enabled and publish both, so the list view shows them as `Published`.
3. Open the Content Manager list view for that collection type.
4. Tick "Select all entries". The bulk action bar appears with **Unpublish** and **Delete**.
5. Click the bulk **Unpublish** button. The confirmation dialog opens, titled "Confirmation", body "Are you sure you want to unpublish these entries?", with buttons **Cancel** and **Confirm**. There is no **Unpublish** button in the dialog, so step 3 of the documented flow cannot be performed.
6. Optional contrast: click **Confirm** (both rows become `Draft`), select all again, click the bulk **Publish** button, and observe that its dialog does end on a button named **Publish**.

Re-verified on develop c7dbadd4fe (5.52.1) on 2026-08-19: still reproduces, with the dialog exposing exactly `["Cancel", "Confirm"]` and zero buttons named `Unpublish`. Originally observed on 5.52.0 at c43e9ee1e2 with the identical dialog.

## Expected Behavior

The bulk-unpublish confirmation dialog's confirm button is labelled **Unpublish**, as `UnpublishAction` already asks for and as the Draft & Publish page describes, using the `app.utils.unpublish` translation so the label is localized. That also makes it consistent with the bulk-publish dialog, which ends on **Publish**.

## Logs / Code Snippets

The dialog footer as rendered (from the captured DOM):

```html
<footer class="...">
  <button type="button" aria-disabled="false"><span>Cancel</span></button>
  <button type="button" aria-disabled="false"><span>Confirm</span></button>
</footer>
```

The one-word fix, at `packages/core/content-manager/admin/src/pages/ListView/components/BulkActions/Actions.tsx:203`:

```diff
-        confirmButton: formatMessage({
+        confirmLabel: formatMessage({
           id: 'app.utils.unpublish',
           defaultMessage: 'Unpublish',
         }),
```

Media: `step-4.unpublish-dialog.png` (the dialog with Cancel and Confirm) and `step-5.publish-dialog.png` (the bulk-publish dialog with Publish), to attach when filing.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (screenshots, accessibility snapshots, DOM captures) is available on request.
