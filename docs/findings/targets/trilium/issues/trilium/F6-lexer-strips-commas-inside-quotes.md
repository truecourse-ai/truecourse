---
finding: F6
target: TriliumNext/Trilium
route: public issue
title: "Search: the lexer strips commas even inside quotes, so the documented #geolocation=\"48.8583,2.2945\" can never be matched"
labels: "not applied by us (outside contributor cannot self-apply); suggested in the body: State: Triage, BE, search"
status: filed
filed_url: https://github.com/TriliumNext/Trilium/issues/11132
filed_at: 2026-08-21
reverified: "2026-08-20 live re-run against a server built from source at main @ 86a9715b09b4fc523764eee3e2ba08b5f58ef12b, all three quoting forms, all three controls and the escape hatch re-executed, with the stored attribute value read back first; evidence in docs/findings/targets/trilium/live/F6/repro.md and live/F6/transcript.txt"
format_note: "bug_report.yml is a YAML issue form. Body uses its six `### ` section headers verbatim and in template order (Description, TriliumNext Version, What operating system are you using?, What is your setup?, Operating System Version, Error logs), with all own sub-headings demoted to `####`. Dropdown answers are real template options: `macOS` for the OS field and `Server access only` for the setup field, which is what we actually ran. No template-enforcing workflow is configured on this repo, but the form shape is matched anyway. Pull request 10633 is referred to in plain words with a full URL rather than hash-number syntax."
---

# Search: the lexer strips commas even inside quotes, so the documented #geolocation="48.8583,2.2945" can never be matched

### Description

**The short version: the search lexer discards every comma it sees, including commas inside a quoted string. The Geo Map manual tells the user to store a latitude and longitude separated by a comma and to wrap the value in quotes. That exact value is then unsearchable by equality, in every quoting form, and the query answers HTTP 200 with an empty list rather than an error.**

The stored value, read back from the attribute API first so a write problem is ruled out, and then the three ways a user might quote it:

```
GET /api/notes/l65BjI6IhuYL/attributes
  -> 200  stored geolocation value(s): ["48.8583,2.2945"]      the comma IS in the store

GET /api/search/#geolocation="48.8583,2.2945"   -> 200 []
GET /api/search/#geolocation=48.8583,2.2945     -> 200 []
GET /api/search/#geolocation='48.8583,2.2945'   -> 200 []
```

The lexed operand for `"48.8583,2.2945"` is `48.85832.2945`, which equals nothing that was ever stored, and nothing anyone would ever store.

The impact is wider than the geo map, which is only where the manual walks the user into it: **any label whose value contains a comma is unreachable by equality search.** Tags, coordinates, ranges, author lists, anything with a comma in it.

#### What the manual promises

`docs/User Guide/User Guide/Collections/Geo Map.md`, lines 73 and 75, under "How the location of the markers is stored":

> The location of a marker is stored in the `#geolocation` attribute of the child notes:
>
> This value can be added manually if needed. **The value of the attribute is made up of the latitude and longitude separated by a comma.**

and line 157, in "Adding from Google Maps", instructing the user to author precisely the form that fails:

> Then paste the value inside the text box into the `#geolocation` attribute of a child note of the map (**don't forget to surround the value with a `"` character**).

So the manual specifies the comma, specifies the quotes, and the result cannot be found by the search that the rest of the manual documents.

#### Reproduction

Run on a server built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b` (`package.json` version 0.105.0), `TRILIUM_ENV=production`, a fresh `TRILIUM_DATA_DIR`, an empty document (no demo database). Every request carries a normal session cookie and the paired CSRF header.

1. Create a note and give it `#geolocation="48.8583,2.2945"` (the Paris coordinates from the manual's own worked example). In the run below it is `l65BjI6IhuYL`.
2. Create a second note with a comma-free value in the same shape, `#tcnocomma="48.8583"`, as the control. In the run below it is `gP4nDim7wyWo`.
3. Read the stored value back, so the rest of the run is about search and not about storage.
4. Search for the value.

The probe is the three-line block above: all three quoting forms answer `200 []`.

#### Control: it is the comma, not the attribute, not the quoting, not the route

Same process, same fixture, same request shape, run immediately after the probe:

```
GET /api/search/#geolocation               -> 200 ["l65BjI6IhuYL"]   the label exists and is reachable
GET /api/search/#tcnocomma="48.8583"       -> 200 ["gP4nDim7wyWo"]   identical shape, no comma, matches
GET /api/search/#geolocation *=* 48.8583   -> 200 ["l65BjI6IhuYL"]   a contains operator still reaches the note
```

Bare label existence works. A quoted equality on a comma-free value works. A substring operator reaches the very note that equality cannot. The single variable between the working control and the failing probe is one comma inside the quotes.

#### The escape hatch, which is real and undocumented

```
GET /api/search/#geolocation="48.8583\,2.2945"  -> 200 ["l65BjI6IhuYL"]
```

A backslash-escaped comma does match, which also proves the rest of the pipeline is sound: the value is stored correctly, the comparator is correct, and only the lexing of the operand is wrong. Nothing in the geo-map pages, or anywhere in the search documentation, mentions escaping. We mention it as a workaround for anyone who lands here, not as the fix.

#### Cause

Read at `86a9715b`, and unchanged since the commit this was first found on. All of it is in `packages/trilium-core/src/services/search/services/lex.ts`.

**1. The comma is declared an operator character**, `:15-17`:

```ts
function isSymbolAnOperator(chr: string) {
    return ["=", "*", ">", "<", "!", "-", "+", "%", ","].includes(chr);
}
```

**2. The unquoted branch opens at `:91`**:

```ts
} else if (!quotes) {
```

**and closes at `:123`.**

**3. The comma is discarded at `:125-127`, after that close**, so it runs in every lexer state, quoted included:

```ts
if (chr === ",") {
    continue;
}

currentWord += chr;
```

That is the whole defect: three lines that belong inside the `!quotes` branch and sit just below it. Everything above them handles quoting correctly, which is why the quoted string survives intact except for its commas.

A fix that keeps the current unquoted behaviour would be to move the `continue` inside the `!quotes` block, or to guard it with `!quotes`. We have not opened a pull request because there may be a reason the comma is stripped this late that is not visible from outside; if a patch would be welcome, say so and we will send one with a test.

#### Related

We could not find an existing issue for this. Searches over the tracker for comma and geolocation, and for comma and attribute values, returned nothing, and a sweep of every issue created since 2026-08-01 contains nothing related.

As of 2026-08-20, open pull request 10633 (https://github.com/TriliumNext/Trilium/pull/10633) does patch `lex.ts`, with a single hunk around `:93-105` that adds two-character fuzzy-operator handling. It does not touch the comma line, so that pull request does not fix this.

#### Suggested labels

Our account is an outside contributor and cannot apply labels itself. Based on the vocabulary in current use: `State: Triage`, `BE`, `search`.

### TriliumNext Version

0.105.0. Built from source at `main` @ `86a9715b09b4fc523764eee3e2ba08b5f58ef12b`, whose root `package.json` declares `"version": "0.105.0"`. The file involved (`packages/trilium-core/src/services/search/services/lex.ts`) is byte-identical at that commit and at tag `v0.105.0`, so the shipped release behaves the same way.

Built with `pnpm install --frozen-lockfile` then `pnpm run --filter server build` (both exit 0), producing `apps/server/dist/main.cjs` at 14,606,010 bytes, and run as `node apps/server/dist/main.cjs` on `127.0.0.1:8099` with `TRILIUM_ENV=production`. Toolchain: pnpm 11.22.0, Node v24.14.1.

### What operating system are you using?

macOS

### What is your setup?

Server access only

### Operating System Version

macOS 26.5 (build 25F71), Apple silicon. Node v24.14.1, pnpm 11.22.0. The server ran locally from the source build described above and was reached over HTTP on `127.0.0.1:8099`; no desktop client and no sync were involved.

### Error logs

There is nothing to attach. All three failing queries return HTTP 200 with a well-formed empty array. No parse error is raised, no warning is logged, and the user is told only that their note does not exist, which is not true. A lexer that silently rewrites the operand it was given is the one place where a visible error would have made this a five-minute discovery rather than a puzzle.

This finding came from running the product's published documentation against a live instance. The full transcript, including the attribute read-back and the raw probe script, is available on request.
