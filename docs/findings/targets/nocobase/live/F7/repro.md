# F7 — the four documented route types are not the four the Add-route form offers

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100 |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (rev 1234 and its `chrome-headless-shell` are not on this host) |
| scenario | `the-route-type-list-is-what-the-add-route-form-offers.web.1`, failing step 7 |
| **verdict** | **still reproduces** |

## Doc, re-read at this SHA

`docs/docs/en/routes/index.md:19-24`:

> The system supports four types of routes:
>
> - Group (group): Used to manage routes by grouping them, and can include sub-routes
> - Page (page): System internal page
> - Tab (tab): Used to switch between tabs in a page
> - Link (link): Internal or external link, can directly jump to the configured link address

## Probe — the Add-new drawer at `/admin/settings/routes/desktop`

Radio options, read as their rendered labels:

```
["Group", "Classic page (v1)", "Modern page (v2)", "Link"]

getByRole('radio', { name: 'Page', exact: true }) → 0
```

Full drawer text, verbatim:

```
Add new
*Type:
Group
Classic page (v1)
Modern page (v2)
Link
*Title:
Icon:
Select icon
Show in menu:
Enable page tabs:
Cancel
Submit
```

`Page` is not on the form (it is two entries now), and `Tab` is not on it at all.

## Mechanism (re-read at this SHA, unchanged)

`packages/plugins/@nocobase/plugin-client/src/client/routesTableSchema.tsx:249-258`:

```tsx
<Radio.Group {...props}>
  {!isMobile && <Radio value={NocoBaseDesktopRouteType.group}>{t('Group')}</Radio>}
  <Radio value={NocoBaseDesktopRouteType.page}>
    {t(isMobile ? 'Page' : 'Classic page (v1)')}
  </Radio>
  {!isMobile && (
    <Radio value={NocoBaseDesktopRouteType.flowPage}>{t('Modern page (v2)')}</Radio>
  )}
  <Radio value={NocoBaseDesktopRouteType.link}>{t('Link')}</Radio>
</Radio.Group>
```

The `Page` label survives only on the mobile form.

## Raw captures

- `raw/web.json` → key `F7`
- `raw/f7-add-route-drawer.png`
- `raw/web.stdout.txt`
