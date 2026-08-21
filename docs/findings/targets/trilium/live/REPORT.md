# Trilium findings: live re-run against a locally built instance

All eight re-run findings **still reproduce**. Nothing is fixed, nothing changed shape, nothing
failed to reproduce.

| | |
| --- | --- |
| Checked | 2026-08-20 (run finished 2026-08-21T02:39Z) |
| Repo | `/Users/musheghgevorgyan/repos/trilium` |
| Branch | `main` |
| Build sha | `86a9715b09b4fc523764eee3e2ba08b5f58ef12b` |
| Tested commit of record | `3a73bc35` (the culprit blobs are byte-identical between the two, so building `main` is equivalent) |
| Toolchain | pnpm 11.22.0, node v24.14.1 |
| Install | `pnpm install --frozen-lockfile` (exit 0) |
| Build | `pnpm run --filter server build` (exit 0) |
| Artifact | `apps/server/dist/main.cjs`, 14,606,010 bytes, the same size as the hand-verification build |
| Server | `node apps/server/dist/main.cjs` on 127.0.0.1:8099, `TRILIUM_ENV=production`, `TRILIUM_DATA_DIR` a fresh scratch dir outside the repo |
| Seed | `reference/seed/guard-seed.mjs`, empty document (`?skipDemoDb`), instance password `TriliumGuard1!` |
| Browser | playwright-core 1.62.1 driving the **full Chromium build** rev 1194 (Chromium 141.0.7390.37). `chrome-headless-shell` for playwright 1.62's pinned rev 1234 is not installed on this machine, so the full chromium build was launched instead. |
| Docker | none started; the recipe declares no services |

## Verdicts

| # | Finding | Verdict |
| --- | --- | --- |
| F6 | `#geolocation="48.8583,2.2945"` is unmatchable, the lexer strips commas even inside quotes | **still reproduces** |
| F7 | the fuzzy operators `~=` / `~*` never lex, queries degrade to label existence | **still reproduces** |
| F8 | an unrecognised note property returns the whole tree including `root` and `_hidden`, with no error | **still reproduces** |
| F9 | leading-`#` bypass of the size-loading path, healed for the life of the process by one non-`#` query; `revisionCount` dead on both paths | **still reproduces** |
| F11 | `PUT` clone-to-branch with no body 500s on a destructure | **still reproduces** |
| F12 | creating any typed note without `content` 500s | **still reproduces** |
| F13 | a saved search never executes itself, and "Search now" runs a different, empty search | **still reproduces** |
| F17 | note titles are stored unsanitised on both write paths | **still reproduces** |

F10 was a skip and was not re-run.

## Method

Two things about this re-run were done deliberately rather than conveniently.

**F9 was run first, on a cold server, in a fixed order.** Its recorded mechanism is
order-dependent: the fixtures were created in one server process, that process was shut down,
and the probe transcript is the first search traffic the next process ever saw. The
`#`-leading probes ran before the single non-`#` query that heals them, and the healed re-runs
came after it, in one process. A third process, started against the same database, was then
probed cold to prove the healing is in-memory only and dies with the process. See
`F9/repro.md` and its two transcripts.

**F8 was also taken cold**, in its own process, before any non-`#` query, so that its
whole-tree answer could not be an artefact of F9's warm state.

Everything else (F6, F7, F11, F12, F13's API half, F17's API half) ran in one further process,
where warm state is irrelevant. The two browser surfaces (F13's DOM, F17's rendering) ran in a
final process with a real Chromium and a real session cookie.

## What this run adds to the hand-verification report

1. **F9's memoisation is provably process-scoped.** Restarting the server against the same
   database makes `#tcprop9 note.contentSize >= 0` answer `[]` again, then one non-`#` query
   heals it again. Nothing is written to the database.
2. **F8's dropped error was caught in the act.** The same query put through the sibling
   quick-search route returns
   `error: "Unrecognized note property \"ancestor\" in ..."`, while `GET /api/search/:searchString`
   returns 200 and the whole tree. The parser detects the problem; the route discards it.
3. **F12 extends to `code` as well as `book` and `text`.** All three 500 with
   `Note content must be set` when `content` is omitted.
4. **One small correction to the report's F9 section.** The report records cold
   `#tcprop9 note.revisionCount = 0 -> [<id>]`. Cold, this run gets `[]`: before any load the
   property is `undefined`, not `0`, so it only starts matching `= 0` once the process has been
   warmed. That is consistent with the report's own mechanism and does not touch the
   substantive claim, which reproduces exactly (`revisionCount` reads 0 for a note with one
   real revision, on both query paths).
5. **A route detail worth carrying into any filed issue for F12.**
   `POST /api/notes/:parentNoteId/children` requires `?target=into|after|before` or it rejects
   400 `Invalid target type.` before reaching the content check, so a reproduction snippet must
   include it.

## Environment hygiene

- Every process started by this run was stopped. `lsof -i :8099` is empty; no `main.cjs` and no
  chromium process survives.
- The Trilium data directory lived in the session scratchpad, outside the repo.
  `reference/seed/instance-data/` was never touched.
- No docker resource was started; no postgres or redis was contacted.
- No product source, lockfile or corpus file was modified. `git status` in the clone shows only
  the pre-existing untracked `.truecourse/` and `reference/`.
- Disk: 25 GB free before install, 22 GB after the build, 27 GB at the end. Never near the 3 GB
  floor.

## Layout

```
live/
  REPORT.md      this file
  summary.json
  F6/  repro.md  transcript.txt
  F7/  repro.md  transcript.txt
  F8/  repro.md  transcript.txt
  F9/  repro.md  transcript.txt  transcript-restart.txt
  F11/ repro.md  transcript.txt
  F12/ repro.md  transcript.txt
  F13/ repro.md  transcript.txt  web-transcript.txt
       F13-before-click.png  F13-after-click.png
       F13-body-before.txt   F13-body-after.txt
  F17/ repro.md  transcript.txt  F17-tree-render.png
  raw/ the probe scripts, the full API transcript, the fixture ids,
       the machine-readable captures, the build log, the install log tail
```
