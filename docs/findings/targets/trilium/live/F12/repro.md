# F12 live re-run: creating a typed note without content 500s
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

**VERDICT: still reproduces**, and the generalisation holds: it is not `book`-specific.

## Claim under test

Creating any typed note without `content` 500s (`{"title":"x","type":"text"}`), and the title
defaults when missing.

## Probe

```
PROBE   POST /api/notes/root/children?target=into   {"title":"tcprobebook","type":"book"}
        -> 500 {"message":"Note content must be set"}

PROBE   POST /api/notes/root/children?target=into   {"title":"tcprobetext","type":"text"}
        -> 500 {"message":"Note content must be set"}

PROBE   POST /api/notes/root/children?target=into   {"title":"tcprobecode","type":"code"}
        -> 500 {"message":"Note content must be set"}
```

A plain `text` note without `content` 500s identically to a `book`, and so does `code`. This is
a defect of `createNewNote` for every type, not a `book` defect.

(`?target=into` is required by the route itself; without it the request is rejected 400
"Invalid target type." before ever reaching the content check, so it is present on every call
above and on the controls below.)

## Control 1: an empty string is accepted

```
CONTROL POST /api/notes/root/children?target=into   {"title":"tcprobebook-control","type":"book","content":""}
        -> 200 {"note":{"noteId":"CU1UNxmnBSUQ","title":"tcprobebook-control","type":"book", ...}}
```

Omitting the key is fatal; supplying it empty is fine. Nothing about the note being created is
invalid.

## Control 2: the asymmetry with `title`

```
CONTROL POST /api/notes/root/children?target=into   {"type":"text","content":""}
        -> 200  note.title = "New note"
```

A missing title is defaulted; a missing content throws. That asymmetry is the bug's shape, and
it reproduces exactly.

## Raw captures

- `transcript.txt` - the probe and control transcript
- `../raw/api-raw.json` - the verbatim status codes and bodies
- `../raw/03-rest.mjs`, `../raw/lib.mjs` - the probe script
