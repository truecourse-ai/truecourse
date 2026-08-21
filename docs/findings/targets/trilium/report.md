# Hand verification of the run-layer findings — 2026-08-21

Independent re-verification of nine findings (`F6`–`F13`, `F17`) against a
**clean, freshly-seeded** TriliumNext/Trilium instance. Nothing here was taken on
trust from `findings.md`: every claim was re-probed from an empty document, every
probe has a control, and every cited `file:line` was re-read at the pinned SHA.

Subject: `3a73bc352d9cfb5ad63134e3fb997214d5846208` (verified with `git log -1`;
nothing checked out, nothing in the product source modified).

---

## Cross-reference — corpus scenarios and upstream issues/PRs

Scenario ids and failing steps are from the converged board
(`run-classification.md`); upstream states were re-checked read-only on
2026-08-21 (`gh api` / `gh search`, nothing created or commented).

| finding | corpus scenario (failing step) | upstream (TriliumNext/Trilium) |
| --- | --- | --- |
| **F7** `~=`/`~*` never lex | `fuzzy-search-tolerates-a-typo.api.1` (9) | issue [#9426](https://github.com/TriliumNext/Trilium/issues/9426) **open** · PR [#9508](https://github.com/TriliumNext/Trilium/pull/9508) open, unmerged (`Fixes #9426`) · PR [#10633](https://github.com/TriliumNext/Trilium/pull/10633) open (search overhaul, closes #9426) |
| **F8** unrecognised property → whole tree | `boolean-expressions-group-and-negate-a-search.api.1` (24) | issue [#5432](https://github.com/TriliumNext/Trilium/issues/5432) **open**, but only for `noteSize`/`contentSize`; the match-everything degradation itself is **unreported** |
| **F9** DB-backed properties dead (see §3's corrected mechanism: leading-`#` short-circuit + becca memoisation; `revisionCount` unconditionally dead) | `note-properties-are-searchable.api.1` (16) | issue [#5432](https://github.com/TriliumNext/Trilium/issues/5432) **open** (partial); the leading-`#` order-dependence and `revisionCount` are **unreported** |
| **F10** multi-word `=` is a substring compare | `the-exact-match-operator-in-quick-search.api.1` (16) | issue [#9422](https://github.com/TriliumNext/Trilium/issues/9422) **open** · PR [#10633](https://github.com/TriliumNext/Trilium/pull/10633) closes it |
| **F6** lexer strips commas inside quotes | `a-geo-map-marks-the-children-that-carry-a-geolocation.web.1` (7) | **unreported** |
| **F13** saved search never runs itself | `a-search-backed-collection-shows-notes-from-across-the-tree.web.1` (17) | issue [#5658](https://github.com/TriliumNext/Trilium/issues/5658) **open**, filed as a feature request; the broken `Search now` button (§8's DOM control) is **unreported** |
| **F11** `clone-to-branch` 500 on empty body | no board red — surfaced while authoring `note-properties-are-searchable.api.1` step 13, the corpus's only bodyless clone step | **unreported** |
| **F12** typed note without `content` 500s (§7: any type, not just `book`) | no board red — surfaced while authoring `the-read-only-label-covers-more-note-types-than-labels-md-lists.web.1` | **unreported** |
| **F17** titles never HTML-sanitised | designed red L3-6 of `a-note-title-may-be-empty-and-unbounded.web.1`, unreached on the board (G18 wall at step 8), settled by probe | **unreported** |

Adjacent, so it is not re-searched: PR
[#9963](https://github.com/TriliumNext/Trilium/pull/9963) (open, FTS5
quick-search perf; its fuzzy work split to #10005) is performance-only and fixes
none of the above.

---

## Setup

| | |
| --- | --- |
| Build under test | `apps/server/dist/main.cjs` (14,606,010 bytes, mtime 2026-08-20 19:17) — the existing build, unmodified |
| Node | v22.23.2 |
| Data directory | **fresh, empty**, `…/scratchpad/trilium-verify/data` via `TRILIUM_DATA_DIR` (confirmed as the read env var at `apps/server/src/services/data_dir.ts:18-20`) |
| Port | 18085 (verified free with `lsof` before boot) |
| Env | `TRILIUM_ENV=production TRILIUM_HOST=127.0.0.1 TRILIUM_PORT=18085 TRILIUM_DATA_DIR=<scratch>` |
| Not touched | the repo's `.truecourse/`, `reference/seed/instance-data/`, any docker resource, any other running process |

The wizard was driven exactly as `reference/seed/guard-seed.mjs` drives it:

```
POST /api/setup/new-document?skipDemoDb   {"locale":"en"}   -> 204
(poll)  GET /bootstrap  dbInitialized:true
POST /set-password  password1/password2=TriliumGuard1!      -> 302 Location: login
POST /login         password=TriliumGuard1!                 -> 302
GET  /bootstrap     -> loggedIn=true, csrfToken issued
GET  /api/options   -> newLayout = "true"   (shipped default, never written)
```

Every `/api/**` call below carries the session cookie **and** the paired
double-submit CSRF cookie + `x-csrf-token` header. The document started with
**zero** user notes; all fixtures below are ones these probes created.

One deliberate methodological addition: the server was **restarted between some
probes**, because one finding turned out to depend on becca's in-process warm
state (see F9). Restarts are called out where they matter.

---

## 1. F7 — the fuzzy operators `~=` / `~*` never lex

**VERDICT: CONFIRMED.**

### What the manual promises

`Basic Concepts and Features/Navigation/Search.md:74-85`
(note: `findings.md` cites this page as `Advanced Usage/Search.md`; at this SHA
the file lives under `Basic Concepts and Features/Navigation/` — citation drift,
content identical):

> ### Fuzzy Search
> Trilium supports fuzzy search operators that find results with typos or spelling variations:
> * `#title ~= trilim`: Fuzzy exact match - finds notes with titles like "Trilium" even if you typed "trilim" (with typo)
> * `#content ~* progra`: Fuzzy contains match …
> * Fuzzy search requires at least 3 characters in the search term
> * Maximum edit distance is 2 characters (number of character changes needed)

### Probe

Two notes, both carrying `#tcfuzzy`, with values chosen so a working fuzzy
operator must discriminate: `trilium` (edit distance 1 from the typo) and
`zebra` (distance 6, far outside the documented maximum of 2).

```
GET /api/search/#tcfuzzy ~= trilim
  -> 200  [2] TdbfRsc8igJK(tcFuzzyGood) jotk8C1crqLg(tcFuzzyOther)

GET /api/search/#tcfuzzy ~= qqqqqqq          <- matches NOTHING under any rule
  -> 200  [2] TdbfRsc8igJK(tcFuzzyGood) jotk8C1crqLg(tcFuzzyOther)

GET /api/search/#tcfuzzy ~* trilim
  -> 200  [2]
```

The second line is the decisive one and is stronger evidence than the original
finding's: `qqqqqqq` shares no character with either stored value, and both notes
still come back. The operand is not merely mis-ranked, it is **not consulted at
all** — the query has degraded to "the label exists".

### Control

```
GET /api/search/#tcfuzzy = trilium   -> 200  [1] TdbfRsc8igJK(tcFuzzyGood)
GET /api/search/#tcfuzzy = zebra     -> 200  [1] jotk8C1crqLg(tcFuzzyOther)
GET /api/search/#tcfuzzy             -> 200  [2] both
```

The label, the values and the comparator machinery are all sound; `=` splits the
two notes correctly and label-existence returns both. Only `~` fails.

### Mechanism (re-read at this SHA)

`packages/trilium-core/src/services/search/services/lex.ts:96-105` — inside the
`else if (!quotes)` branch:

```ts
if (chr === "#" || chr === "~") {
    if (!fulltextEnded) { fulltextEnded = true; } else { finishWord(i - 1); }
    currentWord = chr;
    continue;
}
```

A bare `~` unconditionally *starts a new attribute token*. It can never become
the first character of a two-character operator, so `parseLabel` never sees `~=`
or `~*` and falls through to label-existence. The comparators themselves exist
and are correct (`build_comparator.ts:59-92` implements `~=` and `~*` with
`FUZZY_SEARCH_CONFIG.MIN_FUZZY_TOKEN_LENGTH` and `fuzzyMatchWord`) — they are
simply unreachable from the query language.

### Divergence worth recording

`findings.md` (via issue #9426) says `note.title ~= Books` answers
`Unrecognized expression books`. On this build it answers **200 with `[]`**, and
`note.content ~* zzzzznotpresent` answers **200 with 25 ids including `root`**
(the whole tree). So the property-path forms fail *silently* rather than
erroring — the "degrades to a match-everything query" half of F7 is confirmed for
`note.content`, but the visible-error half is not reproducible here.

---

## 2. F8 — an unrecognised note property degrades to the whole tree

**VERDICT: CONFIRMED.**

### What the manual promises

`Basic Concepts and Features/Navigation/Search.md:130` — the manual's **own**
negation example, spelled with the singular:

```
#book AND not(note.ancestor.title = 'Tolkien')
```

while `:103` of the same page spells it plural:

> `note.ancestors.title = 'Books'`: Find notes with an ancestor named "Books".

`:108` also lists `noteSize` and `ownedAttributeCount` among the searchable
properties.

### Probe (taken on a cold server, so no prior query could have influenced it)

One note `tcPropNote` carrying `#tcprop8`, sitting under `tcbox`:

```
GET /api/search/#tcprop8 AND not(note.ancestor.title = tcbox)
  -> 200  [25] ["root","PJ7heuoTG0n0","sXcmfE9eyN8W","NvWbQJc2sqfn", … ,"_hidden"]
     contains "root"?  true
     contains "_hidden"?  true

GET /api/search/#tcprop8 note.noteSize > 50
  -> 200  [16]  contains "root"? true

GET /api/search/#tcprop8 note.ownedAttributeCount >= 1
  -> 200  [16]  contains "root"? true
```

Both the label filter and the negation vanish; the answer is every note in the
instance including `root` and `_hidden`. It is HTTP 200 with a plausible-looking
list — nothing tells the caller the query failed.

### Control

```
GET /api/search/#tcprop8                                        -> 200 ["j6n2qTN8RXtx"]
GET /api/search/#tcprop8 AND not(note.ancestors.title = tcbox)  -> 200 []
GET /api/search/#tcprop8 AND note.ancestors.title = tcbox       -> 200 ["j6n2qTN8RXtx"]
GET /api/search/#tcprop8 AND note.ancestors.title = nosuchbox   -> 200 []
GET /api/search/#tcprop8 note.labelCount >= 1                   -> 200 ["j6n2qTN8RXtx"]
GET /api/search/#tcprop8 AND not(note.type = code)              -> 200 ["j6n2qTN8RXtx"]
```

The **recognised plural spelling behaves perfectly** — the note *is* under
`tcbox`, so `not(…ancestors.title = tcbox)` correctly excludes it and the
positive form correctly includes it. `not(…)`, `AND`, and the label filter are
all fine. Adding one letter to the property name is the whole difference between
"one note" and "the entire tree".

### Mechanism (re-read at this SHA)

- `packages/trilium-core/src/services/search/expressions/property_comparison.ts:11-37` —
  `PROP_MAPPING` contains `contentsize`, `parentcount`, `labelcount`, … and
  **no** `ancestor`, **no** `ancestors`, **no** `notesize`, **no**
  `ownedattributecount`. (`findings.md` says PROP_MAPPING "knows `ancestors`" —
  it does not; `ancestors` is handled separately at `parse.ts:191`, which is why
  the plural control above works.)
- `packages/trilium-core/src/services/search/services/parse.ts:249` —
  `searchContext.addError(\`Unrecognized note property "${tokens[i].token}" …\`)`
  (`findings.md` cites `:250`).
- The error is recorded and then discarded: `routes/api/search.ts:104-115`
  (`function search`) returns `findResultsWithQuery(...).map(sr => sr.noteId)`
  and never reads `searchContext.getError()`. The sibling quick-search handler
  *does* return `error` (`:98-102`), so the plain search route drops it on the
  floor by omission.

---

## 3. F9 — the DB-backed search properties

**VERDICT: PARTIAL — the symptom reproduces exactly, the stated mechanism and
scope do not. Two separate defects, one of them previously misattributed.**

### What the manual promises

`Basic Concepts and Features/Navigation/Search.md:108` lists `contentSize`,
`noteSize` and `revisionCount` among the note properties "that can be used in
searches".

### Probe — the finding's own claim, reproduced verbatim

Fresh server, cold becca. One text note `tcSizeNote` with `#tcprop9` and 92
bytes of stored content (read back from `GET /api/notes/<id>/blob`), plus one
real revision (`POST /api/notes/<id>/revision -> 200 {"revisionId":"5PGQBTsyh1Yq"}`,
and `GET /api/notes/<id>/revisions` returns 1).

```
GET /api/search/#tcprop9 note.contentSize > 0                      -> 200 []
GET /api/search/#tcprop9 note.contentSize >= 0                     -> 200 []
GET /api/search/#tcprop9 note.contentSize < 1000000                -> 200 []
GET /api/search/#tcprop9 note.contentAndAttachmentsSize > 0        -> 200 []
GET /api/search/#tcprop9 note.contentAndAttachmentsAndRevisionsSize >= 0 -> 200 []
GET /api/search/#tcprop9 note.revisionCount >= 0                   -> 200 []
```

Identical to `findings.md`, including the decisive `>= 0` / `< 1000000` pair.

### Control 1 — becca-backed properties, same note, same query shape

```
GET /api/search/#tcprop9 note.parentCount = 1  -> 200 ["Irf0pA2Jk4Z8"]
GET /api/search/#tcprop9 note.labelCount >= 1  -> 200 ["Irf0pA2Jk4Z8"]
GET /api/search/#tcprop9 note.type = text      -> 200 ["Irf0pA2Jk4Z8"]
```

### Control 2 — the one that breaks the finding open

The same comparison, in a query that does **not begin with `#`**, on the same
cold server, immediately after the probe above:

```
GET /api/search/note.contentSize > 0 AND #tcprop9   -> 200 ["Irf0pA2Jk4Z8"]   <-- WORKS
```

and now, re-running the identical `#`-leading probe that had just answered `[]`:

```
GET /api/search/#tcprop9 note.contentSize > 0   -> 200 ["Irf0pA2Jk4Z8"]   <-- NOW WORKS
GET /api/search/#tcprop9 note.contentSize >= 0  -> 200 ["Irf0pA2Jk4Z8"]
```

Full cold-start transcript, in order, one process:

```
=== COLD becca (server just restarted) ===
PROBE    "#tcprop9 note.contentSize > 0"                 -> 200 []
PROBE    "#tcprop9 note.contentSize >= 0"                -> 200 []
PROBE    "#tcprop9 note.revisionCount >= 0"              -> 200 []
CONTROL  "#tcprop9 note.parentCount = 1"                 -> 200 ["Irf0pA2Jk4Z8"]
=== the SAME comparison, query not starting with # ===
CONTROL  "note.contentSize > 0 AND #tcprop9"             -> 200 ["Irf0pA2Jk4Z8"]
=== the # form again, same process, now warm ===
AFTER    "#tcprop9 note.contentSize > 0"                 -> 200 ["Irf0pA2Jk4Z8"]
AFTER    "#tcprop9 note.contentSize >= 0"                -> 200 ["Irf0pA2Jk4Z8"]
```

And bare, on a cold process, with no `#` anywhere:

```
GET /api/search/note.contentSize >= 0  -> 200 [25]   (every note)
GET /api/search/note.contentSize > 0   -> 200 [15]   (only the ones with content)
```

Those two answers are **correct**, which the finding's "not even `>= 0`" claim
says is impossible.

### Mechanism — the real one

`packages/trilium-core/src/services/search/services/search.ts:425-436`:

```ts
// If the query starts with '#', it's a pure expression query.
const isPureExpressionQuery = query.trim().startsWith('#');

if (isPureExpressionQuery) {
    return performSearch(expression, searchContext, searchContext.enableFuzzyMatching);
}

return findResultsWithExpression(expression, searchContext);
```

`findResultsWithExpression` (`:242-245`) is the **only** caller of
`loadNeededInfoFromDatabase()`, the function that computes `contentSize`,
`contentAndAttachmentsSize`, `contentAndAttachmentsAndRevisionsSize` and
`revisionCount` (`:117-239`). A query beginning with `#` therefore takes a path
that never honours `searchContext.dbLoadNeeded`, however diligently
`PropertyComparisonExp`'s constructor set it (`property_comparison.ts:75-77`).
The comparison then reads `undefined` off the becca note and matches nothing.

Because `loadNeededInfoFromDatabase()` writes the values **onto the becca notes**
and nothing clears them, one non-`#` query anywhere in the process fixes every
subsequent `#` query for the lifetime of that process. **The same query answers
differently depending on what was searched before it** — which is a worse defect
than the one originally reported, and it is why this had to be verified on a
freshly restarted server.

### `revisionCount` — the half that IS unconditionally dead

Cold server, note carrying one real revision:

```
PROBE    "#tcprop9 note.revisionCount >= 1"        -> 200 []
PROBE    "#tcprop9 note.revisionCount = 1"         -> 200 []
PROBE    "#tcprop9 note.revisionCount = 0"         -> 200 ["Irf0pA2Jk4Z8"]
PROBE    "note.revisionCount >= 1 AND #tcprop9"    -> 200 []       <- no leading #, still dead
CONTROL  "note.revisionCount = 0 AND #tcprop9"     -> 200 ["Irf0pA2Jk4Z8"]
GET /api/notes/<id>/revisions                      -> 1 revision
```

`revisionCount` reads `0` on a note that has one revision, on **both** query
paths. `findings.md`'s arithmetic explanation is exactly right and is re-verified
here: `search.ts:149` sets `revisionCount = 0`, and `:231-232` increments only
`if (noteRevision && noteRevision.revisionCount)` — a falsy `0` never increments.

### Also corrected

`findings.md` attributes `#tcp note.contentSize > 0 orderBy note.title -> []` to
"progressive search skipped". That is wrong; `orderBy` is innocent. Cold server:

```
PROBE    "#tcprop9 note.contentSize > 0 orderBy note.title"      -> 200 []
CONTROL  "note.contentSize > 0 AND #tcprop9 orderBy note.title"  -> 200 ["Irf0pA2Jk4Z8"]
```

Same `orderBy`, opposite answers — the leading `#` is the whole story.
(`loadNeededInfoFromDatabase()` runs at `:243`, *before* the `orderBy` branch at
`:248`, so `orderBy` could never have been the cause.)

### Corrected statement of F9

1. **Leading-`#` bypass** (`search.ts:425-433`) — the three size properties answer
   nothing in any query whose trimmed text starts with `#`, and answer correctly
   otherwise; and once any non-`#` query has run in that process, the `#` form
   starts working too. Order-dependent search results.
2. **`revisionCount` is dead everywhere** (`search.ts:149`, `:231-232`) —
   always `0`, on every path, regardless of how many revisions exist.

---

## 4. F10 — multi-word `=` in quick search is a substring compare

**VERDICT: CONFIRMED.**

### What the manual promises

`Basic Concepts and Features/Navigation/Quick search.md`:

> `:75` — `=Project Plan` - Finds notes with title exactly "Project Plan" or content exactly "Project Plan"
> `:76` — `='hello world'` - Use quotes for multi-word exact matches
> `:83` — `=example` | Finds only notes where the title equals "example" or content equals "example" exactly
> `:89` — The search performs an exact match on note titles

### Probe

Two notes: `Tchello17 world` and `Tchello17 world extra`.

```
GET /api/quick-search/=Tchello17 world
  -> 200  [2] TamdK4mg4xwf(Tchello17 world)  2pFRfSA1RB0n(Tchello17 world extra)
```

The longer title matches a query the manual calls an exact match.

### Control

```
(a) the SINGLE-word form really is an exact word match:
    notes "Tcsolo17" and "Tcsolo17extra" both exist
    GET /api/quick-search/=Tcsolo17   -> 200  [1] NzxcCNcn2DwL(Tcsolo17)

(b) the plain, non-"=" search matches both, as it should:
    GET /api/quick-search/Tchello17 world -> 200 [2] both
```

Control (a) is the point: the `=` operator, the quick-search route and the note
titles are all fine — one word behaves exactly as documented. Adding a space
silently changes the semantics from "equals" to "contains".

### Mechanism (re-read at this SHA)

`packages/trilium-core/src/services/search/services/build_comparator.ts:15-32`:

```ts
"=": (comparedValue) => (val) => {
    …
    // If comparedValue has spaces, it's a multi-word phrase
    // Check for substring match (consecutive phrase)
    if (normalizedCompared.includes(" ")) {
        return normalizedVal.includes(normalizedCompared);      // :26-28
    }
    // For single word, split into words and check for exact word match
    const words = normalizedVal.split(/\s+/);
    return words.some(word => word === normalizedCompared);
},
```

Confirmed verbatim, including the comment that states the intent.

---

## 5. F6 — the search lexer strips commas even inside quotes

**VERDICT: CONFIRMED.**

### What the manual promises

`Collections/Geo Map.md:72-74`:

> The location of a marker is stored in the `#geolocation` attribute of the child notes:
> This value can be added manually if needed. **The value of the attribute is made up of the latitude and longitude separated by a comma.**

and `:157`, instructing the user to author precisely the form that fails:

> Then paste the value inside the text box into the `#geolocation` attribute of a child note of the map (**don't forget to surround the value with a `"` character**).

### Probe

A note carrying `#geolocation="48.8583,2.2945"`, with the stored value read back
first to rule out a write problem:

```
GET /api/notes/<id>/attributes
  -> stored value: ["48.8583,2.2945"]        <- the comma IS in the store

GET /api/search/#geolocation="48.8583,2.2945"   -> 200  []
GET /api/search/#geolocation=48.8583,2.2945     -> 200  []
GET /api/search/#geolocation='48.8583,2.2945'   -> 200  []
```

All three quoting forms — including the one the manual explicitly instructs —
answer 200 with an empty list. No error, no warning.

### Control

```
GET /api/search/#geolocation           -> 200  [1] lIqEb77Rv84r(tcGeoMarker)   the label exists
GET /api/search/#tcnocomma="48.8583"   -> 200  [1] AvQXAJU5XYPo               same shape, no comma
GET /api/search/#geolocation *=* 48.8583 -> 200 [1] lIqEb77Rv84r              substring reaches it
```

The label exists, an identically-shaped quoted equality on a **comma-free** value
matches, and a substring operator can still see the note. It is the comma, not
the attribute, not the quoting, not the route.

(`findings.md` probes `#geolocation *= 48.8583` and gets `[]`. That is not a
comma effect: `*=` is **ends-with** at `build_comparator.ts:55`, so `[]` is the
right answer there. `*=*` — contains — is the operator that reaches it, as shown
above. The finding's conclusion is unaffected; the probe was mislabelled.)

### The undocumented escape hatch, verified

```
GET /api/search/#geolocation="48.8583\,2.2945"  -> 200  [1] lIqEb77Rv84r
```

A backslash-escaped comma does match — exactly as `findings.md` predicted from
`lex.ts:60-68`. Nothing in the geo-map pages, or anywhere in the manual's search
documentation, mentions escaping.

### Mechanism (re-read at this SHA)

`packages/trilium-core/src/services/search/services/lex.ts`:

- `:15-16` — `,` is declared an operator character:
  `return ["=", "*", ">", "<", "!", "-", "+", "%", ","].includes(chr);`
- `:91` opens `} else if (!quotes) {`, and that block **closes at `:123`**.
- `:125-127`, *after* the close, therefore running in every lexer state,
  quoted included:
  ```ts
  if (chr === ",") {
      continue;
  }
  ```

The lexed operand for `"48.8583,2.2945"` is `48.85832.2945`, which equals nothing
that was ever stored.

---

## 6. F13 — a saved search does not execute itself

**VERDICT: CONFIRMED — on both the API surface and, with a real browser, the DOM.
Verified fully; no partial-verification caveat needed.**

### What the manual promises

`Note Types/Saved Search.md:2`:

> Trilium allows you to save common searches as notes within the note tree. **The search results will appear as sub-notes under these "saved search" notes.**

### Probe A — the API surface

Two notes carrying `#tcfindme`, deliberately in different subtrees
(`tcHitAlpha` under `tcSSBoxA`, `tcHitBeta` under `tcSSBoxB`). A saved search
created the way the corpus creates one, with its born-empty `searchString`
attribute **updated in place** (a first attempt that *added* a second
`searchString` label showed the empty original wins — recorded so it is not
re-discovered):

```
POST /api/special-notes/search-note  -> 200  noteId=d0s8l7o7eYqA type=search title="Search: "
born with: ["searchString=","keepCurrentHoisting=","ancestor=root"]
PUT  /api/notes/<sn>/attributes (searchString -> "#tcfindme")  -> 204
now:       ["searchString=#tcfindme","keepCurrentHoisting=","ancestor=root","viewType=list"]

POST /api/tree/load  -> children of the saved search: 0
```

Zero sub-notes. The manual's "the search results will appear as sub-notes" is not
what is stored.

### Control A — the query is valid and the server can run it on demand

```
GET /api/search-note/<sn>  -> 200 ["EkRyNr4DeIH3","JOwqnLDi3yXU"]
GET /api/search/#tcfindme  -> 200 ["EkRyNr4DeIH3","JOwqnLDi3yXU"]
POST /api/tree/load again  -> children: 0   (results are in-memory only)
```

The two hits are exactly right. So nothing is wrong with the query, the label or
the search engine — the results simply never materialise, and the client must ask
for them.

### Probe B — the DOM (Playwright, headless Chromium, real login)

Opened `http://127.0.0.1:18085/#root/<sn>`. Full `body.innerText`, untruncated
(978 chars — the whole page fits, so nothing is a truncation artifact):

```
… tcSavedSearch
+
 Search Parameters
Add search option: …
Search string:
Ancestor  depth: …
Search
Search & Execute actions
Save to note
Search has not been executed yet.
Search now
Nothing to show for this note
…

contains "Search has not been executed yet."  -> true
contains "tcHitAlpha"                          -> false
contains "tcHitBeta"                           -> false
buttons inside .search-result-widget: ["Search now"]
```

The note is open, its four labels are on it, and the result list is a prompt.

### Control B — pressing "Search now" runs a *different* search

```
url before click: …/#root/_hidden/_search/njisp3KkGX8E/d0s8l7o7eYqA?ntxId=B28hAt
url after  click: …/#root/_hidden/_search/njisp3KkGX8E/AGR89wJRYmVx?ntxId=3dT6ZI
same note? false
```

The click navigates to a **brand-new, different note id**, titled `Search:`
(empty), carrying 3 attributes rather than 4, whose result list is
`23 notes` — every note in the instance, i.e. the empty query — not
`#tcfindme`'s two hits. `tcHitAlpha` appears only as one of the 23.

This is the sharpest possible confirmation of the `interfaces-notes.md` §D14
half of the finding: the only control offered for running the saved search does
not run the saved search.

### Mechanism (re-read at this SHA)

- `apps/client/src/widgets/search_result.tsx:26-27` —
  `} else if (!note?.searchResultsLoaded) { setState(SearchResultState.NOT_EXECUTED); }`
  Nothing in the widget triggers a load; it only *reports* the flag.
- `:51` — the string, `t("search_result.search_not_executed")` →
  `apps/client/src/translations/en/translation.json:2699` —
  `"search_not_executed": "Search has not been executed yet."`
- `:52` — `<Button text={t("search_result.search_now")} triggerCommand="searchNotes" />`
  — **no payload**, so `searchString` and `ancestorNoteId` are both `undefined`.
- `apps/client/src/components/root_command_executor.ts:36-48` (note: `findings.md`
  cites `services/root_command_executor.ts:37-49`; the file is under
  `components/`) —
  ```ts
  async searchNotesCommand({ searchString, ancestorNoteId }) {
      const searchNote = await dateNoteService.createSearchNote({ searchString, ancestorNoteId });
      …
      await froca.loadSearchNote(searchNote.noteId);
      … openTabWithNoteWithHoisting(searchNote.noteId, { activate: true });
  }
  ```
  It **creates** a search note. It never executes the one you are looking at.

---

## 7. F11 — `clone-to-branch` 500s on an empty body

**VERDICT: CONFIRMED.**

### Probe

```
PUT /api/notes/qyh2NVbLhIsw/clone-to-branch/root_IXzLd7htCuWH      (no body at all)
  -> 500  {"message":"Cannot destructure property 'prefix' of 'e.body' as it is undefined."}
```

An internal error where a 400 belongs, and the message leaks the bundler's
minified variable name (`e.body`) to the caller.

### Control

```
PUT /api/notes/qyh2NVbLhIsw/clone-to-branch/root_IXzLd7htCuWH      {"prefix": null}
  -> 200  {"success":true,"branchId":"IXzLd7htCuWH_qyh2NVbLhIsw","notePath":"root/IXzLd7htCuWH/qyh2NVbLhIsw"}
```

Same note, same branch, same session — only the body differs.

### Mechanism (re-read at this SHA)

`packages/trilium-core/src/routes/api/cloning.ts:5-9`:

```ts
function cloneNoteToBranch(req: Request<{ noteId: string; parentBranchId: string }>) {
    const { noteId, parentBranchId } = req.params;
    const { prefix } = req.body;
    return cloningService.cloneNoteToBranch(noteId, parentBranchId, prefix);
}
```

Unguarded destructuring; `express.json()` leaves `req.body` undefined when no
JSON body is sent. The sibling `cloneNoteToParentNote` (`:12-16`) has the same
shape. The contrast with `undeleteNote`
(`routes/api/notes.ts:213` — `const { fallbackParentNoteId } = req.body ?? {};`)
shows the codebase already knows the guard.

---

## 8. F12 — creating a note without `content` 500s

**VERDICT: CONFIRMED, and larger than stated — it is not specific to `book`.**

### Probe

```
POST /api/notes/root/children   {"title":"tcprobebook","type":"book"}
  -> 500  {"message":"Note content must be set"}
```

### Control

```
POST /api/notes/root/children   {"title":"tcprobebook-control","type":"book","content":""}
  -> 200  {"note":{"noteId":"bSBRkXkaXfHh","title":"tcprobebook-control","type":"book", …}}
```

An empty string is accepted; omitting the key is a 500.

### Generalisation this verification adds

```
POST /api/notes/root/children   {"title":"tcprobetext","type":"text"}
  -> 500  {"message":"Note content must be set"}
```

A plain **text** note without `content` 500s identically. `findings.md` frames
F12 as a `book`-type defect; it is a defect of `createNewNote` for every type.

### Mechanism (re-read at this SHA)

`packages/trilium-core/src/services/notes.ts:223-236`:

```ts
function createNewNote(params: NoteParams) {
    const parentNote = getAndValidateParent(params);
    if (params.title === null || params.title === undefined) {
        params.title = getNewNoteTitle(parentNote);
    }
    if (params.content === null || params.content === undefined) {
        throw new Error(`Note content must be set`);     // :233-235
    }
```

A bare `Error`, not a `ValidationError`, which is why it surfaces as 500 rather
than 400 — and note the line directly above it: a **missing title** is defaulted,
a missing content is fatal. The asymmetry is the bug's shape.

---

## 9. F17 — note titles are never HTML-sanitised

**VERDICT: CONFIRMED on both paths.**

### What the manual promises

`Basic Concepts and Features/Notes/Title.md:23`:

> Titles may contain any characters, including Unicode and emoji. **For security, any HTML in the title is stripped automatically, so the title is always treated as plain text.**

### Probe 1 — the creation path

```
POST /api/notes/root/children  {"title":"<b>bold</b> <script>x</script> plain","type":"text","content":"body"}
  -> 200
  response title:                    "<b>bold</b> <script>x</script> plain"
  GET /api/notes/<id> stored title:  "<b>bold</b> <script>x</script> plain"
```

### Probe 2 — the rename path

```
PUT /api/notes/<id>/title  {"title":"<b>bold</b> <script>x</script> plain"}
  -> 200
  GET /api/notes/<id> stored title:  "<b>bold</b> <script>x</script> plain"
  POST /api/tree/load titles:        ["<b>bold</b> <script>x</script> plain",
                                      "<b>bold</b> <script>x</script> plain"]
```

Byte-for-byte verbatim, read back from two independent endpoints.

### Control — the one path that DOES sanitise

A parent labelled `#titleTemplate="<b>bold</b> <script>x</script> plain"`, then a
child created with **no `title` key at all**, so the title is derived:

```
POST /api/notes/<tmplParent>/children  {"type":"text","content":""}
  -> 200
  derived title: "<b>bold</b> x plain"
```

`<script>x</script>` is stripped to `x`. This is decisive: `sanitizeHtml` is
present, wired up and working — it just sits on the one path a user's typed title
never takes. (It also shows the doc's "any HTML … is stripped" is imprecise even
here: `<b>` survives sanitisation.)

### Mechanism (re-read at this SHA)

- `packages/trilium-core/src/services/notes.ts:163` —
  `function getNewNoteTitle(parentNote: BNote)`, the `#titleTemplate` **deriver**.
- `:183-185` — its comment and its one call:
  ```ts
  // this isn't in theory a good place to sanitize title, but this will catch a lot of XSS attempts.
  title = sanitizeHtml(title);
  ```
- `:227-229` — `createNewNote` calls `getNewNoteTitle` **only** when
  `params.title` is null/undefined. A supplied title bypasses it entirely.
- `packages/trilium-core/src/routes/api/notes.ts:269-291` — `changeTitle`
  assigns `note.title = title;` (`:285`) raw and saves.

`sanitizeHtml` appears exactly once on this path, and it is on the branch a user
can never reach by typing.

### Corroboration from the browser probe

The Playwright run above rendered these notes in the tree as the literal text
`<b>bold</b> <script>x</script> plain` — so the tree escapes on render and this
is not a live XSS in the tree, matching `findings.md`. The stored value is
nonetheless unsanitised, and the documented behaviour does not happen.

---

## Teardown

Created by this verification, and now gone:

| What | Where | State |
| --- | --- | --- |
| 3 `node apps/server/dist/main.cjs` processes (pids 2253, 38370, 42290 — restarted twice, deliberately, for cold-becca probes) | port 18085 | **killed** |
| 1 headless Chromium (Playwright) | — | closed by the script (`browser.close()`), verified no survivors |
| Trilium data directory (`document.db`, `-wal`, backups, logs) | `<scratch>/trilium-verify/data` | **deleted** |
| Probe scripts, transcripts, one screenshot | `<scratch>/trilium-verify/` | **deleted** |

Verification commands and their output are in the closing section of the session.
`lsof -nP -iTCP:18085` returns nothing; `ps` shows no `main.cjs` and no
`playwright`/`chromium` process from this session; the scratch directory does not
exist.

**Not touched at any point:** the repo's `.truecourse/` store,
`reference/seed/instance-data/`, any `tc-*` or `caldiy*` docker project, any
running container, and any file under the Trilium product source. The only file
written inside the repo is this report.

---

## Summary

| # | Finding | Verdict |
| --- | --- | --- |
| F6 | comma-bearing label values unsearchable | **CONFIRMED** |
| F7 | `~=` / `~*` never lex; degrade to label-exists | **CONFIRMED** |
| F8 | unrecognised property returns the whole tree | **CONFIRMED** |
| F9 | DB-backed properties answer nothing | **PARTIAL** — symptom exact, mechanism and scope corrected (leading-`#` bypass + `revisionCount` dead by arithmetic) |
| F10 | multi-word `=` is a substring compare | **CONFIRMED** |
| F11 | `clone-to-branch` 500s on an empty body | **CONFIRMED** |
| F12 | note without `content` 500s | **CONFIRMED**, and not `book`-specific |
| F13 | saved search does not execute itself | **CONFIRMED** (API + DOM) |
| F17 | note titles never HTML-sanitised | **CONFIRMED** |

Corrections `findings.md` should absorb:

1. **F9 is two findings, and one of them is order-dependent.** `search.ts:425-433`
   short-circuits every `#`-leading query past the only caller of
   `loadNeededInfoFromDatabase()`. Not-`#` queries work; and once one has run,
   the `#` form works too, for the life of the process. `revisionCount` is
   separately and unconditionally dead. The `orderBy` / "progressive search
   skipped" attribution is wrong.
2. **F12 is not about `book`.** Any note type created without `content` 500s.
3. **PROP_MAPPING does not contain `ancestors`** — `parse.ts:191` handles it.
4. **F6's `*=` probe was mislabelled** — `*=` is ends-with; `*=*` does reach the
   note. The finding stands regardless.
5. **Citation paths**: the search manual is at
   `Basic Concepts and Features/Navigation/Search.md`, not `Advanced Usage/`;
   `root_command_executor.ts` is under `components/`, not `services/`;
   `parse.ts`'s unrecognised-property error is at `:249`, not `:250`.
6. **F7's error message does not appear on this build** — the property-path forms
   (`note.title ~= x`) answer `200 []` silently rather than
   `Unrecognized expression`.
