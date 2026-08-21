# F17 live re-run: note titles are never HTML-sanitised
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

**VERDICT: still reproduces**, on both write paths, and the sharp control still holds.

## Claim under test

Titles are stored unsanitised via both creation-with-title and `PUT /title`, while a
`#titleTemplate`-derived title comes back sanitised.

Payload throughout: `<b>bold</b> <script>x</script> plain`.

## Probe 1: the creation path

```
POST /api/notes/root/children?target=into
  {"title":"<b>bold</b> <script>x</script> plain","type":"text","content":"body"}
  -> 200
  response title:                          "<b>bold</b> <script>x</script> plain"
  GET /api/notes/Nn7rzq5UdXSR stored title: "<b>bold</b> <script>x</script> plain"
```

## Probe 2: the rename path

```
PUT /api/notes/Vy4UPnvc78nD/title  {"title":"<b>bold</b> <script>x</script> plain"}  -> 200
  GET /api/notes/Vy4UPnvc78nD stored title: "<b>bold</b> <script>x</script> plain"
  POST /api/tree/load titles: ["<b>bold</b> <script>x</script> plain",
                               "<b>bold</b> <script>x</script> plain"]
```

Byte for byte verbatim, read back from two independent endpoints.

## Control: the one path that does sanitise

A parent (`tcTmplParent` = `lrJ6QQydNiyq`) labelled
`#titleTemplate="<b>bold</b> <script>x</script> plain"`, then a child created with **no
`title` key at all**, so the title is derived:

```
POST /api/notes/lrJ6QQydNiyq/children?target=into  {"type":"text","content":""}
  -> 200
  derived title: "<b>bold</b> x plain"
```

`<script>x</script>` is stripped to `x`. This is the decisive half: `sanitizeHtml` is present,
wired up and working. It just sits on the one path a user's typed title never takes. It also
shows the doc's "any HTML in the title is stripped" is imprecise even here, since `<b>` survives
sanitisation.

## Browser corroboration: how the unsanitised title renders

The same document opened in Chromium and inspected in the DOM:

```json
{
  "literalTextNodesFound": 4,
  "sampleOuterHTML": [
    "<span class=\"fancytree-title\" tabindex=\"0\">&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x&lt;/script&gt; plain</span>",
    "<span class=\"fancytree-title\" tabindex=\"0\">&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x&lt;/script&gt; plain</span>",
    "<a href=\"#root/Nn7rzq5UdXSR\" class=\"no-tooltip-preview tn-link note-book-title\">&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x&lt;/script&gt; plain</a>"
  ],
  "scriptTagsWhoseTextIsX": 0,
  "boldElementsSayingBold": 0,
  "bodyContainsLiteralPayload": true
}
```

The tree escapes on render, so this is not a live XSS in the tree, matching the
hand-verification report. The stored value is nonetheless unsanitised and the documented
behaviour ("the title is always treated as plain text" because HTML "is stripped
automatically") does not happen. Screenshot: `F17-tree-render.png`.

## Raw captures

- `transcript.txt` - the API half
- `F17-tree-render.png` - the tree rendering the literal payload
- `../F13/web-transcript.txt` - the DOM inspection, at the tail
- `../raw/03-rest.mjs`, `../raw/05-web.mjs`, `../raw/lib.mjs` - the probe scripts
