---
finding: F13
target: TriliumNext/Trilium
route: public issue
title: "Saved search: the \"Search now\" button does not run the saved search, it creates a new empty search note and shows every note in the instance"
labels: "not applied by us (outside contributor cannot self-apply); suggested in the body: State: Triage, UI, search"
status: filed
filed_url: https://github.com/TriliumNext/Trilium/issues/11130
filed_at: 2026-08-21
evidence_images: hosted at truecourse-agent/truecourse-evidence under TriliumNext/Trilium/F13/, embedded inline in the body
reverified: "2026-08-20 live re-run against a server built from source at main @ 86a9715b09b4fc523764eee3e2ba08b5f58ef12b, both the API surface and the rendered DOM re-probed in a real browser session with a real login; evidence in docs/findings/targets/trilium/live/F13/repro.md, live/F13/transcript.txt, live/F13/web-transcript.txt"
format_note: "bug_report.yml is a YAML issue form. Body uses its six `### ` section headers verbatim and in template order (Description, TriliumNext Version, What operating system are you using?, What is your setup?, Operating System Version, Error logs), with all own sub-headings demoted to `####`. Dropdown answers are real template options: `macOS` for the OS field and `Server access only` for the setup field, which is what we actually ran. No template-enforcing workflow is configured on this repo, but the form shape is matched anyway. Issue 5658 and pull request 10633 are referred to in plain words with full URLs rather than hash-number syntax. Screenshots (before and after the click) exist and should be attached to the issue at filing time, since this finding is visual."
---

# Saved search: the "Search now" button does not run the saved search, it creates a new empty search note and shows every note in the instance

### Description

**The short version: opening a saved search shows "Search has not been executed yet." with one button, `Search now`. Pressing it navigates away to a different, brand-new search note whose search string is empty, and renders every note in the instance. The only control the widget offers for running the saved search does not run the saved search.**

Before the click, the saved search renders its own message and offers exactly one control:

![Saved search before the click: search string reads #tcfindme, the body says "Search has not been executed yet." and offers a single "Search now" button](https://raw.githubusercontent.com/truecourse-agent/truecourse-evidence/main/TriliumNext/Trilium/F13/before-click.png)

After pressing `Search now`, the search string is empty and the list is the whole instance:

![After the click: the search string field is empty and showing its placeholder, and the result list shows every note in the instance](https://raw.githubusercontent.com/truecourse-agent/truecourse-evidence/main/TriliumNext/Trilium/F13/after-click.png)

The click, with the note ids left in:

```
url before click: .../#root/_hidden/_search/NpJd5jXZN9QK/fNpO06ehjjK3?ntxId=fIN8fe
url after  click: .../#root/_hidden/_search/NpJd5jXZN9QK/XKt9xVS3FQB9?ntxId=fiiXc3

note id before: fNpO06ehjjK3    (the saved search, searchString = "#tcfindme")
note id after:  XKt9xVS3FQB9    (a new note, title "Search: ", searchString = "")
```

and what each of those two notes actually answers:

```
GET /api/search-note/fNpO06ehjjK3  -> 200 ["A2nb3vnWnyi8","kn7Lw7kh0enb"]   the 2 notes you were looking for
GET /api/search-note/XKt9xVS3FQB9  -> 200 20 results                        every note in the instance
```

The rendered list after the click is the second of those: 20 notes, with the two real hits buried among `tcbox`, `New note`, `tcGeoMarker` and the rest. Nothing tells the user that the note under them changed, or that the query they saved was abandoned. A first-time user, following the only affordance on screen, ends up looking at a full-instance listing and reasonably concludes the saved search matched everything.

This is worse than having no button at all, because the result looks like an answer.

#### What the manual promises

`docs/User Guide/User Guide/Note Types/Saved Search.md`, line 2:

> Trilium allows you to save common searches as notes within the note tree. **The search results will appear as sub-notes under these "saved search" notes.**

They do not appear as sub-notes. The saved search stores zero children, and the results are produced on demand and held in memory only. That half is arguably a documentation question and is already argued upstream (see Related). The button is not: it is a control that claims to run this search and runs a different one.

#### Reproduction

Run on a server built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b` (`package.json` version 0.105.0), `TRILIUM_ENV=production`, a fresh `TRILIUM_DATA_DIR`, an empty document (no demo database). API calls carry a normal session cookie and the paired CSRF header; the browser half is a real logged-in session in Chromium.

Fixture: two notes carrying `#tcfindme`, deliberately in different subtrees, so a correct result is unambiguous. `tcHitAlpha` = `A2nb3vnWnyi8` under `tcSSBoxA`, `tcHitBeta` = `kn7Lw7kh0enb` under `tcSSBoxB`.

A saved search, with its born-empty `searchString` attribute updated in place:

```
POST /api/special-notes/search-note  -> 200  noteId=tNKub6PWBEHG  type=search  title="Search: "
born with: ["searchString=","keepCurrentHoisting=","ancestor=root"]
PUT  /api/notes/tNKub6PWBEHG/attributes  (searchString -> "#tcfindme")  -> 204
now:       ["searchString=#tcfindme","keepCurrentHoisting=","ancestor=root"]
```

One note for anyone reproducing this: the `searchString` attribute has to be **updated**, not added a second time. Adding a second `searchString` label leaves the born-empty original winning, which looks like the same bug and is not.

**Probe A, the API surface:**

```
POST /api/tree/load {"noteIds":["tNKub6PWBEHG"]}
  -> children of the saved search: 0
```

**Control A, the query is valid and the server will run it on request:**

```
GET /api/search-note/tNKub6PWBEHG
  -> 200 {"searchResultNoteIds":["A2nb3vnWnyi8","kn7Lw7kh0enb"],"highlightedTokens":["tcfindme"],"error":null}
GET /api/search/#tcfindme
  -> 200 ["A2nb3vnWnyi8","kn7Lw7kh0enb"]
POST /api/tree/load again
  -> children: 0     (the results are in memory only)
```

Exactly the right two hits, no error. Nothing is wrong with the query, the label or the search engine.

**Probe B, the DOM.** A second, freshly created saved search (`fNpO06ehjjK3`, same three attributes, same `searchString=#tcfindme`, 0 stored children), opened at `http://127.0.0.1:8099/#root/fNpO06ehjjK3`:

```
innerText of the visible .search-result-widget:
    Search has not been executed yet.
    Search now

body contains "Search has not been executed yet." -> true
body contains "tcHitAlpha"                        -> false
body contains "tcHitBeta"                         -> false
buttons inside the visible .search-result-widget: ["Search now"]
```

The note is open, its labels are on it, and the result list is a prompt with a single button.

**Control B, pressing that button.** This is the whole finding:

```
url before click: http://127.0.0.1:8099/#root/_hidden/_search/NpJd5jXZN9QK/fNpO06ehjjK3?ntxId=fIN8fe
url after  click: http://127.0.0.1:8099/#root/_hidden/_search/NpJd5jXZN9QK/XKt9xVS3FQB9?ntxId=fiiXc3
same note? false

GET /api/notes/XKt9xVS3FQB9            -> title "Search: "  type search
GET /api/notes/XKt9xVS3FQB9/attributes -> ["searchString=","keepCurrentHoisting=","ancestor=root"]   searchString EMPTY
GET /api/search-note/XKt9xVS3FQB9      -> 200, 20 results
GET /api/search-note/fNpO06ehjjK3      -> 200, ["A2nb3vnWnyi8","kn7Lw7kh0enb"]
```

Screenshots of the widget before and after the click are attached.

One capture caveat, so nothing above is over-read: Trilium restores previously opened note contexts, so several `.search-result-widget` nodes exist in the DOM after a few sessions against the same document. Exactly one is visible, and every assertion above is scoped to that visible widget. `body.innerText` excludes the hidden ones, so the "not executed" and "no hits shown" assertions are unaffected.

#### Cause

Read at `86a9715b`, and unchanged since the commit this was first found on.

**1. The widget only reports the flag, it never triggers a load.** `apps/client/src/widgets/search_result.tsx:23-34`:

```ts
function refresh() {
    if (note?.type !== "search") {
        setState(undefined);
    } else if (!note?.searchResultsLoaded) {
        setState(SearchResultState.NOT_EXECUTED);
    } else if (note.getChildNoteIds().length === 0) {
```

**2. The offered control carries no payload.** `:50-53`:

```tsx
{state === SearchResultState.NOT_EXECUTED && (
    <NoItems icon="bx bx-file-find" text={t("search_result.search_not_executed")}>
        <Button text={t("search_result.search_now")} triggerCommand="searchNotes" />
    </NoItems>
)}
```

`triggerCommand="searchNotes"` with no `searchString` and no `ancestorNoteId`, on a widget that is currently rendering a note which has both.

**3. The command creates a note rather than executing one.** `apps/client/src/components/root_command_executor.ts:37-49`:

```ts
async searchNotesCommand({ searchString, ancestorNoteId }: CommandListenerData<"searchNotes">) {
    const searchNote = await dateNoteService.createSearchNote({ searchString, ancestorNoteId });
    if (!searchNote) {
        return;
    }

    // force immediate search
    await froca.loadSearchNote(searchNote.noteId);

    const noteContext = await appContext.tabManager.openTabWithNoteWithHoisting(searchNote.noteId, {
        activate: true
    });
}
```

Both arguments arrive `undefined`, so `createSearchNote` produces a search note with an empty `searchString`, `loadSearchNote` dutifully executes that empty query, which matches everything, and `openTabWithNoteWithHoisting` navigates the user to it. Every step does exactly what it was asked; the ask was empty.

The command itself is right for the toolbar, where creating a new search is the intent. It is the wrong command for a button whose label is "Search now" inside an existing saved search.

#### Possible fixes

Either would close it, and you are better placed to choose:

1. Pass the note's own `searchString` and `ancestorNoteId` into the command from the widget, so the "create a new search" path is at least given the right query. This keeps the navigation, which is still surprising.
2. Give the widget a refresh path that executes the note it is already rendering (`GET /api/search-note/<id>` is what the rest of the client already uses, and it answers correctly, per Control A) and leaves the user where they are. This is what the button's label promises.

#### Related

Issue 5658 is open and adjacent, but it is not this: https://github.com/TriliumNext/Trilium/issues/5658. It is a feature request asking that opening a saved search should execute it automatically, and it quotes the older UI string "Search has not been executed yet. Click on "Search" button above to see the results.", referring to the **Search** button in the Search Parameters panel above the widget, which does work. It says nothing about the "Search now" button inside the result widget, and nothing about that button navigating to a different, empty search note. It covers the auto-execute half only.

As of 2026-08-20, open pull request 10633 (https://github.com/TriliumNext/Trilium/pull/10633) does modify `search_result.tsx`, but only the `GOT_RESULTS` branch and the highlighted-token types. The `NOT_EXECUTED` branch and its payload-less button are untouched, so the bug survives that pull request.

#### Suggested labels

Our account is an outside contributor and cannot apply labels itself. Based on the vocabulary in current use: `State: Triage`, `UI`, `search`.

### TriliumNext Version

0.105.0. Built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, whose root `package.json` declares `"version": "0.105.0"`. The two files involved (`apps/client/src/widgets/search_result.tsx` and `apps/client/src/components/root_command_executor.ts`) are byte-identical at that commit and at tag `v0.105.0`, so the shipped release behaves the same way.

Built with `pnpm install --frozen-lockfile` then `pnpm run --filter server build` (both exit 0), producing `apps/server/dist/main.cjs` at 14,606,010 bytes, and run as `node apps/server/dist/main.cjs` on `127.0.0.1:8099` with `TRILIUM_ENV=production`. Toolchain: pnpm 11.22.0, Node v24.14.1.

### What operating system are you using?

macOS

### What is your setup?

Server access only

### Operating System Version

macOS 26.5 (build 25F71), Apple silicon. Node v24.14.1, pnpm 11.22.0. The server ran locally from the source build described above and was reached over HTTP on `127.0.0.1:8099`; no desktop client and no sync were involved. The browser half used Chromium 141.0.7390.37 (full build, revision 1194) driven by playwright-core 1.62.1, with a real login rather than a synthetic session.

### Error logs

There is nothing to attach. No client-side exception is thrown and no server error is logged; every request in the sequence succeeds. The button's handler completes normally, creates a note, runs a query and navigates, all as designed. The failure is that the query it runs is not the one the user asked for, and the interface gives no indication that the note under them changed.

This finding came from running the product's published documentation against a live instance. The full transcript, including the API half, the untruncated page text before and after the click, and the screenshots, is available on request.
