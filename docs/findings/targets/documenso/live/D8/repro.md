# D8 live re-verification

**The API-token expiry chooser has no accessible name.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`.
- Driver: `playwright-core` 1.62.1 from `packages/guard-runner`, headless, `chromium-1194` binary. Signed in as `guard-owner@documenso.test`.

## Verdict

**still reproduces**, and the second half of the finding, which the original run never reached, is now observed too.

## Steps

1. Signed in, navigated to `/t/guard-owner/settings/tokens`.
2. Clicked **Create token**; the dialog opened with the Name textbox present. Screenshot `step-1-token-dialog.png`.
3. Accessibility snapshot of the dialog (`aria-snapshot-dialog.txt`):
   ```
   - dialog "Create API token":
     - heading "Create API token" [level=2]
     - paragraph: Use API tokens to authenticate with the Documenso API.
     - group:
       - text: Name *
       - textbox "Name *"
       - paragraph: A name to help you identify this token later.
       - text: Expires in
       - combobox: 3 months
       - button "Cancel"
       - button "Create token"
     - button "Close"
   ```
   The Name field is `textbox "Name *"` — named. The expiry chooser is `combobox: 3 months` — **no name at all**, only its value.
4. Locator probe: `page.getByRole('combobox', { name: 'Expires in' }).count()` = **0**. The control the scenario's step is written against cannot be reached by any role-plus-name locator, which is exactly why the original run could not act on it.
5. DOM probe on the one combobox present (`accessibility.json`):
   ```json
   {"tag":"BUTTON","id":null,"role":"combobox","ariaLabel":null,"ariaLabelledby":null,"ariaDescribedby":null,"text":"3 months"}
   ```
   No `id`, no `aria-label`, no `aria-labelledby`.
6. The visible label and where its `htmlFor` points:
   ```json
   [{"text":"Expires in","htmlFor":"_r_f_-form-item","targetExists":false}]
   ```
   **`targetExists: false`** — the label's `htmlFor` names an element that does not exist in the document. That is the dangling `htmlFor` the review described: `FormControl`'s Radix `Slot` applies `id={formItemId}` to `<Select>`, which is `SelectPrimitive.Root`, a non-DOM provider, so the id never lands on the trigger.
7. Opened the chooser by clicking the trigger positionally (the only way to reach it) and read the options. Screenshot `step-2-expiry-options-open.png`, snapshot `aria-snapshot-options.txt`:
   ```
   - listbox:
     - option "7 days"
     - option "1 month"
     - option "3 months" [selected]
     - option "6 months"
     - option "12 months"
     - option "Never"
   ```

## Comparison with the original transcript

The original run (v2.16.0) could not act on this step: the trigger has no accessible name, so `click: {role: combobox, name: "Expires in"}` had nothing to click. The live run reproduces that (`count() = 0`) and, by clicking positionally, reaches the six options the scenario wanted to assert:

- The docs list **Never, 7 days, 1 month, 3 months, 6 months, 1 year**.
- The UI offers **7 days, 1 month, 3 months, 6 months, 12 months, Never**.

Five match. The sixth is labelled **"12 months"** in the UI where the docs say **"1 year"**. That mismatch was the "second, unobserved red" behind the accessibility wall; it is now observed.

## What this changes for the finding

- The accessibility half is unchanged and confirmed on v2.17.0: no `aria-label`, no working `aria-labelledby`, a dangling `htmlFor`, and `combobox` is not a name-from-content role, so the visible value "3 months" does not name it either.
- The wording half is now evidence rather than inference: the chooser really does say "12 months" and the docs really do say "1 year". Both durations are identical, so it is a one-word fix on whichever side the maintainers prefer.
- The review's framing caveat still holds and must survive into any filing: the observed failure is an accessibility defect, not a violation of the bound doc sentence. The six periods are all present and correct in substance; only one of the six labels differs in wording.
