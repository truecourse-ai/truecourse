# F5 — the docs name a "UI Builder" button; the shipped control is "UI Editor"

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100 |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (rev 1234 and its `chrome-headless-shell` are not on this host) |
| scenario | `the-ui-builder-button-arrives-with-the-configure-interface-permission.web.1`, failing step 9 |
| **verdict** | **still reproduces** |

## Doc, re-read at this SHA

`docs/docs/en/interface-builder/index.md:5`:

> NocoBase provides a WYSIWYG UI building experience. Click the UI Builder button to toggle
> between Edit mode and View mode.

## Probe — the product's own copy, read off `/admin` on this fresh install

```
No pages yet, please configure first
Click the "UI Editor" icon in the upper right corner to enter the UI Editor mode
```

That is the complete body text of the page.

## Control — accessible-name resolution over the whole document

```
body text contains "UI Builder":                     false
page HTML contains "UI Builder":                     false
[title*="UI Builder"], [aria-label*="UI Builder"]:   0 elements
[title*="UI Editor"],  [aria-label*="UI Editor"]:    1 element
getByLabel("UI Builder"):                            0
getByTitle("UI Editor"):                             1
[data-testid="ui-editor-button"]:                    1

every title attribute in the document:  ["UI Editor"]
top-bar data-testids:                   ["ui-editor-button","plugin-settings-button","help-button","user-center-button"]
top-bar icon names:                     ["highlight","setting","bell","question-circle","user","highlight"]
```

"UI Builder" appears nowhere in the rendered application, in text or in markup.

## Mechanism (re-read at this SHA)

- `packages/core/client/src/schema-component/core/DesignableSwitch.tsx:44` —
  `<Tooltip title={t('UI Editor')}>`.
- `packages/core/client-v2/src/flow/models/topbar/TopbarActionModel.tsx:381` —
  `tooltip = tExpr('UI Editor');`. `findings.md` cites `:378`, which is
  `testId = 'ui-editor-button';`. The correction the earlier pass made is confirmed.

## Raw captures

- `raw/web.json` → key `F5`
- `raw/F5-topbar.json` — every `title`, `data-testid` and icon name in the document
- `raw/f5-admin.png`
- `raw/web.stdout.txt`
