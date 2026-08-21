# F9 — the route manager has one endpoint, not two

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100 |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (rev 1234 and its `chrome-headless-shell` are not on this host) |
| scenario | `a-page-route-is-created-and-reaches-both-the-menu-and-its-page.web.1`, failing step 6 |
| **verdict** | **still reproduces** |

## Doc, re-read at this SHA

`docs/docs/en/routes/index.md:9`:

> The route manager is a tool for managing the routes of the main page of the system,
> supporting `desktop` and `mobile` endpoints.

## Probe — `/admin/settings/routes/desktop`

```
[role="tablist"] count:            0
getByRole('tab') count:            0
page text contains "Desktop routes": true
page text contains "Mobile routes":  false

.ant-menu-horizontal .ant-menu-title-content → ["Desktop routes"]
```

`Desktop routes` is the single entry of the page's horizontal nav. There is no second
entry, and no `Mobile routes` string anywhere on the page.

The full page text of the routes screen (`raw/web.json` → `F9.bodyText`) is the settings
nav, then `Routes`, `Desktop routes`, the toolbar (`Filter`, `Refresh`, `Delete`,
`Hide in menu`, `Show in menu`, `Add new`) and the empty table.

## Nuance worth keeping

`findings.md` and `run-classification.md` call this "a single tab". Structurally it is an
`ant-menu` item, not an `ant-tabs` tab: `getByRole('tab')` finds nothing on this page at
all. The substance is unchanged, but a scenario written against the tab role would fail
for the wrong reason.

## Control — the mobile plugin really is on

```
select name, enabled, "builtIn" from "applicationPlugins" where name like '%mobile%'
→ mobile | t | t
```

Enabled and built-in on a stock install, so its absence from the route manager is not a
disabled-plugin artefact.

## Mechanism (re-read at this SHA, unchanged)

`packages/plugins/@nocobase/plugin-mobile/src/client/index.tsx:274` — the only
`Mobile routes` label in the tree is a tab **inside the ACL permission drawer**, produced by
`addPermissionsSettingsUI()`:

```tsx
return {
  key: 'mobile-menu',
  label: t('Mobile routes', { ns: pkg.name }),
  sort: 25,
  children: ( <TabLayout> ... <MenuPermissions ... /> </TabLayout> ),
};
```

## Raw captures

- `raw/web.json` → key `F9`
- `raw/f9-routes.png`
- `raw/web.stdout.txt`
