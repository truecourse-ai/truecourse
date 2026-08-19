# S8 live re-verification: `DELETE /api/:plural/:id?status=draft` answers 500; `?status=published` deletes the draft too

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Seed:** the full-access content API token minted at `POST /admin/api-tokens` (`type: full-access`). Both documents below are created by this scenario.
- **Verdict: still reproduces**, both halves.

All requests carry `Authorization: Bearer <full-access content API token, redacted>`.

## Part A: `?status=draft` on delete

### 1. Create with `?status=draft`

```
POST /api/articles?status=draft
{"data":{"title":"DP API Status mt0g8fky","slug":"dp-api-status-mt0g8fky"}}
```

`201 Created`, `documentId` = `qbod5ch6zve5z4o91xom1gce`, `publishedAt` = `null`. Raw capture: `step-1.create.status-draft.json`.

### 2 and 3. The parameter works as a read filter

- `GET /api/articles?status=draft&filters[slug][$eq]=dp-api-status-mt0g8fky` -> `200`, `meta.pagination.total` = **1**
- `GET /api/articles?status=published&filters[slug][$eq]=dp-api-status-mt0g8fky` -> `200`, `meta.pagination.total` = **0**

Raw captures: `step-2.list.status-draft.json`, `step-3.list.status-published.json`.

### 4. The parameter works on update

```
PUT /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft
{"data":{"title":"DP API Status mt0g8fky edited"}}
```

`200 OK`, title applied. Raw capture: `step-4.update.status-draft.json`.

### 5. The same parameter on delete

```
DELETE /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft
```

`500 Internal Server Error`:

```json
{"data":null,"error":{"status":500,"name":"InternalServerError","message":"Internal Server Error"}}
```

Raw capture: `step-5.delete.status-draft.json`. Server log for that request (`server.log.excerpt.txt`):

```
[2026-08-19 11:52:45.232] error: Cannot delete a draft document
Error: Cannot delete a draft document
    at deleteDocument (.../packages/core/core/dist/services/document-service/repository.js:273:19)
    ...
    at async CollectionTypeService.delete (.../core-api/service/collection-type.js:58:29)
[2026-08-19 11:52:45.232] http: DELETE /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft (2 ms) 500
```

A bare `Error`, not an `errors.ValidationError`, so the Koa error middleware maps it to 500 and scrubs the message.

### 6. The document survives

```
GET /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft
```

`200 OK`, title `DP API Status mt0g8fky edited`. The call was a total no-op, so no data was lost. Raw capture: `step-6.readback-after-failed-delete.json`.

## Part B: `?status=published` on a published document

### 7. Create published

```
POST /api/articles?status=published
{"data":{"title":"DP API Status Pub mt0g8fky","slug":"dp-api-status-pub-mt0g8fky"}}
```

`201 Created`, `documentId` = `l7bhxved9fbl8prawsq7tsy0`, `publishedAt` = `2026-08-19T18:52:45.246Z`. Raw capture: `step-7.create.status-published.json`.

### 8. Confirm a draft version exists alongside it

```
GET /api/articles/l7bhxved9fbl8prawsq7tsy0?status=draft
```

`200 OK`, `publishedAt: null`. Raw capture: `step-8.draft-exists-before-delete.json`.

### 9. Delete, scoped to the published version

```
DELETE /api/articles/l7bhxved9fbl8prawsq7tsy0?status=published
```

`204 No Content`, empty body. Raw capture: `step-9.delete.status-published.json`.

### 10 and 11. Both versions are gone

- `GET /api/articles/l7bhxved9fbl8prawsq7tsy0?status=draft` -> `404`
- `GET /api/articles/l7bhxved9fbl8prawsq7tsy0?status=published` -> `404`

Raw captures: `step-10.draft-after-published-delete.json`, `step-11.published-after-delete.json`. The parameter was accepted, answered 204, and removed the version it was told to spare. `status` cannot scope a delete at all: one legal value throws, the other is ignored.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 5) recorded the same `500` with the same body and the same `Cannot delete a draft document` at `repository.js:273`, with steps 1 to 4 passing exactly as here. Part B is new observation: the original run aborted at step 5 and never exercised `?status=published`. It confirms the review's second claim, which had been read from source only.

## Source state on the re-verified build

`packages/core/core/src/services/document-service/repository.ts` line 389 is still `throw new Error('Cannot delete a draft document')`. Unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`, and the `?status=published` half is now observed rather than inferred.
