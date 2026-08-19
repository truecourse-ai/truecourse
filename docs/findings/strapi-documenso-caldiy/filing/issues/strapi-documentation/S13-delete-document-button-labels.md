---
finding: S13
target: strapi/documentation
route: docs repo issue
title: "[Bug]: Content Manager page tells the reader to click Delete document and Delete locale; those buttons were renamed to Delete entry in 2024"
labels: type: bug
status: draft
reverified: yes (source and doc text re-checked 2026-08-19: strapi/strapi develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672 still renders the new labels, strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663 still carries the old ones; admin UI observed on 5.52.0, not re-run live)
---

# [Bug]: Content Manager page tells the reader to click Delete document and Delete locale; those buttons were renamed to Delete entry in 2024

## Link to the documentation page or resource

https://docs.strapi.io/cms/features/content-manager (the "Deleting content" section, and the list-view bullet list higher up the page)

Source file: `docusaurus/docs/cms/features/content-manager.md`, lines 547, 559 and 86 on `main` at `9226f90506a4a361038f220f24768016a73b5663`.

## Describe the bug

Three places on this page name buttons and an icon that the admin panel has not had since September 2024. The menus exist, deletion works, and the described semantics are right; only the proper nouns are stale.

### 1. Line 547, the numbered step for the edit view

> 1. In the edit view of the entry, click on `<Icon name="dots-three-outline" />` at the top right of the interface, and click the **Delete document** button.\<br/\>If Internationalization is enabled for the content-type, you can also choose to delete only the currently selected locale by clicking on the **Delete locale** button.

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/features/content-manager.md#L547

### 2. Line 559, the tip for the list view

> You can delete entries from the list view of a collection type, by clicking on `<Icon name="dots-three-outline" />` on the right side of the entry's record in the table, then choosing the `<Icon name="trash"/>` **Delete document** button.\<br/\>If [Internationalization](/cms/features/internationalization) is enabled for the content-type, **Delete document** deletes all locales while **Delete locale** only deletes the currently listed locale.

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/features/content-manager.md#L559

### 3. Line 86, the list-view bullet list

> - if [Internationalization (i18n)](/cms/features/internationalization) is enabled, ![Delete locale icon](/img/assets/icons/v5/delete-locale.svg) delete a given locale,

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/features/content-manager.md#L86

### What the product does

The two items are labelled **"Delete entry (all locales)"** and **"Delete entry (English (en))"**, that is `Delete entry (<locale name>)`.

`packages/core/content-manager/admin/src/pages/EditView/components/Header.tsx` lines 719 to 725 build the label from `content-manager.actions.delete.label`, whose default message is `Delete entry{isLocalized, select, true { (all locales)} other {}}`, and line 791 declares `position: ['header', 'table-row']`, so the same action renders both in the edit-view header menu and in the list-view row menu:

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/admin/src/pages/EditView/components/Header.tsx#L719-L725

The locale-scoped item is `DeleteLocaleAction` in `packages/plugins/i18n/admin/src/components/CMHeaderActions.tsx` lines 655 to 661, labelled `Delete entry ({locale})`, also `position: ['header', 'table-row']` at line 654:

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/plugins/i18n/admin/src/components/CMHeaderActions.tsx#L655-L661

The same defaults sit in the catalogs (`packages/core/content-manager/admin/src/translations/en.json` line 7, `packages/plugins/i18n/admin/src/translations/en.json` line 2).

The rename was deliberate: strapi/strapi#21182 "fix: delete document actions labels" (commit `29afb2b983`, merged 2024-09-09) changed "Delete document" to `Delete entry{isLocalized, select, true { (all locales)} other {}}` and "Delete locale" to `Delete entry ({locale})` in both components, both catalogs and the e2e specs, to match the design asked for in strapi/strapi#20812. No companion documentation PR was ever opened, so the page has been stale for roughly 23 months.

### Observed

On Strapi 5.52.0 (develop @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`, `yarn workspace getstarted start`, sqlite), driving the admin panel on an internationalized `Article` collection type:

- Edit view, "More actions" menu at the top right of `/admin/content-manager/collection-types/api::article.article/<documentId>`. Menu items: "Edit the model", "Configure the view", "Delete entry (English (en))", "Delete entry (all locales)", "Copy document ID". No "Delete document", no "Delete locale".
- List view, the row actions menu. Menu items: "Edit", "Open in new tab", "Duplicate", "Delete entry (English (en))", "Delete entry (all locales)". Same drift, same two labels.

Both surfaces are the same components, which is why one fix covers both. Screenshots of the two menus are available.

**Re-verified on 2026-08-19.** `git log c43e9ee1e2..origin/develop` over `Header.tsx`, `CMHeaderActions.tsx` and both `en.json` catalogs is empty, so today's develop still renders these labels, and all three doc spots are verbatim on `main`. The admin panel was not re-driven on 5.52.1.

## Suggested improvements or fixes

- Line 547: "click the **Delete entry (all locales)** button", and for the i18n sentence "by clicking on the **Delete entry (\<locale name\>)** button", for example **Delete entry (English (en))**.
- Line 559: same two replacements, "**Delete entry (all locales)** deletes all locales while **Delete entry (\<locale name\>)** only deletes the currently listed locale".
- Line 86: "delete a given locale" is fine, but the image alt text "Delete locale icon" should be renamed with the button.
- Worth adding: when Internationalization is **not** enabled for the content type, the ICU `other` branch renders the item as plain **Delete entry**, which is why the label is conditional.

One caveat on scope: only the English catalog was inspected. Localized admin translations may still carry the old strings, which would be a separate `strapi/strapi` issue, not a docs one.

## Related issue(s)/PR(s)

- strapi/strapi#20812 (closed as completed, 2024-10-14), "[Design] In the edit view, the labels of 'Delete locale' and 'Delete document' are not the right ones". The design ticket that asked for the rename, so it confirms the product side is intentional.
- strapi/strapi#21182 (merged 2024-09-09, commit `29afb2b983`), "fix: delete document actions labels". The rename itself.
- No issue or PR in this repository tracks the doc drift. Searched 2026-08-19: `"Delete document" label content manager` across the org (0 results), `Deleting content delete entry locales` in this repo (0 results), plus a full enumeration of this repository's issues since 2026-08-01 (40 items, none touching `content-manager.md`).

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (steps, screenshots, console log) is available on request.
