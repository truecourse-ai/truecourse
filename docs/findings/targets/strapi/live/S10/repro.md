# S10 live re-verification: the bulk-unpublish confirmation dialog says "Confirm", not "Unpublish"

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1. Admin panel built with `corepack yarn workspace getstarted build`.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`.
- **Driver:** playwright-core 1.62.1 from `/Users/musheghgevorgyan/repos/truecourse/packages/guard-runner`, headless chromium, viewport 1440x900.
- **Verdict: still reproduces.**

## Seed for this scenario

Super admin `tc-reverify@example.com` / `Reverify1234`. Two published articles created through REST with the full-access token:

- `DP Bulk Unpublish mt0gas78 A` (`qhlyg4x7f0yxpfr5gob3ieyv`)
- `DP Bulk Unpublish mt0gas78 B` (`g347xnx5llj1ozujd7rpi03m`)

Both created with `POST /api/articles?status=published`, so both show `Published` in the list.

## Steps

### 1. Sign in and open the filtered Article list

`http://127.0.0.1:1347/admin/auth/login`, email and password filled, Login clicked, then

```
/admin/content-manager/collection-types/api::article.article
  ?page=1&pageSize=10&sort=title:ASC&filters[$and][0][title][$containsi]=mt0gas78
```

The list shows 2 entries, both `Published`.

**Environment note not present in the original run:** a fresh admin user is served a four-step guided-tour popover ("Content manager, Step 1 of 4") that overlays the list and swallows clicks. It is dismissed with its own "Skip" button before the scenario proceeds. Screenshots: `step-2a.article-list-with-guided-tour.png` (before) and `step-2.article-list.png` (after).

### 2. Select all entries

The `Select all entries` checkbox is checked. The bulk action bar appears with exactly two buttons: **Unpublish** and **Delete**. Screenshot: `step-3.entries-selected.png`.

### 3. Click the bulk `Unpublish` button

Screenshot: `step-4.unpublish-dialog.png`. A modal opens with `role="alertdialog"`:

```
Confirmation
Are you sure you want to unpublish these entries?
Cancel   Confirm
```

- dialog buttons, read from the DOM: `["Cancel", "Confirm"]`
- count of buttons inside the dialog with the accessible name `Unpublish`: **0**

Accessibility snapshot: `step-4.unpublish-dialog.aria.txt`. Dialog markup: `step-4.unpublish-dialog.html`. Run log: `run.log.txt`.

The title and the body text are exactly what the docs describe. Only the confirm button's label differs: the docs' step says to click **Unpublish**, and there is no such control on the page.

### 4. Clicking `Confirm` does perform the unpublish

After clicking `Confirm`, both rows change to `Draft`. Screenshot: `step-6.after-confirm.png`. The defect is label-only; the action itself is intact, which matches the review's reading.

### 5. The bulk `Publish` dialog, for comparison

With both entries now drafts, `Select all entries` then the bulk `Publish` button opens a different modal, "Publish entries", whose buttons are:

```
["Close modal", "Cancel", "Refresh", "Publish"]
```

Screenshot: `step-5.publish-dialog.png`, accessibility snapshot `step-5.publish-dialog.aria.txt`.

So the bulk-publish flow really does end on a button named `Publish`, as the same doc page says, and only the bulk-unpublish dialog falls back to the generic `Confirm`. The doc author was describing real per-dialog labels; one of them has regressed.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 16) reported verbatim: `the button elements on the page are: "Cancel", "Confirm"`, with the dialog reading `Confirmation` / `Are you sure you want to unpublish these entries?`. Identical here. The publish-dialog comparison and the "Confirm actually unpublishes" check are additions.

## Source state on the re-verified build

`packages/core/content-manager/admin/src/pages/ListView/components/BulkActions/Actions.tsx` line 203 still reads `confirmButton: formatMessage({...})`, while `DocumentActionConfirmDialog`'s `DialogOptions` still declares the field as `confirmLabel`. Unchanged from the tested build, so the one-word fix is still open.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`.
