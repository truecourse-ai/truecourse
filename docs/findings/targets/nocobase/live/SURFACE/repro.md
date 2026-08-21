# SURFACE — the Add-route drawer's `Title` input has no accessible name

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100 |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (rev 1234 and its `chrome-headless-shell` are not on this host) |
| scenario | `a-route-can-be-created-without-showing-in-the-menu.web.1`, failing step 6 |
| **verdict** | **still reproduces** |

## Probe — the input's own markup, at `/admin/settings/routes/desktop` → `Add new`

```html
<input class="ant-input css-17h1pxo" type="text" value="" style="">
```

No `id`, no `name`, no `aria-label`, no `aria-labelledby`, no `placeholder`. The DOM's own
label association is empty:

```
element.labels.length → 0
```

The visible label renders as `*Title:` in the drawer text (see F7's verbatim drawer text)
but is not tied to the control. It is the drawer's only text input
(`input.ant-input[type="text"]` count → 1).

## Control — accessible-name resolution

`getByRole` applies the accname algorithm, so it is the decisive test:

```
getByRole('textbox')                       → 1     (the input is reachable by role)
getByRole('textbox', { name: 'Title' })    → 0
getByRole('textbox', { name: 'Title：' })   → 0     (full-width colon)
getByRole('textbox', { name: /Title/ })    → 0
```

The control exists; it has no name.

## The trap this pass re-confirmed

On `playwright-core` 1.62.1, `getByLabel('Title')` returns **1**, which looks at first like
a refutation. It is not: that match is not the input, and using it fails.

```
getByLabel('Title')                 → 1
getByLabel('Title', {exact:true})   → 0
locator.fill(...) via getByLabel    → Error: locator.fill: Error: Element is not an <input>,
                                      <textarea>, <select> or [contenteditable] and does not
                                      have a role allowing [aria-readonly]
```

`getByLabel` matched the label/form-item wrapper, not the control. Typing into the field is
only possible by position: filling `input.ant-input[type="text"]` directly set the value to
`tc-surface`, so the control works, it simply cannot be addressed by name.

Anyone re-running this must use `getByRole('textbox', { name: 'Title' })`, not `getByLabel`.

## Raw captures

- `raw/web.json` → key `SURFACE`
- `raw/surface-title.png`
- `raw/web.stdout.txt`
