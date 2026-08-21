---
finding: F9
target: TriliumNext/Trilium
route: public issue
title: "Search: a query whose text starts with \"#\" never loads note sizes, so the same query answers differently depending on what was searched before it in that process"
labels: "not applied by us (outside contributor cannot self-apply); suggested in the body: State: Triage, BE, search"
status: draft
reverified: "2026-08-20 live re-run against a server built from source at main @ 86a9715b09b4fc523764eee3e2ba08b5f58ef12b, run on three separate server processes so the cold, warm and post-restart states could each be observed as first traffic; evidence in docs/findings/targets/trilium/live/F9/repro.md, live/F9/transcript.txt and live/F9/transcript-restart.txt"
format_note: "bug_report.yml is a YAML issue form. Body uses its six `### ` section headers verbatim and in template order (Description, TriliumNext Version, What operating system are you using?, What is your setup?, Operating System Version, Error logs), with all own sub-headings demoted to `####`. Dropdown answers are real template options: `macOS` for the OS field and `Server access only` for the setup field, which is what we actually ran. No template-enforcing workflow is configured on this repo, but the form shape is matched anyway. Issue 5432 and pull request 10633 are referred to in plain words with full URLs rather than hash-number syntax."
---

# Search: a query whose text starts with "#" never loads note sizes, so the same query answers differently depending on what was searched before it in that process

### Description

**The short version: on a freshly started server, `#tcprop9 note.contentSize >= 0` answers `[]` while the reordered `note.contentSize > 0 AND #tcprop9` answers the note. Running the second query permanently repairs the first for the rest of that process. Restart the server against the same database and the first is dead again. Two identical requests, same database, same note, different answers, decided entirely by what was searched earlier in the process.**

The whole report in five lines, all against the same note, in the order they were issued:

```
=== process A, cold, the first search traffic it ever saw ===
GET /api/search/#tcprop9 note.contentSize >= 0       -> 200 []
GET /api/search/note.contentSize > 0 AND #tcprop9    -> 200 ["ZWB3896n0unt"]

=== same process A, four requests later, the identical query that just answered [] ===
GET /api/search/#tcprop9 note.contentSize >= 0       -> 200 ["ZWB3896n0unt"]

=== process B, same database, restarted, cold again ===
GET /api/search/#tcprop9 note.contentSize >= 0       -> 200 []
```

`>= 0` is deliberate. No value of `contentSize` can fail it, so `[]` is not a comparison that came out false; it is a comparison against `undefined`.

A query beginning with `#` returns early into `performSearch` and never reaches the only function that loads the size columns out of the database. That loader writes its results onto the in-memory becca notes and nothing ever clears them, so one query that did not begin with `#` leaves the values lying around for every later `#` query to find. That is the memoisation, and the restart above shows it is purely in-memory.

Two things follow that are worse than "a property does not work":

1. **A saved search or a script can answer correctly on a warm server and return nothing on a cold one**, and the difference is not in anything the user can see. Whichever way round it happens, one of the two answers is silently wrong.
2. **It is close to unreproducible by hand unless you know the rule.** A maintainer who happens to run any non-`#` query first will not see it at all. That is worth saying out loud, because it is probably why this has stayed open in a thinner form (see Related, below).

Separately, and on every path: **`note.revisionCount` is always 0**, so no comparison against it can ever be true for a note that has revisions.

#### What the manual promises

`docs/User Guide/User Guide/Basic Concepts and Features/Navigation/Search.md`, line 108:

> Notes have properties that can be used in searches, such as `noteId`, `dateModified`, `dateCreated`, `isProtected`, `type`, `title`, `text`, `content`, `rawContent`, `ownedLabelCount`, `labelCount`, `ownedRelationCount`, `relationCount`, `ownedRelationCountIncludingLinks`, `relationCountIncludingLinks`, `ownedAttributeCount`, `attributeCount`, `targetRelationCount`, `targetRelationCountIncludingLinks`, `parentCount`, `childrenCount`, `isArchived`, `contentSize`, `noteSize`, and `revisionCount`.

Line 110 then shows the `note.` prefix, and the page's own examples put a label filter first, which is exactly the shape that fails.

#### Reproduction

Run on a server built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b` (`package.json` version 0.105.0), `TRILIUM_ENV=production`, a fresh `TRILIUM_DATA_DIR`, an empty document (no demo database). Every request carries a normal session cookie and the paired CSRF header.

**Order matters, so the fixture was built in one server process, that process was shut down, and the probe below is the first search traffic the next process ever ran.** Cold by construction, not by assumption.

Fixture: one text note `tcSizeNote` = `ZWB3896n0unt`, carrying the label `#tcprop9`, with 92 bytes of stored content and one real revision. Both read back before probing, so neither is in doubt:

```
GET  /api/notes/ZWB3896n0unt/blob      -> 200  contentLength=92
POST /api/notes/ZWB3896n0unt/revision  -> 200  {"revisionId":"nPb5KrSPqx8L"}
GET  /api/notes/ZWB3896n0unt/revisions -> 200  1 revision: ["nPb5KrSPqx8L"]
```

Probe, cold process, every query leading with `#`:

```
GET /api/search/#tcprop9 note.contentSize > 0                             -> 200 []
GET /api/search/#tcprop9 note.contentSize >= 0                            -> 200 []
GET /api/search/#tcprop9 note.contentSize < 1000000                       -> 200 []
GET /api/search/#tcprop9 note.contentAndAttachmentsSize > 0               -> 200 []
GET /api/search/#tcprop9 note.contentAndAttachmentsAndRevisionsSize >= 0  -> 200 []
GET /api/search/#tcprop9 note.revisionCount >= 0                          -> 200 []
GET /api/search/#tcprop9 note.revisionCount >= 1                          -> 200 []
GET /api/search/#tcprop9 note.revisionCount = 1                           -> 200 []
GET /api/search/#tcprop9 note.revisionCount = 0                           -> 200 []
```

`>= 0` and `< 1000000` are the decisive pair. A note cannot fail both.

#### Control 1: the note, the label and the syntax are all fine

Same cold process, same `#`-leading shape, properties that are not loaded from the database:

```
GET /api/search/#tcprop9 note.parentCount = 1  -> 200 ["ZWB3896n0unt"]
GET /api/search/#tcprop9 note.labelCount >= 1  -> 200 ["ZWB3896n0unt"]
GET /api/search/#tcprop9 note.type = text      -> 200 ["ZWB3896n0unt"]
```

Only the four database-backed properties answer nothing.

#### Control 2: `orderBy` is not involved

Worth stating because it is the natural first guess, and it is wrong:

```
GET /api/search/#tcprop9 note.contentSize > 0 orderBy note.title             -> 200 []               (cold, "#"-leading)
GET /api/search/note.contentSize > 0 AND #tcprop9 orderBy note.title         -> 200 ["ZWB3896n0unt"]
```

Same `orderBy` clause, opposite answers. The leading `#` is the entire difference. In the source, the database load runs at `search.ts:243-245`, before the `orderBy` branch at `:249`, so it could not have been the cause.

#### Control 3: the comparison itself is correct when the query does not begin with `#`

Run as the first search traffic of another cold process, over a 16-note instance:

```
GET /api/search/note.contentSize >= 0  -> 200  16 ids   (every note in the instance)
GET /api/search/note.contentSize > 0   -> 200  14 ids   (only the ones with stored content)
```

Both answers are right, which is what makes the `#` form's `[]` a bypass rather than a broken comparator.

#### The healing, and the fact that it dies with the process

Immediately after Control 3 above, in the same process, the identical queries that had answered `[]`:

```
GET /api/search/#tcprop9 note.contentSize > 0                     -> 200 ["ZWB3896n0unt"]
GET /api/search/#tcprop9 note.contentSize >= 0                    -> 200 ["ZWB3896n0unt"]
GET /api/search/#tcprop9 note.contentSize > 0 orderBy note.title  -> 200 ["ZWB3896n0unt"]
```

Nothing about the note, the label, the query or the database changed. Only the process state did.

Then the server was restarted against the **same** database and probed as its first traffic:

```
GET /api/search/#tcprop9 note.contentSize >= 0     -> 200 []                  (dead again)
GET /api/search/#tcprop9 note.contentSize > 0      -> 200 []
GET /api/search/note.contentSize > 0 AND #tcprop9  -> 200 ["ZWB3896n0unt"]    (heals it again)
GET /api/search/#tcprop9 note.contentSize >= 0     -> 200 ["ZWB3896n0unt"]
```

Reproduced on every attempt, in both directions.

#### The second half: `note.revisionCount` is always 0

This one does not depend on the leading `#` and is not repaired by warming. The note demonstrably carries one revision:

```
GET /api/search/note.revisionCount >= 1 AND #tcprop9  -> 200 []                  (no leading "#", warm process, still dead)
GET /api/search/note.revisionCount = 0 AND #tcprop9   -> 200 ["ZWB3896n0unt"]
GET /api/search/#tcprop9 note.revisionCount >= 1      -> 200 []
GET /api/search/#tcprop9 note.revisionCount = 0       -> 200 ["ZWB3896n0unt"]
GET /api/notes/ZWB3896n0unt/revisions                 -> 200  1 revision: ["nPb5KrSPqx8L"]
```

A note with one revision matches `= 0` and fails `>= 1`, on both query paths. Warming fixes the three size properties; it does not fix this one.

#### Cause

Read at `86a9715b`, and unchanged since the commit this was first found on. Both halves live in `packages/trilium-core/src/services/search/services/search.ts`.

**1. The short-circuit.** `search.ts:426-436`, the tail of `findResultsWithQuery`:

```ts
// If the query starts with '#', it's a pure expression query.
// Don't use progressive search for these as they may have complex
// ordering or other logic that shouldn't be interfered with.
const isPureExpressionQuery = query.trim().startsWith('#');

if (isPureExpressionQuery) {
    // For pure expression queries, use standard search without progressive phases
    return performSearch(expression, searchContext, searchContext.enableFuzzyMatching);
}

return findResultsWithExpression(expression, searchContext);
```

**2. The bypassed load.** `findResultsWithExpression` at `:242-245` is the only caller of `loadNeededInfoFromDatabase()` (declared at `:117`), the function that computes `contentSize`, `contentAndAttachmentsSize`, `contentAndAttachmentsAndRevisionsSize` and `revisionCount`:

```ts
function findResultsWithExpression(expression: Expression, searchContext: SearchContext): SearchResult[] {
    if (searchContext.dbLoadNeeded) {
        loadNeededInfoFromDatabase();
    }
```

So the `#` path never honours `searchContext.dbLoadNeeded`, however diligently it was set. It is set: `expressions/property_comparison.ts:46-51` lists the four database-backed property names and `:75-77` flags the context in the constructor:

```ts
if (DB_BACKED_PROPERTIES.has(propertyName)) {
    searchContext.dbLoadNeeded = true;
}
```

The comparison then reads `undefined` off the becca note and matches nothing. Note that the flag is set and simply not read on one of the two paths, which is why the fix does not need new plumbing.

**3. The memoisation.** `loadNeededInfoFromDatabase()` writes its results onto the becca notes themselves (`search.ts:148`, `:238` and neighbours):

```ts
becca.notes[noteId].contentSize = length;
```

Nothing clears them for the life of the process, so the first non-`#` query in a process silently repairs every subsequent `#` query. That is the order-dependence, and it is why a restart brings the failure back.

**4. `revisionCount`, an independent arithmetic bug.** `search.ts:149` initialises it:

```ts
becca.notes[noteId].revisionCount = 0;
```

and `:229-234` is the only place it is ever incremented:

```ts
if (isNoteRevision) {
    const noteRevision = becca.notes[noteId];
    if (noteRevision && noteRevision.revisionCount) {
        noteRevision.revisionCount++;
    }
}
```

`revisionCount` starts at `0`, which is falsy, so the guard can never pass and the counter can never leave `0`. This one is unconditional: it is wrong on the warm `#` path and on the non-`#` path alike.

#### Two independent halves, and they may deserve two issues

They share a file and nothing else, so split them if that suits your triage better.

1. **The leading-`#` bypass.** Honour `searchContext.dbLoadNeeded` on the pure-expression path too, so that both paths load what the expression said it needed. As far as we can see that is the whole fix for this half, but you are better placed to judge whether the load belongs in `performSearch` or above the branch.
2. **`revisionCount`.** Either increment unconditionally, or initialise so the guard can pass. Worth noting the counter is dead even for users who never write a `#`-leading query, so it is the half that affects more people, and it is a small change.

#### Related

Issue 5432 is open and covers a sliver of this: https://github.com/TriliumNext/Trilium/issues/5432. It is two screenshots and one sentence saying `note.noteSize` and `note.contentSize` "don't work" in Note Search on 0.90.12. It does not mention that the failure depends on the query beginning with `#`, does not mention that any other query in the same process repairs it, and does not mention `revisionCount` at all. Those are the substance of this report. It is also why 5432 may be hard to reproduce on demand: run one non-`#` query first and the symptom is gone.

One scope note so the two are not confused. `noteSize`, which 5432 also names, is a different defect: it is not a recognised property name at all, and a query using it degrades to returning the entire tree. We are reporting that separately.

As of 2026-08-20, open pull request 10633 (https://github.com/TriliumNext/Trilium/pull/10633) rewrites large parts of `search.ts`, but its hunks do not cover either region: the pure-expression branch and the `revisionCount` arithmetic both fall outside every hunk, so that pull request does not fix this.

#### Suggested labels

Our account is an outside contributor and cannot apply labels itself. Based on the vocabulary in current use: `State: Triage`, `BE`, `search`.

### TriliumNext Version

0.105.0. Built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, whose root `package.json` declares `"version": "0.105.0"`. The two files involved (`services/search/services/search.ts` and `services/search/expressions/property_comparison.ts`) are byte-identical at that commit and at tag `v0.105.0`, so the shipped release behaves the same way.

Built with `pnpm install --frozen-lockfile` then `pnpm run --filter server build` (both exit 0), producing `apps/server/dist/main.cjs` at 14,606,010 bytes, and run as `node apps/server/dist/main.cjs` on `127.0.0.1:8099` with `TRILIUM_ENV=production`. Toolchain: pnpm 11.22.0, Node v24.14.1.

### What operating system are you using?

macOS

### What is your setup?

Server access only

### Operating System Version

macOS 26.5 (build 25F71), Apple silicon. Node v24.14.1, pnpm 11.22.0. The server ran locally from the source build described above and was reached over HTTP on `127.0.0.1:8099`; no desktop client and no sync were involved. Three separate server processes were used so that the cold, warm and post-restart states could each be observed as first traffic.

### Error logs

There is nothing to attach, and that is part of the report. Every request above returned HTTP 200. No error is recorded, no warning is logged, and the response body is a well-formed empty array. The only observable signal that anything is wrong is that the same query answers differently later in the same process, which is not something a user can be expected to notice.

This finding came from running the product's published documentation against a live instance. The full transcript, including the cold-start ordering, the restart addendum and the raw probe scripts, is available on request.
