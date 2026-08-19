# D7 live re-verification

**After a distribution-method None send, the document page shows no signing link.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: `npm run start -w @documenso/remix` on port 3347, database `tc_reverify_documenso`, `NEXT_PUBLIC_WEBAPP_URL=http://localhost:3347`.
- Driver: `playwright-core` 1.62.1 resolved from `packages/guard-runner`, headless, using the installed `chromium-1194` binary (the `chromium_headless_shell-1234` build playwright 1.62 expects is not installed on this machine, so `executablePath` points at `chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium`). Viewport 1440x1100.
- Signed in as `guard-owner@documenso.test`.

## Verdict

**still reproduces.** The document page a None send lands on carries no signing link in any form: no `/sign/` substring in the page text, no anchor whose href contains `/sign/`, and no input carrying one. Two runs, two fresh documents, same result.

## Steps

1. `POST /signin` through the form -> landed on `/t/guard-owner/documents`.
2. Uploaded `assets/example.pdf` as `tc-nomail2-79771c8411.pdf` through the **Upload Document** button -> the editor at `/t/guard-owner/documents/envelope_iscshkwxwlwnnsek/edit`. Screenshot `step-1-editor.png`.
3. Filled the recipient email `79771c8411@documenso.test` and name, changed the role combobox from SIGNER to **Needs to view** (a VIEWER, for the same reason the scenario uses one: a SIGNER with no signature field cannot be sent). Screenshot `step-2-recipient-viewer.png`.
4. **Send Document** -> the distribution dialog with its two tabs. Screenshot `step-3-send-dialog.png`.
5. Clicked the **None** tab. Its copy contains "We won't send anything to notify recipients" (asserted true). Screenshot `step-4-none-tab.png`.
6. Clicked **Generate Links**.
7. Landed on `/t/guard-owner/documents/envelope_iscshkwxwlwnnsek`. Screenshot `step-5-document-page.png`.

### The `?action=` value the redirect carries

A third run instrumented `history.pushState` / `history.replaceState` with an init script before clicking Generate Links, because the parameter is consumed and removed within a few hundred milliseconds and a plain URL read never sees it. Captured (`redirect-url-capture.json`):

```json
[
 {"method":"pushState","url":"/t/guard-owner/documents/envelope_ucsrsvlywaoffiom?action=copy-links",
  "href":"http://localhost:3347/t/guard-owner/documents/envelope_ucsrsvlywaoffiom/edit"},
 {"method":"pushState","url":"/t/guard-owner/documents/envelope_ucsrsvlywaoffiom",
  "href":"http://localhost:3347/t/guard-owner/documents/envelope_ucsrsvlywaoffiom?action=copy-links"}
]
```

The redirect carries **`?action=copy-links`**, and `document-page-view-recipients.tsx` then strips it (it reads `searchParams.get('action') === 'copy-links'` at line 48 and deletes the param at line 55). The mounted `DocumentRecipientLinkCopyDialog` that would open on `?action=view-signing-links` is never triggered.

### What the landed page actually shows

Probe (`signing-link-probe.json`, and repeated in the second run):

```json
{"hasSignSubstring": false, "signAnchors": [], "inputsWithSign": []}
```

- page text contains `/sign/`: **false**
- `<a>` elements whose href contains `/sign/`: **0**
- `<input>` / `<textarea>` values containing `/sign/`: **none**

The Recipients section of the accessibility snapshot is:

```
- heading "Recipients" [level=1]
- link "Modify recipients"
- list:
  - listitem:
    - text: "7"
    - paragraph: 79771c8411@documenso.test
    - paragraph: Viewer
    - button:
      - status: Pending
    - button
```

The last entry, an unnamed `button`, is the icon-only copy control (see D9). Full text in `document-page-text.txt`.

### The link is two unnamed controls away, and even then it is not displayed

Following the only route that exists: the unnamed three-dots trigger -> menu item **Signing Links** -> the "Copy Signing Links" dialog. Screenshot `step-7-signing-links-dialog.png`, text in `signing-links-dialog-text.txt`, accessibility snapshot in `signing-links-dialog-aria.txt`:

```
- dialog "Copy Signing Links":
  - heading "Copy Signing Links" [level=2]
  - paragraph: You can copy and share these links to recipients so they can action the document.
  - list:
    - listitem:
      - text: "7"
      - paragraph: 79771c8411@documenso.test
      - paragraph: Viewer
      - button "Copy":
        - paragraph: Copy
  - button "Close"
  - button "Bulk Copy"
```

The dialog text does **not** contain `/sign/` either, and it has no input carrying the URL. Even inside the dialog the link is never shown; it is only placed on the clipboard by a Copy button.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 15, the `text contains /sign/` assertion on the document page, having reached the same landing URL. The live run on v2.17.0 reproduces that and adds three things the original did not record: the `?action=copy-links` value captured live, the absence of any anchor or input carrying the link (so the failure is not an artifact of text extraction), and the content of the dialog behind the menu, which shows the link is not displayed anywhere in the product.

## What this changes for the finding

- The verdict and the medium confidence both stand, and the reason for the medium confidence is now demonstrated rather than argued: `send.md`'s "you're redirected to the document page where signing links are displayed" is not literally true anywhere in the UI, dialog included. A maintainer can legitimately fix this by rewording the docs, so a filing should present both resolutions.
- The concrete mechanism is confirmed live: the send path pushes `?action=copy-links`, the recipients component consumes that value to pulse the copy icons, and the dialog that would list the recipients listens for `view-signing-links`, which this path never sends.
