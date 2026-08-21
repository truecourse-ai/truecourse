# F8 live re-run: an unrecognised note property degrades to the whole tree
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

`not(note.ancestor.title = ...)`, or any unknown property, returns the whole tree including
`root` and `_hidden`, with no error.

## Fixture

One note `tcPropNote` = `w898k2aBwuDl` carrying `#tcprop8`, sitting under `tcbox` =
`h5QNPC6UWkAG`. The instance holds 16 notes in total.

Taken on a **cold server** (the first search traffic of a freshly started process), so no
earlier query could have influenced it.

## Probe

```
PROBE  GET /api/search/#tcprop8 AND not(note.ancestor.title = tcbox)
       -> 200 [16] ["root","uI5TTDlvedxt","nLQUhHGGu1BH","obb2wKi47mqT","4weUGTNJRtdH",
                    "l65BjI6IhuYL","gP4nDim7wyWo","Tls839FIYtrV","gmKHJ8TiN1St","ZWB3896n0unt",
                    "lrJ6QQydNiyq","h5QNPC6UWkAG","A2nb3vnWnyi8","kn7Lw7kh0enb","w898k2aBwuDl","_hidden"]
          contains "root"?    true
          contains "_hidden"? true

PROBE  GET /api/search/#tcprop8 note.noteSize > 50            -> 200 [16]  contains "root"? true, "_hidden"? true
PROBE  GET /api/search/#tcprop8 note.ownedAttributeCount >= 1 -> 200 [16]  contains "root"? true, "_hidden"? true
```

Both the label filter and the negation vanish. The answer is every note in the instance,
including `root` and `_hidden`. HTTP 200, a plausible-looking list, no signal that the query
failed.

## Control: the recognised plural spelling, and the rest of the machinery

```
CONTROL GET /api/search/#tcprop8                                       -> 200 ["w898k2aBwuDl"]
CONTROL GET /api/search/#tcprop8 AND not(note.ancestors.title = tcbox) -> 200 []
CONTROL GET /api/search/#tcprop8 AND note.ancestors.title = tcbox      -> 200 ["w898k2aBwuDl"]
CONTROL GET /api/search/#tcprop8 AND note.ancestors.title = nosuchbox  -> 200 []
CONTROL GET /api/search/#tcprop8 note.labelCount >= 1                  -> 200 ["w898k2aBwuDl"]
CONTROL GET /api/search/#tcprop8 AND not(note.type = code)             -> 200 ["w898k2aBwuDl"]
```

The plural spelling behaves perfectly: the note is under `tcbox`, so the negation correctly
excludes it and the positive form correctly includes it. `not(...)`, `AND` and the label filter
are all sound. One letter in the property name is the whole difference between one note and
the entire tree.

## Extra evidence this run adds: the error exists, the route drops it

The same query put through the sibling quick-search route, which does return `error`:

```
GET /api/quick-search/#tcprop8 AND not(note.ancestor.title = tcbox) -> 200
   error: "Unrecognized note property \"ancestor\" in \"...cprop8 AND not(note.ancestor.title = tcbox)\""
```

So the parser does detect and record the problem. `GET /api/search/:searchString` simply never
reads `searchContext.getError()`, which is exactly the omission the hand-verification report
identified. This is a live confirmation of the mechanism, not just of the symptom.

## Verdict detail

Identical in kind to the recorded finding. The only difference is arithmetic: 16 notes returned
here against 25 in the hand-verification run, because this instance has a different fixture
count. In both cases the answer is "every note in the instance, `root` and `_hidden` included".

## Raw captures

- `transcript.txt` - the full cold-server transcript (its tail also carries the F9 non-`#` controls)
- `../raw/02-F8.mjs`, `../raw/lib.mjs` - the probe script
