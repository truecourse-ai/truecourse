# F13 live re-run: a saved search does not execute itself
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
| Browser | playwright-core 1.62.1 driving the **full Chromium build**, rev 1194, Chromium 141.0.7390.37. `chrome-headless-shell` for playwright 1.62's pinned rev 1234 is **not installed** on this machine, so the full chromium build was launched instead (as the re-run rules allow). |

**VERDICT: still reproduces**, on the API surface and in the DOM.

## Claim under test

Opening a saved-search note says "Search has not been executed yet.", and the **Search now**
button navigates to a different note id with an empty query returning the whole instance.

## Fixture

Two notes carrying `#tcfindme`, deliberately in different subtrees: `tcHitAlpha` =
`A2nb3vnWnyi8` under `tcSSBoxA`, `tcHitBeta` = `kn7Lw7kh0enb` under `tcSSBoxB`.

A saved search created the way the corpus creates one, with its born-empty `searchString`
attribute updated in place:

```
POST /api/special-notes/search-note -> 200  noteId=tNKub6PWBEHG  type=search  title="Search: "
born with: ["searchString=","keepCurrentHoisting=","ancestor=root"]
PUT  /api/notes/tNKub6PWBEHG/attributes  (searchString -> "#tcfindme")  -> 204
now:       ["searchString=#tcfindme","keepCurrentHoisting=","ancestor=root"]
```

## Probe A: the API surface

```
POST /api/tree/load {"noteIds":["tNKub6PWBEHG"]}
  -> children of the saved search: 0
```

Zero sub-notes. The manual's "the search results will appear as sub-notes under these saved
search notes" is not what is stored.

## Control A: the query is valid and the server runs it on demand

```
GET /api/search-note/tNKub6PWBEHG
  -> 200 {"searchResultNoteIds":["A2nb3vnWnyi8","kn7Lw7kh0enb"],"highlightedTokens":["tcfindme"],"error":null}
GET /api/search/#tcfindme
  -> 200 ["A2nb3vnWnyi8","kn7Lw7kh0enb"]
POST /api/tree/load again
  -> children: 0     (the results are in-memory only)
```

The two hits are exactly right. Nothing is wrong with the query, the label or the search
engine. The results simply never materialise, and the client must ask for them.

## Probe B: the DOM

A second, freshly created saved search (`fNpO06ehjjK3`, same three attributes, same
`searchString=#tcfindme`, 0 stored children) opened at
`http://127.0.0.1:8099/#root/fNpO06ehjjK3`:

```
.search-result-widget in the DOM: 5, of them visible: 1

innerText of the VISIBLE search-result widget:
    Search has not been executed yet.
    Search now

body contains "Search has not been executed yet." -> true
body contains "tcHitAlpha"                        -> false
body contains "tcHitBeta"                         -> false
buttons inside the visible .search-result-widget: ["Search now"]
```

The note is open, its labels are on it, and the result list is a prompt. Screenshot:
`F13-before-click.png`; full page text: `F13-body-before.txt`.

## Control B: pressing "Search now" runs a different search

```
url before click: http://127.0.0.1:8099/#root/_hidden/_search/NpJd5jXZN9QK/fNpO06ehjjK3?ntxId=fIN8fe
url after  click: http://127.0.0.1:8099/#root/_hidden/_search/NpJd5jXZN9QK/XKt9xVS3FQB9?ntxId=fiiXc3
note id before: fNpO06ehjjK3   note id after: XKt9xVS3FQB9   same note? false
```

The click navigates to a brand-new, different note id:

```
GET /api/notes/XKt9xVS3FQB9            -> title "Search: "  type search
GET /api/notes/XKt9xVS3FQB9/attributes -> ["searchString=","keepCurrentHoisting=","ancestor=root"]   <- searchString EMPTY
GET /api/search-note/XKt9xVS3FQB9      -> 200, 20 results   (the empty query = the whole instance)
GET /api/search-note/fNpO06ehjjK3      -> 200, ["A2nb3vnWnyi8","kn7Lw7kh0enb"]   (what you were actually looking at)
```

The result list rendered after the click is every note in the instance; `tcHitAlpha` and
`tcHitBeta` appear only as two of the 20, alongside `tcbox`, `tcGeoMarker`, `New note` and the
rest. Screenshot: `F13-after-click.png`; full page text: `F13-body-after.txt`.

The only control the widget offers for running the saved search does not run the saved search.

## Note on the DOM capture

Trilium restores previously opened note contexts, so five `.search-result-widget` nodes exist
in the DOM after several probe sessions against the same document; exactly one is visible and
all assertions above are scoped to that visible widget. `body.innerText` excludes the hidden
ones, so the "not executed" and "no hits shown" assertions are unaffected.

## Raw captures

- `transcript.txt` - the API half
- `web-transcript.txt` - the DOM half, including the full innerText before and after the click
- `F13-before-click.png`, `F13-after-click.png` - screenshots
- `F13-body-before.txt`, `F13-body-after.txt` - untruncated page text
- `../raw/05-web.mjs`, `../raw/03-rest.mjs`, `../raw/lib.mjs` - the probe scripts
