# S1 live re-verification: admin-token permissions are deleted at every restart

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01:14 +0200, "enhancement(data-transfer): clarify partial transfer stage scope (#27322)"). Instance reports **Strapi 5.52.1** on node v24.14.1. Tested build in the original review was 5.52.0 @ `c43e9ee1e2`.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` from the repo root, sqlite at `examples/getstarted/.tmp/data.db`. Health `GET /_health` -> 204.
- **Seed:** `POST /admin/register-admin` created the super admin `tc-reverify@example.com` (user id 1). The admin token below is created by this scenario itself.
- **Verdict: still reproduces.**

## Steps

### 1. Create an admin token with one content-type permission and no `properties`

```
POST http://127.0.0.1:1347/admin/admin-tokens
Authorization: Bearer <super-admin jwt, redacted>
Content-Type: application/json

{"name":"tcref-mcp-restart-mt0g4qux","description":"TrueCourse live re-verification - S1",
 "lifespan":null,
 "adminPermissions":[{"action":"plugin::content-manager.explorer.read","subject":"api::article.article"}]}
```

`201 Created`. `data.id` = 5, `data.accessKey` = a 256 hex char key, and:

```json
"adminPermissions": [
  {"id":364,"documentId":"thjday34nbyyodq8v8edot4y",
   "action":"plugin::content-manager.explorer.read",
   "actionParameters":{},"subject":"api::article.article",
   "properties":{},"conditions":[],"locale":null}
]
```

Note `properties: {}`, which is what the route stores when the caller omits `properties.fields`. Raw capture: `step-2.create-admin-token.json`.

### 2. Re-send the grant through the route the admin panel's token form posts to

```
PUT /admin/admin-tokens/5
Authorization: Bearer <super-admin jwt, redacted>
{"adminPermissions":[{"action":"plugin::content-manager.explorer.read","subject":"api::article.article"}]}
```

`200 OK`, permission id 364 echoed back unchanged. Raw capture: `step-3.put-admin-token.json`.

### 3. Read the token back, before any restart

```
GET /admin/admin-tokens/5
```

`200 OK`, `data.adminPermissions` holds the one row (id 364). Raw capture: `step-4.get-admin-token-before-restart.json`.

### 4. Control: the grant is live on the MCP surface

```
POST /mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

`200 OK`, SSE tool list:

```
tools = ["list_article", "get_article"]
```

Raw capture: `step-5.tools-list-before-restart.json`.

### 5. Restart the server, changing nothing else

The process I started was stopped and started again with the identical command. No configuration was edited, no permission touched, no token altered. `GET /_health` -> 204 about two seconds later.

### 6. The identical `tools/list` call after the restart

```
POST /mcp
Authorization: Bearer <the same admin token accessKey>
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

`200 OK`:

```
event: message
data: {"result":{"tools":[]},"jsonrpc":"2.0","id":2}
```

Raw capture: `step-7.tools-list-after-restart.json`.

### 7. Read the token back after the restart

```
GET /admin/admin-tokens/5
Authorization: Bearer <super-admin jwt, redacted>
```

`200 OK` with:

```json
"adminPermissions": []
```

The permission row is gone from the database. Raw capture: `step-8.get-admin-token-after-restart.json`.

### 8. Control: the token still authenticates

```
POST /mcp  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_article","arguments":{}}}
```

`200 OK`, `isError: true`, text `MCP error -32602: Tool list_article disabled`. An invalid or expired token would be refused at authentication; this is an authenticated caller with nothing left to do. Raw capture: `step-9.tools-call-after-restart.json`.

Nothing was logged. The restarted server's log carries no warning, error or notice about the deletion between boot and the first request.

## Comparison with the original transcript

Identical. The original run (evidence `2026-08-14T15-07-53Z_74b6e3f2`) recorded `data: {"result":{"tools":[]},"jsonrpc":"2.0","id":2}` at step 7, byte for byte what this instance returned. The original did not perform the `GET /admin/admin-tokens/:id` read after the restart; that read is added here and confirms the review's mechanism directly, that the `admin::permission` row itself is deleted rather than the ability being derived differently.

## Source state on the re-verified build

`packages/core/admin/server/src/services/permission/queries.ts` still carries the nil-property rule in `filterPermissionsToRemove` (`hasInvalidProperties = isArray(applyToProperties) && invalidProperties.every(eq(true))`, then `if (!isRegisteredAction || isInvalidSubject || hasInvalidProperties) permissionsToRemove.push(permission)`), unchanged from the review's description at lines 90 to 123. No commit between the tested `c43e9ee1e2` and this head touches it.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. Symptom, mechanism and silence are all unchanged.
