# F8 — the Create-collection menu offers six of the collection types the manuals enumerate, and renames the database-view entry

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100 |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (rev 1234 and its `chrome-headless-shell` are not on this host) |
| scenario | `the-create-collection-menu-offers-the-documented-collection-types.web.1`, failing step 10 |
| **verdict** | **still reproduces** |

## Probe — the dropdown, scoped to the open menu

At `/admin/settings/data-source-manager/main/collections?type=main`, clicking
`Create collection` and reading `.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item`:

```
General collection · Calendar collection · Tree collection · File collection ·
SQL collection · Connect to database view

count: 6
submenu titles: none
```

The same six also appear as the only `menuitem`-role names outside the settings nav
(`raw/web.json` → `F8.menuitemRoleNames`, whose tail is exactly those six).

## Control — checked against every name the three manual pages use

```
PRESENT  General collection
PRESENT  Calendar collection
ABSENT   Comment collection
PRESENT  Tree collection
PRESENT  File collection
PRESENT  SQL collection
ABSENT   Connect a database view
ABSENT   Database view collection
ABSENT   Connect external data
ABSENT   Expression collection
ABSENT   Inheritance collection
PRESENT  Connect to database view     ← the shipped label, named by no manual page
```

## Doc — three enumerations, three vocabularies, re-read at this SHA

`docs/docs/en/data-sources/index.md:49-57` names General, Calendar, **Comment**, Tree, File,
**Connect a database view**, SQL and **Connect external data**.

`docs/docs/en/data-sources/data-modeling/index.md:43-52` names General, Calendar,
**Comment**, Tree, File, SQL, **Connect a database view**, **Expression** and
**Connect external data**.

`docs/docs/en/data-sources/data-source-main/index.md:80-87` names General,
**Inheritance**, Tree, Calendar, File, SQL and **Database view collection**.

The shipped label is `Connect to database view`, which is none of
`Connect a database view`, `Database view collection` or `Database view`. D4 resolves the
way `findings.md` says: all three pages are wrong about that one name.

## Correction the earlier pass already flagged, confirmed here

`findings.md` F8's narrative sentence says upstream PR #10009 removed *Calendar, Expression,
Comment and Connect to foreign data* from the create menu. **`Calendar collection` is on
the menu at this SHA**, as the probe above shows and as the finding's own comparison table
already says. The table is right, the sentence is not.

## Raw captures

- `raw/web.json` → key `F8` — the menu item list, the count and the full vocabulary check
- `raw/f8-create-menu.png` — the open dropdown
- `raw/web.stdout.txt`
