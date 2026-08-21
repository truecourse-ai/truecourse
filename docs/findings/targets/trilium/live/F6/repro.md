# F6 live re-run: the search lexer strips commas even inside quotes
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

`#geolocation="48.8583,2.2945"` is unmatchable; a comma-free quoted value matches.

## Fixture, with the stored value read back first to rule out a write problem

`tcGeoMarker` = `l65BjI6IhuYL` carrying `#geolocation="48.8583,2.2945"`, and `tcNoComma` =
`gP4nDim7wyWo` carrying `#tcnocomma="48.8583"`.

```
GET /api/notes/l65BjI6IhuYL/attributes -> 200
   stored geolocation value(s): ["48.8583,2.2945"]      <- the comma IS in the store
```

## Probe

```
PROBE  GET /api/search/#geolocation="48.8583,2.2945"   -> 200 []
PROBE  GET /api/search/#geolocation=48.8583,2.2945     -> 200 []
PROBE  GET /api/search/#geolocation='48.8583,2.2945'   -> 200 []
```

All three quoting forms, including the double-quoted one the geo-map manual explicitly
instructs the user to write, answer 200 with an empty list. No error, no warning.

## Control

```
CONTROL GET /api/search/#geolocation             -> 200 ["l65BjI6IhuYL"]   the label exists
CONTROL GET /api/search/#tcnocomma="48.8583"     -> 200 ["gP4nDim7wyWo"]   same shape, no comma
CONTROL GET /api/search/#geolocation *=* 48.8583 -> 200 ["l65BjI6IhuYL"]   substring reaches it
```

The label exists, an identically shaped quoted equality on a comma-free value matches, and a
contains operator still sees the note. It is the comma, not the attribute, not the quoting,
not the route.

## The undocumented escape hatch, re-verified

```
PROBE  GET /api/search/#geolocation="48.8583\,2.2945"  -> 200 ["l65BjI6IhuYL"]
```

A backslash-escaped comma does match. Nothing in the geo-map pages or the search documentation
mentions escaping.

## Raw captures

- `transcript.txt` - the probe and control transcript
- `../raw/03-rest.mjs`, `../raw/lib.mjs` - the probe script
