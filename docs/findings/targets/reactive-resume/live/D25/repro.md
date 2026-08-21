# D25 — the Template section shows one preview; the gallery is undocumented

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quotes**, `docs/guides/choosing-a-template.mdx`:

> `:27` — In the right sidebar, find and click on the **Template** section to expand it.
>
> `:36` — Browse through the available templates and click on the one you want to use. Your resume will instantly update to reflect the new design.

## Probe and control

```
=== D25 · PROBE: the Template SECTION (#sidebar-template), verbatim ===
- heading "Toggle Template section" [level=3]:
  - button "Toggle Template section" [expanded]:
    - img
- img
- heading "Template" [level=2]
- region "Toggle Template section":
  - button "Azurill":
    - img "Azurill"
    - img
  - heading "Azurill" [level=3]
  - paragraph: Two-column with a bold colored sidebar and skill bars; great for creative or tech roles where visual flair is welcome.
  - text: Two-column Creative Tech Visual flair

imgs in the Template SECTION                       1
  of which carry a name (alt)                      1
  the named one(s)                                 ["Azurill"]
section: getByRole('img', {name: 'Chikorita'})     0
section text mentions "gallery"                    no
whole page, imgs named Chikorita (gallery closed)  0

=== D25 · CONTROL: the gallery is real, and it is a MODAL ===
dialog heading                                 Template Gallery
CONTROL inside the gallery: img 'Chikorita'    1
every named img in the gallery                 ["Azurill","Bronzor","Chikorita","Ditgar","Ditto","Gengar","Glalie","Kakuna","Lapras","Leafish","Meowth","Onyx","Pikachu","Rhyhorn","Scizor"]
page text says "Template Gallery"              true
```

## What reproduced

The Template section contains **exactly one preview — the template already in use** (`Azurill`) — one
heading, one description and four tag chips. There is nothing to browse:
`getByRole('img', {name: 'Chikorita'})` inside the section is **0**, and the section's text never says
"gallery".

(In the accessibility tree the section shows four `img` nodes; three are SVG icons — the two chevrons and
the swap overlay — and only one is named. There is exactly **one** real `<img>` element, the current
template's preview.)

**Control — the gallery is real, and it is a modal.** Clicking that single preview (whose accessible name
is the *current* template's, `Azurill`) opens a dialog headed **`Template Gallery`** containing all
fifteen templates by name:

```
["Azurill","Bronzor","Chikorita","Ditgar","Ditto","Gengar","Glalie","Kakuna",
 "Lapras","Leafish","Meowth","Onyx","Pikachu","Rhyhorn","Scizor"]
```

So the gallery is reachable — through a dialog the guide never mentions, by clicking a control the guide
never mentions. Screenshot: [`template-gallery-modal.png`](./template-gallery-modal.png).

## Mechanism, re-read at this SHA

`apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/template.tsx:26-44` — `:26-28` defines
`onOpenTemplateGallery` as `openDialog("resume.template.gallery", undefined)`, and `:32-44` renders exactly
one `Button` whose `onClick` is that handler and whose only content is
`<img src={metadata.imageUrl} alt={metadata.name} />` for the **current** template, plus a swap icon
overlay. There is no list, no grid and no second trigger in the section.

## Verdict

**still reproduces**
