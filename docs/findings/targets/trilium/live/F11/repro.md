# F11 live re-run: clone-to-branch 500s on an empty body
| | |
| --- | --- |
| Checked | 2026-08-20 (run finished 2026-08-21T02:39Z) |
| Build | `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, built from source in this session |
| Tested commit of record | `3a73bc35` (culprit blobs byte-identical to `main`) |
| Toolchain | pnpm 11.22.0, node v24.14.1 |
| Build steps | `pnpm install --frozen-lockfile`, then `pnpm run --filter server build` |
| Artifact | `apps/server/dist/main.cjs`, 14,606,010 bytes |
| Server | `node apps/server/dist/main.cjs`, `TRILIUM_ENV=production TRILIUM_HOST=127.0.0.1 TRILIUM_PORT=8099`, `TRILIUM_DATA_DIR` a fresh scratch directory outside the repo |
| Seed | `reference/seed/guard-seed.mjs`, empty document, instance password `TriliumGuard1!` |
| Auth | every `/api/**` call carries the session cookie and the paired CSRF cookie + `x-csrf-token` header |

**VERDICT: still reproduces.**

## Claim under test

`PUT` clone-to-branch with no body 500s on a destructure; `{"prefix": null}` works.

## Fixture

`tcCloneSource` = `uI5TTDlvedxt`, and `tcCloneTarget` = `nLQUhHGGu1BH` whose branch under root
is `root_nLQUhHGGu1BH`.

## Probe

```
PUT /api/notes/uI5TTDlvedxt/clone-to-branch/root_nLQUhHGGu1BH        (no body at all, no Content-Type)
  -> 500 {"message":"Cannot destructure property 'prefix' of 'e.body' as it is undefined."}
```

An internal error where a 400 belongs, and the message leaks the bundler's minified variable
name (`e.body`) to the caller.

## Control

```
PUT /api/notes/uI5TTDlvedxt/clone-to-branch/root_nLQUhHGGu1BH        {"prefix": null}
  -> 200 {"success":true,"branchId":"nLQUhHGGu1BH_uI5TTDlvedxt","notePath":"root/nLQUhHGGu1BH/uI5TTDlvedxt"}
```

Same note, same branch, same session, same process. Only the body differs. The clone itself is
perfectly legal.

## Raw captures

- `transcript.txt` - the probe and control transcript
- `../raw/api-raw.json` - the verbatim status codes and bodies
- `../raw/03-rest.mjs`, `../raw/lib.mjs` - the probe script
