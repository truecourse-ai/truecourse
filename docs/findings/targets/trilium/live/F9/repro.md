# F9 live re-run: the DB-backed search properties

| | |
| --- | --- |
| Checked | 2026-08-20 (run finished 2026-08-21T02:39Z) |
| Build | `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, built from source in this session |
| Tested commit of record | `3a73bc35` (culprit blobs byte-identical to `main`) |
| Toolchain | pnpm 11.22.0, node v24.14.1 |
| Build steps | `pnpm install --frozen-lockfile`, then `pnpm run --filter server build` |
| Artifact | `apps/server/dist/main.cjs`, 14,606,010 bytes (identical size to the hand-verification build) |
| Server | `node apps/server/dist/main.cjs`, `TRILIUM_ENV=production TRILIUM_HOST=127.0.0.1 TRILIUM_PORT=8099`, `TRILIUM_DATA_DIR` a fresh scratch directory outside the repo |
| Seed | `reference/seed/guard-seed.mjs`, empty document, instance password `TriliumGuard1!` |
| Auth | every `/api/**` call carries the session cookie and the paired CSRF cookie + `x-csrf-token` header |

**VERDICT: still reproduces**, in full, including the corrected mechanism.

## The claim under test

1. A query whose trimmed text starts with `#` short-circuits the size-loading path, so on a
   cold server `#label note.contentSize >= 0` answers `[]` while the reordered
   `note.contentSize > 0 AND #label` answers the note.
2. Running the second query permanently fixes the first for the life of the process
   (becca memoisation).
3. `revisionCount` is unconditionally dead on both paths.

All three hold.

## Fixture

`tcSizeNote` = `ZWB3896n0unt`, a `text` note carrying `#tcprop9`, with 92 bytes of stored
content and one real revision. Both read back before the probe:

```
GET /api/notes/ZWB3896n0unt/blob      -> 200  contentLength=92
POST /api/notes/ZWB3896n0unt/revision -> 200  {"revisionId":"nPb5KrSPqx8L"}
GET /api/notes/ZWB3896n0unt/revisions -> 200  1 revision:  ["nPb5KrSPqx8L"]
```

The fixture was created in a **previous server process**, which was then shut down, so the
probe below is the first search this process ever ran. Order matters here and the server was
cold by construction, not by assumption.

## Probe, cold process, every query leading with `#`

```
PROBE     GET /api/search/#tcprop9 note.contentSize > 0                          -> 200 []
PROBE     GET /api/search/#tcprop9 note.contentSize >= 0                         -> 200 []
PROBE     GET /api/search/#tcprop9 note.contentSize < 1000000                    -> 200 []
PROBE     GET /api/search/#tcprop9 note.contentAndAttachmentsSize > 0            -> 200 []
PROBE     GET /api/search/#tcprop9 note.contentAndAttachmentsAndRevisionsSize >= 0 -> 200 []
PROBE     GET /api/search/#tcprop9 note.revisionCount >= 0                       -> 200 []
PROBE     GET /api/search/#tcprop9 note.revisionCount >= 1                       -> 200 []
PROBE     GET /api/search/#tcprop9 note.revisionCount = 1                        -> 200 []
PROBE     GET /api/search/#tcprop9 note.revisionCount = 0                        -> 200 []
```

`>= 0` and `< 1000000` are the decisive pair: no value of `contentSize` can fail both.

## Control 1: becca-backed properties, same note, same shape, still `#`-leading

```
CONTROL   GET /api/search/#tcprop9 note.parentCount = 1   -> 200 ["ZWB3896n0unt"]
CONTROL   GET /api/search/#tcprop9 note.labelCount >= 1   -> 200 ["ZWB3896n0unt"]
CONTROL   GET /api/search/#tcprop9 note.type = text       -> 200 ["ZWB3896n0unt"]
```

The label, the note, the property syntax and the comparators are all sound. Only the
DB-backed properties answer nothing.

## Control 2: `orderBy` is innocent

```
PROBE     GET /api/search/#tcprop9 note.contentSize > 0 orderBy note.title              -> 200 []      (cold, "#"-leading)
AFTER     GET /api/search/note.contentSize > 0 AND #tcprop9 orderBy note.title          -> 200 ["ZWB3896n0unt"]
```

Same `orderBy`, opposite answers. The leading `#` is the whole story.

## Control 3: the same comparison in a query that does not begin with `#`

```
CONTROL   GET /api/search/note.contentSize > 0 AND #tcprop9   -> 200 ["ZWB3896n0unt"]
```

## The memoisation: the identical `#` query, same process, immediately after

```
AFTER     GET /api/search/#tcprop9 note.contentSize > 0                    -> 200 ["ZWB3896n0unt"]
AFTER     GET /api/search/#tcprop9 note.contentSize >= 0                   -> 200 ["ZWB3896n0unt"]
AFTER     GET /api/search/#tcprop9 note.contentSize > 0 orderBy note.title -> 200 ["ZWB3896n0unt"]
```

The query that answered `[]` four requests earlier now answers the note. Nothing about the
note, the label or the query changed; only the process state did.

## The memoisation is process-scoped, not persisted

The server was restarted against the **same** database and re-probed as its first traffic
(`transcript-restart.txt`):

```
PROBE     GET /api/search/#tcprop9 note.contentSize >= 0    -> 200 []                 (dead again)
PROBE     GET /api/search/#tcprop9 note.contentSize > 0     -> 200 []
CONTROL   GET /api/search/note.contentSize > 0 AND #tcprop9 -> 200 ["ZWB3896n0unt"]   (heals it again)
AFTER     GET /api/search/#tcprop9 note.contentSize >= 0    -> 200 ["ZWB3896n0unt"]
```

So the same query answers differently depending on what was searched before it, and a restart
resets the answer. This is the sharpest form of the defect and it reproduced on every attempt.

## The non-`#` path is correct in isolation

Run as the first non-`#` traffic of another cold process (see `../F8/transcript.txt`, tail):

```
GET /api/search/note.contentSize >= 0  -> 200 [16]   (every note in the instance)
GET /api/search/note.contentSize > 0   -> 200 [14]   (only the ones with content)
```

Both answers are correct, which is what makes the `#` form's `[]` a bypass rather than a
broken comparator.

## `revisionCount`: dead on both paths

Warm process, note demonstrably carrying one revision:

```
PROBE     GET /api/search/note.revisionCount >= 1 AND #tcprop9  -> 200 []                  (no leading "#", still dead)
CONTROL   GET /api/search/note.revisionCount = 0 AND #tcprop9   -> 200 ["ZWB3896n0unt"]
AFTER     GET /api/search/#tcprop9 note.revisionCount >= 1      -> 200 []
AFTER     GET /api/search/#tcprop9 note.revisionCount = 0       -> 200 ["ZWB3896n0unt"]
GET /api/notes/ZWB3896n0unt/revisions -> 200  1 revision(s): ["nPb5KrSPqx8L"]
```

`revisionCount` reads `0` for a note that has one revision, on the warmed `#` path and on the
non-`#` path alike. Warming fixes the three size properties; it does not fix this one.

## One refinement to the hand-verification report

The report records cold `#tcprop9 note.revisionCount = 0 -> [<id>]`. On this run the cold
`#`-leading `= 0` answers `[]` (the property is `undefined`, not `0`, before any load), and
only starts matching once the process has been warmed by a non-`#` query. That is consistent
with the report's own mechanism; the report's line appears to have been taken warm. The
substantive claim (`revisionCount` never reflects the real count) is unaffected and reproduces
exactly.

## Raw captures

- `transcript.txt` - the full cold-start transcript, in order, one process
- `transcript-restart.txt` - the restart addendum proving the memoisation dies with the process
- `../raw/01-F9.mjs`, `../raw/06-F9-revert.mjs`, `../raw/lib.mjs` - the probe scripts
- `../raw/fixture-ids.json` - the fixture ids
