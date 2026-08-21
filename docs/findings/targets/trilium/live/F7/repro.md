# F7 live re-run: the fuzzy operators ~= and ~* never lex
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

**VERDICT: still reproduces.** (Routed as a PR comment, not a new issue: upstream issue #9426
is open and PR #9508 / PR #10633 already target it.)

## Claim under test

The fuzzy operators `~=` and `~*` never lex, so a fuzzy query degrades to bare label existence.

## Fixture

Two notes carrying `#tcfuzzy`, with values chosen so a working fuzzy operator must
discriminate: `tcFuzzyGood` = `obb2wKi47mqT` (`#tcfuzzy=trilium`, edit distance 1 from the
typo) and `tcFuzzyOther` = `4weUGTNJRtdH` (`#tcfuzzy=zebra`, distance 6, far outside the
documented maximum of 2).

## Probe

```
PROBE  GET /api/search/#tcfuzzy ~= trilim    -> 200 [2] ["obb2wKi47mqT","4weUGTNJRtdH"]
PROBE  GET /api/search/#tcfuzzy ~= qqqqqqq   -> 200 [2] ["obb2wKi47mqT","4weUGTNJRtdH"]
PROBE  GET /api/search/#tcfuzzy ~* trilim    -> 200 [2] ["obb2wKi47mqT","4weUGTNJRtdH"]
PROBE  GET /api/search/#tcfuzzy ~* qqqqqqq   -> 200 [2] ["obb2wKi47mqT","4weUGTNJRtdH"]
```

The `qqqqqqq` lines are the decisive ones: that operand shares no character with either stored
value, and both notes still come back. The operand is not merely mis-ranked, it is not
consulted at all. The query has degraded to "the label exists".

## Control

```
CONTROL GET /api/search/#tcfuzzy = trilium   -> 200 ["obb2wKi47mqT"]
CONTROL GET /api/search/#tcfuzzy = zebra     -> 200 ["4weUGTNJRtdH"]
CONTROL GET /api/search/#tcfuzzy             -> 200 [2] both
```

The label, the values and the comparator machinery are sound. `=` splits the two notes
correctly and label existence returns both. Only `~` fails.

## The property-path forms, still silent on this build

```
PROBE  GET /api/search/note.title ~= Books                -> 200 []
PROBE  GET /api/search/note.content ~* zzzzznotpresent    -> 200 [16]  contains "root"? true
```

Confirms the hand-verification report's divergence note: the property-path forms fail silently
here rather than answering `Unrecognized expression`, and `note.content ~*` degrades to a
match-everything query returning the entire instance.

## Raw captures

- `transcript.txt` - the probe and control transcript
- `../raw/03-rest.mjs`, `../raw/lib.mjs` - the probe script
