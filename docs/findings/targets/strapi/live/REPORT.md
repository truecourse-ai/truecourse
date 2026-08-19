# Strapi live re-verification report

**Checked:** 2026-08-19
**Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, committed 2026-08-19 17:01:14 +0200 ("enhancement(data-transfer): clarify partial transfer stage scope (#27322)"). This is the same head `targets/STATE.md` recorded this morning, so upstream has not moved since the plan was written.
**Version the instance reports:** Strapi **5.52.1** (`packages/core/strapi/package.json`, and the boot banner), on node v24.14.1. The original guard run tested 5.52.0 @ `c43e9ee1e2`, so this re-verification is one patch release and 14 commits later.

Every finding attempted reproduces. Nothing is fixed, nothing changed behaviour, and three findings came back **wider** than the original evidence supported, because steps the original runs aborted before reaching were executed here.

## Results

| id | verdict | one-line evidence | evidence path |
|---|---|---|---|
| S1 | still reproduces | `tools/list` = `["list_article","get_article"]` before a restart, `[]` after, and `GET /admin/admin-tokens/5` then shows `adminPermissions: []` while the token still authenticates | `S1/` |
| S2 | still reproduces | `{set:[cat1], connect:[cat2]}` accepted (200, no `isError`, `updatedAt` advanced) and the read-back holds cat1 only, so `connect` was discarded | `S2/` |
| S3 | still reproduces | `{set: null}` -> 200, no `isError`, `updatedAt` +71 ms, and `get_article` still returns the category | `S3/` |
| S4 | still reproduces | three consecutive write replies all say `"categories":[]` while `get_article` at the same `updatedAt` returns one category | `S4/` |
| S5 | still reproduces | `$null:true` and `$notNull:true` both answer `-32602 ... Invalid input at filters.$and[1].authorName`; `$null:null` is accepted and returns the two documents that DO have an author name | `S5/` |
| S6 | still reproduces | MCP error text is the full `insert into ... values ('2026-08-19 11:52:17.567', 1, 'cyimpmcud8qivqx73f5su8mv', ...) returning id - database is locked`; the same failure through REST is a scrubbed 500 | `S6/` |
| S7 | still reproduces | MCP `pagination.pageSize` = 10, the tool's own schema says "default: 25, max: 100", REST on the same instance says 25 | `S7/` |
| S8 | still reproduces | `DELETE ...?status=draft` -> 500 (`Cannot delete a draft document` in the log, document survives); `DELETE ...?status=published` -> 204 and both versions are 404 afterwards | `S8/` |
| S9 | still reproduces | `DELETE /api/tcref-not-a-content-type/<id>` -> 405, `Allow: HEAD, GET`, `text/plain` body `Method Not Allowed`; `GET` on the same path -> JSON 404 | `S9/` |
| S10 | still reproduces | the bulk-unpublish `alertdialog` offers `["Cancel","Confirm"]` and zero buttons named `Unpublish`; the bulk-publish dialog does end on a `Publish` button | `S10/` |
| S11 | still reproduces (wider) | a token holding only `admin::admin-tokens.read` reads a sibling token's plaintext key and gains 6 content-manager tools it had none of, and a `create_article` with the harvested key succeeds | `S11/` |
| S15 | still reproduces | 404 message is `Not Found` (docs: "Document not found"); 403 message is `Forbidden` (docs: "Forbidden access") | `S15/` |
| S16 | still reproduces | `data` keys are id, documentId and attributes only; `meta` appears once as a sibling of `data` and is `{}` | `S16/` |

Not attempted, per the index: S12, S13, S14 (`liveMinimum: false`, not in the cheap-extras list) and S17 (routed as an environment artifact).

## How the instance was built

```bash
cd <scratchpad>/build
git clone --depth 1 --branch develop https://github.com/strapi/strapi.git strapi
cd strapi                                   # HEAD = c7dbadd4feec41f0d3892c1bc9f5435e7aad3672
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 STRAPI_TELEMETRY_DISABLED=true
corepack yarn install                       # yarn 4.12.0 via corepack 0.34.6, 44 s
corepack yarn build                         # nx, build:code + build:types for 37 projects, 102 s
corepack yarn workspace getstarted build    # admin panel, 11 s
PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start
```

Node 24.14.1 (engines allow `>=20 <=26`). `yarn build` succeeded on the first try with no filtering needed; nothing had to be skipped. Total build time about 2.5 minutes, plus 44 s install.

Health: `GET /_health` -> 204, reached about 2 s after start on both boots.

`examples/getstarted` was used as shipped: sqlite at `examples/getstarted/.tmp/data.db`, `mcp.enabled: true` in `config/server.js`, `api.js` pinning `rest.defaultLimit: 25` and `maxLimit: 30` (the S17 artifact, left alone), `api::article.article` and `api::category.category` both localized with `draftAndPublish`.

## How it was seeded

All by hand over HTTP, since the original run's `reference/seed/guard-seed.mjs` is not on this machine.

1. `POST /admin/register-admin` -> super admin `tc-reverify@example.com` / `Reverify1234` (admin user id 1).
2. `POST /admin/login` -> `data.token`, the jwt every admin-API call below uses.
3. `POST /admin/api-tokens` with `type: "full-access"` and with `type: "read-only"` -> the two content-API tokens (S6 REST contrast, S8, S9, S15, S16, and the S10 fixtures).
4. Per scenario, `POST /admin/admin-tokens` plus a `PUT /admin/admin-tokens/:id` re-grant, with the `adminPermissions` each scenario yaml specifies. S1 uses exactly `[{action: "plugin::content-manager.explorer.read", subject: "api::article.article"}]`; the relation and filter scenarios use the five-permission and two-permission sets from their yamls, with `properties.locales: ["en"]`.
5. Content created through the MCP tools (`create_category`, `create_article`) or REST (`POST /api/articles`), with documentIds read back through `GET /content-manager/collection-types/...` with the admin jwt, exactly as the yamls do, because an SSE-framed tool reply cannot be captured from.

MCP calls: `POST /mcp`, `Authorization: Bearer <admin token accessKey>`, `Accept: application/json, text/event-stream`, JSON-RPC bodies. Responses came back as SSE and the `data:` line was parsed.

## Ordering constraint worth knowing

S1 is not just a finding, it is a constraint on how the rest of the work can be scheduled. Because every restart wipes the admin tokens' content-type permissions, all MCP scenarios (S2 to S7, S11) had to run inside a single server lifetime, after the one restart S1 needs, with each scenario minting and granting its own token. Any re-run has to do the same, or every MCP scenario after a restart will fail for the S1 reason instead of its own.

## Problems hit

- **Disk.** The machine started at 9.5 GB free. `yarn install` took it to 6.2 GB, `yarn build` bottomed out at 1.7 GB mid-build, then APFS purged and it recovered to 3.0 GB once the build finished and the nx cache (199 MB, inside the build dir) was removed. It ended at 6.7 GB after cleanup. The 2 GB floor was crossed only transiently during the build itself, and nothing outside the build dir was deleted.
- **Guided tour (S10).** A fresh admin user on 5.52.1 is served a four-step guided-tour popover over the Content Manager list. It intercepts pointer events and made the first playwright attempt time out on the select-all checkbox. It is dismissed with its own `Skip` button. The original guard run did not hit it, presumably because its fixture user had already dismissed it. Anyone re-running the web scenarios on a fresh instance needs the same dismissal.
- **Dialog role (S10).** The confirmation modal is `role="alertdialog"`, not `role="dialog"`, so `getByRole('dialog')` does not find it.
- **S6 trigger.** The original hit `database is locked` by accident. Here it was induced with a `BEGIN IMMEDIATE` held open on the sqlite file from a second `sqlite3` process via a fifo. The lock was released immediately afterwards and nothing else was affected.

## What should change a finding's confidence or scope

1. **S11 should be re-routed.** The review filed it as a docs drift with a source-only escalation note. That escalation is now observed end to end on a live instance: a token whose only permission is `admin::admin-tokens.read` reads a sibling token's 256-character plaintext key, that key serves six content-manager MCP tools the harvester had none of, and a write with it succeeds. This belongs in a security report, with the docs correction as the secondary half. `S11/step-9` and `step-10` are the two captures that carry it.
2. **S2, S3, S8 gain the halves their original runs never reached.** S2's read-back now shows `connect` was actually discarded (the original had only the acceptance). S3 was previously visible only in a sibling run, and is confirmed here in the same session as S2. S8's `?status=published` half, which deletes the draft it was told to spare, was read from source in the review and is now observed. All three can be stated as fact rather than inference.
3. **S5 is worse than "the operator is unusable".** Both boolean forms are rejected, and the one value the advertised schema does accept (`$null: null`) returns the exact complement of what was asked, silently. The live run makes that concrete: asking for "authorName is null" returned the two documents that have an author name and not the one that does not.
4. **S6's scope should say "MCP boundary", not "Strapi".** The REST contrast captured here shows the same driver error is scrubbed to a bare 500 on `POST /api/articles` and echoed in full through `POST /mcp`, so the fix is unambiguously in `tool-registry.ts` rather than anywhere shared.
5. **S9's `Allow` header claim is confirmed as conditional.** On an unrouted path the header is wrong (`HEAD, GET` for a path where GET is a 404). On a real collection root it is right (`HEAD, GET, POST`). Both are captured, which supports the review's note that step 4 of the original yaml should expect 405 rather than 404.
6. **S10 is confirmed label-only.** Clicking `Confirm` did unpublish both entries, and the sibling bulk-publish dialog does end on a button named `Publish`. The docs are not stale; one dialog regressed.

## Cleanup

The build dir `<scratchpad>/build/strapi` (clone, `node_modules`, all build output) was deleted after the evidence was written. No database was created on the shared Postgres: this instance used the sqlite file inside the build dir, which went with it. Nothing outside the build dir was removed.
