# D9 live re-verification

**The Copy Signing Links control and the three-dots trigger on the document page have no accessible name.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`.
- Driver: `playwright-core` 1.62.1 from `packages/guard-runner`, headless, `chromium-1194` binary. Signed in as `guard-owner@documenso.test`.
- State: the same None-distribution send as D7. The document page is `/t/guard-owner/documents/envelope_iscshkwxwlwnnsek`, status Pending, one VIEWER recipient.

## Verdict

**still reproduces**, and this converts the finding from a source reading to an executed observation. Scenario step 16 never ran in the original guard run because step 15 (D7) failed first.

## The copy control

Locator probes on the landed document page:

- `page.getByRole('button', { name: 'Copy Signing Links' }).count()` = **0**
- `page.getByRole('button', { name: /copy/i }).count()` = **0**

The phrase is nevertheless present in the page text exactly once, as the tooltip content, which is why a text assertion would have claimed an affordance no user can address.

Accessibility snapshot of the Recipients section (`aria-snapshot-document-page.txt`):

```
- heading "Recipients" [level=1]
- link "Modify recipients":
  - /url: /t/guard-owner/documents/envelope_iscshkwxwlwnnsek/edit?step=signers
- list:
  - listitem:
    - text: "7"
    - paragraph: 79771c8411@documenso.test
    - paragraph: Viewer
    - button:
      - status: Pending
    - button
```

The trailing bare `button` is the `CopyTextButton`. Its DOM record (`buttons.json`, index 7):

```json
{"index":7,"testid":null,"ariaLabel":null,"ariaLabelledby":null,"ariaDescribedby":null,"title":null,
 "text":"","svgCount":1,"svgHasTitle":false}
```

Icon only: one `<svg>`, no `<title>` inside it, no `aria-label`, no `aria-labelledby`, no `title` attribute, no text. Accessible name: empty.

## The three-dots trigger

`[data-testid="document-page-view-action-btn"]`, one match (`three-dots.json`):

```json
{"tag":"BUTTON","testid":"document-page-view-action-btn","ariaLabel":null,"ariaLabelledby":null,"title":null,"text":"",
 "innerHTML":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" ... class=\"lucide lucid",
 "ariaSnapshot":"- button"}
```

Its accessibility snapshot is the single line `- button`. `data-testid` is not an accessible name. Screenshot of the opened menu: `step-6-dropdown-open.png`; its items (`menu-items.json`):

```
["Edit","Rename","Download","Audit Logs","Duplicate","Save as Template","Delete","Signing Links","Resend","Share Signing Card"]
```

"Signing Links" is the only textually named route to the links, and it sits behind this unnamed trigger.

## The page-wide count

Of the 9 buttons rendered on this document page, **5 have an empty accessible name** (no text, no `aria-label`, no `aria-labelledby`), all of them icon-only lucide `<svg>` buttons with no `<title>`:

| index | data-testid | what it is |
|---|---|---|
| 2 | (none) | header icon button |
| 3 | (none) | header icon button |
| 5 | `document-page-view-action-btn` | the three-dots trigger |
| 7 | (none) | the `CopyTextButton` beside the recipient |
| 8 | `toast-close` | toast dismiss |

Full record in `buttons.json`.

## Contrast: the same control IS named inside the dialog

Inside the "Copy Signing Links" dialog reached through the menu, the copy control renders visible text and does get a name:

```
- button "Copy":
  - paragraph: Copy
```

So the naming gap is specific to the icon-only rendering on the document page, not to the component's purpose. That is a clean before/after for a maintainer, in the same product, on the same action.

## Comparison with the original transcript

The original run never executed this step. Its evidence was a code reading plus the page-text observation that "Copy Signing Links" appears as tooltip text. The live run executes it: the role-plus-name locator returns 0, the accessibility tree shows two bare `button` nodes, and the DOM confirms no naming attribute of any kind on either control.

## What this changes for the finding

- The review's caveat "confirmed in source, not executed" can be dropped. A filing may now say a screen-reader-equivalent probe was performed, because the accessibility tree itself was read.
- The pairing with D7 is confirmed by observation: after a None send these two unnamed controls are the only routes to the promised signing links, and the page shows no link at all (D7).
- Both remain one-line fixes (an `aria-label`, or `sr-only` text inside the button).
