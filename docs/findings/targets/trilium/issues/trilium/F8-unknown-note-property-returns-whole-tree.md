---
finding: F8
target: TriliumNext/Trilium
route: public issue
title: "Search: the \"Unrecognized note property\" error is produced and then discarded, so the query silently returns every note including root and _hidden"
labels: "not applied by us (outside contributor cannot self-apply); suggested in the body: State: Triage, BE"
status: filed
filed_url: https://github.com/TriliumNext/Trilium/issues/11116
filed_at: 2026-08-20
reverified: "2026-08-20 live re-run against a server built from source at main @ 86a9715b09b4fc523764eee3e2ba08b5f58ef12b, all probes and controls re-executed on a cold process; evidence in docs/findings/targets/trilium/live/F8/repro.md and live/F8/transcript.txt"
format_note: "bug_report.yml is a YAML issue form. Body uses its six `### ` section headers verbatim and in template order (Description, TriliumNext Version, What operating system are you using?, What is your setup?, Operating System Version, Error logs), with all own sub-headings demoted to `####`. Dropdown answers are real template options: `macOS` for the OS field and `Server access only` for the setup field, which is what we actually ran. No template-enforcing workflow is configured on this repo, but the form shape is matched anyway."
---

# Search: the "Unrecognized note property" error is produced and then discarded, so the query silently returns every note including root and _hidden

### Description

**The short version: Trilium already detects this and already has the right error message. `GET /api/search/:searchString` never reads it, and the failed expression is dropped instead of failing the query, so the caller gets the entire tree back with HTTP 200.**

The same query, on the same live instance, on the two sibling handlers in the same route file:

```
GET /api/quick-search/#tcprop8 AND not(note.ancestor.title = tcbox)
  -> 200
     error: "Unrecognized note property \"ancestor\" in \"...cprop8 AND not(note.ancestor.title = tcbox)\""

GET /api/search/#tcprop8 AND not(note.ancestor.title = tcbox)
  -> 200
     ["root","uI5TTDlvedxt","nLQUhHGGu1BH","obb2wKi47mqT","4weUGTNJRtdH","l65BjI6IhuYL",
      "gP4nDim7wyWo","Tls839FIYtrV","gmKHJ8TiN1St","ZWB3896n0unt","lrJ6QQydNiyq",
      "h5QNPC6UWkAG","A2nb3vnWnyi8","kn7Lw7kh0enb","w898k2aBwuDl","_hidden"]
```

That is all 16 notes in the instance, `root` and `_hidden` included, in answer to a query that asked for one labelled note. So this is not a request to add an error. The error exists, it is accurate, and one handler in `routes/api/search.ts` returns it while the handler right below it does not.

The second half of the problem is that a malformed expression does not fail the query, it disappears from it. The `#tcprop8` label filter was parsed successfully and is thrown away along with the bad property, and what is left matches everything. A `not(...)` filter that silently inverts into match-everything is the worst possible failure mode for a saved search or a script.

#### What the manual promises

The three property names below are all named by the User Guide, and none of them is recognised.

`docs/User Guide/User Guide/Basic Concepts and Features/Navigation/Search.md`, line 130, in the **Negation** section. This is the manual's own worked example, spelled in the singular:

> ```
> #book AND not(note.ancestor.title = 'Tolkien')
> ```
>
> This query finds all book notes not in the "Tolkien" subtree.

Line 103 of the same page spells it in the plural, which is the form that actually works:

> `note.ancestors.title = 'Books'`: Find notes with an ancestor named "Books".

Line 108 lists the searchable note properties, and includes two more that are not recognised either:

> Notes have properties that can be used in searches, such as `noteId`, `dateModified`, `dateCreated`, `isProtected`, `type`, `title`, `text`, `content`, `rawContent`, `ownedLabelCount`, `labelCount`, `ownedRelationCount`, `relationCount`, `ownedRelationCountIncludingLinks`, `relationCountIncludingLinks`, `ownedAttributeCount`, `attributeCount`, `targetRelationCount`, `targetRelationCountIncludingLinks`, `parentCount`, `childrenCount`, `isArchived`, `contentSize`, `noteSize`, and `revisionCount`.

A user who copies the manual's negation example gets the whole tree back and is never told why.

#### Reproduction

Run on a server built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b` (`package.json` version 0.105.0), `TRILIUM_ENV=production`, a fresh `TRILIUM_DATA_DIR`, and an empty document (no demo database). Every request below carries a normal session cookie and the paired CSRF header. The probes were taken on a **cold process**, the first search traffic that process ever saw, so no earlier query could have warmed anything.

1. Create a note titled `tcbox` under `root`. In the run below it is `h5QNPC6UWkAG`.
2. Create a note titled `tcPropNote` **under** `tcbox` and give it the label `#tcprop8`. In the run below it is `w898k2aBwuDl`.
3. Issue the manual's negation example against that label.

The note is inside `tcbox`, so the correct answer to `not(... = tcbox)` is the empty list.

```
GET /api/search/#tcprop8 AND not(note.ancestor.title = tcbox)
  -> 200  16 ids   contains "root"? true   contains "_hidden"? true

GET /api/search/#tcprop8 note.noteSize > 50
  -> 200  16 ids   contains "root"? true   contains "_hidden"? true

GET /api/search/#tcprop8 note.ownedAttributeCount >= 1
  -> 200  16 ids   contains "root"? true   contains "_hidden"? true
```

All three return the identical 16-id list, which is every note in the instance.

#### Control: one letter is the whole difference

Same process, same fixture, same request shape, run immediately after the probes:

```
GET /api/search/#tcprop8                                        -> 200 ["w898k2aBwuDl"]
GET /api/search/#tcprop8 AND not(note.ancestors.title = tcbox)  -> 200 []
GET /api/search/#tcprop8 AND note.ancestors.title = tcbox       -> 200 ["w898k2aBwuDl"]
GET /api/search/#tcprop8 AND note.ancestors.title = nosuchbox   -> 200 []
GET /api/search/#tcprop8 note.labelCount >= 1                   -> 200 ["w898k2aBwuDl"]
GET /api/search/#tcprop8 AND not(note.type = code)              -> 200 ["w898k2aBwuDl"]
```

The recognised plural spelling behaves perfectly in both directions: the note **is** under `tcbox`, so the negation correctly excludes it and the positive form correctly includes it. `not(...)`, `AND` and the label filter are all sound. Adding one letter to the property name is the entire difference between one note and the whole tree.

#### Cause

Read at `86a9715b`, and unchanged since the commit this was originally found on.

**1. The three property names really are unrecognised.** `packages/trilium-core/src/services/search/expressions/property_comparison.ts`, `PROP_MAPPING` at lines 11 to 37, contains `contentsize`, `parentcount`, `labelcount` and the rest, but has no `ancestor`, no `notesize` and no `ownedattributecount`. It has no `ancestors` either; the plural is handled separately by the parser at `parse.ts:191`, which is why the control above works.

**2. The parser detects it, records it, and returns nothing.** `packages/trilium-core/src/services/search/services/parse.ts:249`:

```ts
searchContext.addError(`Unrecognized note property "${tokens[i].token}" in ${context(i)}`);
```

`parseNoteProperty()` then falls off the end and returns `undefined`.

**3. The undefined sub-expression takes the rest of the query with it.** In `getExpression`, both the `note` branch and the `not` branch bail out entirely on a falsy sub-expression:

```ts
} else if (token === "note") {
    i++;
    const expression = parseNoteProperty();
    if (!expression) {
        return;
    }
```

so `getExpression` returns `undefined` and the already-parsed `#tcprop8` filter, which is sitting in the local `expressions` array, is discarded with it.

**4. What is left matches everything.** `parse()` passes that `undefined` into `AndExp.of([...])`, and `expressions/and.ts:11` filters falsy entries out:

```ts
const subExpressions = _subExpressions.filter((exp) => !!exp) as Expression[];
```

with `and.ts:19` returning `new TrueExp()` when nothing survives, and `expressions/true.ts` returning its input note set unchanged. Match-everything is the documented behaviour of that fallback; it is just never meant to be reached this way.

**5. The route drops the error on the floor.** `packages/trilium-core/src/routes/api/search.ts`. `quickSearch` (lines 55 to 103) ends with

```ts
return {
    searchResultNoteIds: resultNoteIds,
    searchResults,
    error: searchContext.getError()
};
```

while `search` (lines 105 to 116), the handler behind `GET /api/search/:searchString` (`routes/index.ts:236`), ends with

```ts
return searchService.findResultsWithQuery(searchString, searchContext).map((sr) => sr.noteId);
```

and never calls `searchContext.getError()`. The two handlers are eleven lines apart in the same file. That single omission is why the error observed above on the quick-search route is invisible on this one.

#### Two independent halves, either of which is worth fixing on its own

1. **The names.** `note.ancestor` (the manual's own negation example), `note.noteSize` and `note.ownedAttributeCount` are documented but absent from `PROP_MAPPING`. Either add them or correct the manual, and note that line 130 and line 103 of the same page currently disagree with each other.
2. **The silence, which is the more serious one.** Even with the names fixed, any future typo behaves the same way: recorded error, discarded expression, whole tree returned, HTTP 200. Having `search` return `searchContext.getError()` the way `quickSearch` already does would close it, and an unparseable expression arguably ought to yield no results rather than all of them.

#### Related

Issue 5432 is open and adjacent, but it is not this: https://github.com/TriliumNext/Trilium/issues/5432. It is two screenshots and one sentence reporting that `note.noteSize` and `note.contentSize` "don't work" in Note Search on 0.90.12. It describes **empty** results, and says nothing about `note.ancestor`, nothing about the match-everything degradation, and nothing about the error being recorded and then discarded. It covers a sliver of this at most, and fixing it would not fix the silent failure.

As of 2026-08-20, open pull request 10633 touches `routes/api/search.ts`, but only the `quickSearch` handler and a new details endpoint. The plain `search` handler is untouched and `property_comparison.ts` is not in that pull request at all, so it does not address this.

#### Suggested labels

Our account is an outside contributor and cannot apply labels itself. Based on the vocabulary in current use: `State: Triage`, `BE`.

### TriliumNext Version

0.105.0. Built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, whose root `package.json` declares `"version": "0.105.0"`. The three files involved (`property_comparison.ts`, `parse.ts`, `routes/api/search.ts`) are byte-identical at that commit and at tag `v0.105.0`, so the shipped release behaves the same way.

Built with `pnpm install --frozen-lockfile` then `pnpm run --filter server build` (both exit 0), producing `apps/server/dist/main.cjs` at 14,606,010 bytes, and run as `node apps/server/dist/main.cjs` on `127.0.0.1:8099` with `TRILIUM_ENV=production`. Toolchain: pnpm 11.22.0, Node v24.14.1.

### What operating system are you using?

macOS

### What is your setup?

Server access only

### Operating System Version

macOS 26.5 (build 25F71), Apple silicon. Node v24.14.1, pnpm 11.22.0. The server ran locally from the source build described above and was reached over HTTP on `127.0.0.1:8099`; no desktop client and no sync were involved.

### Error logs

There is no stack trace and no server-side error to attach, and that is the point of the report: the failure is silent by construction. The one piece of error text that exists anywhere in the system for this query is the string `parse.ts:249` records, which the sibling quick-search handler returns and the plain search handler does not:

```
GET /api/quick-search/#tcprop8 AND not(note.ancestor.title = tcbox)
  -> 200
     error: "Unrecognized note property \"ancestor\" in \"...cprop8 AND not(note.ancestor.title = tcbox)\""
```

This finding came from running the product's published documentation against a live instance. The full transcript, including the cold-start ordering and the raw probe script, is available on request.
