# Spec Web Sources — `truecourse spec source add <llms-txt-url>` (OSS)

Add llms.txt-enabled documentation websites as a spec-scan doc source for OSS, alongside repo-local markdown. EE keeps Confluence/Jira; this is the OSS analog for public docs sites.

## UX

```
truecourse spec source add <llms-txt-url>   # fetch llms.txt, list pages, confirm, fetch, snapshot
truecourse spec source list            # registered sources + doc counts + last fetched
truecourse spec source refresh [id]    # refetch (all sources if id omitted); reports added/changed/removed
truecourse spec source remove <id>     # delete snapshot + registry entry
```

`add` flow:
1. User gives the site's `llms.txt` URL directly (e.g. `https://docs.strapi.io/llms.txt` or `https://cal.com/docs/llms.txt`). A URL not ending in `llms.txt` ⇒ clear error showing an example — no auto-discovery or path-walking. A site with several docs deployments (each deployment generates its own llms.txt) is added once per llms.txt.
2. Fetch it; unreachable or unparseable ⇒ clear error: only llms.txt-enabled docs sites are supported.
3. Parse llms.txt (markdown: H1 title, H2 sections, `- [title](url): desc` link lists, including the "Optional" section — we never silently thin what the model sees). Dedupe, filter to same-origin links. Print: `Found "Strapi Docs" — 214 pages (198 same-origin, 16 external skipped). Fetch now?` → confirm (skippable with `-y`).
4. Fetch each page as markdown: link ends in `.md` → fetch as-is; else try `<url>.md`; else fetch the plain URL and accept only `text/markdown`/`text/plain` responses. HTML-only pages are recorded as skipped-with-reason, never converted (v1 is md-only, matching the "llms.txt-enabled sites only" scope).
5. Snapshot pages as real files: `.truecourse/specs/sources/<sourceId>/<url-path>.md`. Register the source. Print a `truecourse spec scan` hint.

No LLM calls happen during add/refresh — it's pure fetching, so no cost estimate there. The next `spec scan` sees the new files and its existing pre-flight estimate prices the relevance/tagging calls automatically.

`spec scan` itself never touches the network — it reads the snapshot only. Fetching happens exclusively in `spec source add/refresh` (deterministic, offline-safe scan is preserved).

## Why materialize to real files (core design decision)

The corpus stores only doc refs (repo-relative paths); content is re-read from disk by every downstream consumer, and most have **no injection seam**:
- `guard generate`: `indexRepoDocs()` (`packages/guard-runner/src/doc-index.ts:52`) and `section-plan.ts:255/353` hard-read `path.resolve(repoRoot, ref)` — a ref that isn't a real file becomes `missing` and orphans its scenarios.
- The estimate (`spec-estimate.ts:169`) calls `discoverDocs()` directly — an in-memory-only doc source would be invisible to it.
- The dashboard doc viewer serves refs through `readRepoDoc` (working-tree read).
- EE's Confluence/Jira docs work exactly this way: materialized as `knowledge/<kind>/<id>.md` files before curate runs.

So: fetched pages become real files under `.truecourse/specs/sources/`, corpus refs are their genuine repo-relative paths, and relevance/area-tag caches (keyed on `path :: contentHash`) stay stable across runs. Zero changes needed in guard-generator, guard-runner, contract pipeline, decisions, or the estimate.

## Storage

```
.truecourse/specs/
  sources.json                      # committable — source registry + per-source fetch manifest
  sources/<sourceId>/<path>.md      # committable — fetched markdown snapshot (real files)
```

**Both committable** (recommended): same rationale as `specs/corpus.json` — fetched over the network, not reproducible offline, teammates/CI inherit via git so `spec scan` and `guard generate` work on a fresh clone without refetching. No `GITIGNORE_CONTENTS` change needed (template only lists ignored entries). Follows the "commit after merging to main" convention like corpus.json.

`sources.json` shape:

```jsonc
{
  "version": 1,
  "sources": [
    {
      "id": "docs.strapi.io",              // slug from llms.txt host (+path if non-root, e.g. "cal.com-docs"); --id to override
      "llmsTxtUrl": "https://docs.strapi.io/llms.txt",
      "title": "Strapi Docs",              // llms.txt H1
      "fetchedAt": "2026-07-30T...",
      "docs": [
        { "url": "https://docs.strapi.io/cms/installation.md",
          "path": "cms/installation.md",   // relative to sources/<id>/
          "title": "Installation",         // llms.txt link title
          "contentHash": "sha256-..." }
      ],
      "skipped": [
        { "url": "https://github.com/strapi/strapi", "reason": "external-origin" },
        { "url": "https://docs.strapi.io/foo", "reason": "not-markdown" }
      ]
    }
  ]
}
```

URL→file mapping: strip origin, decode, sanitize segments (Windows-invalid chars), strip fragments/query, collision-safe dedupe by normalized URL. Writes via `atomicWriteJson`.

## Pipeline integration

1. **Discovery** (`packages/spec-consolidator/src/discovery.ts`): `discoverDocs()` appends source docs after the filesystem walk — enumerate from `sources.json` + snapshot dir, yield normal `DocCandidate`s with `path = .truecourse/specs/sources/<id>/...`. The walk's hard-skip of `.truecourse/` is irrelevant (we enumerate explicitly). **Exempt source docs from `spec.include` scope and `.truecourseignore`** — registering the source is already the opt-in. Since the estimate calls the same `discoverDocs()`, estimate parity is automatic.
2. **Curate**: nothing changes. Web docs flow through relevance → area-tags → overlap exactly like repo docs (uniform pipeline; llms.txt sites can still contain pages irrelevant to this repo's spec surface, and the caches make it a one-time cost). `spec docs include/exclude` work on them by ref as usual.
3. **Staleness**: the dashboard's `GET /spec/staleness` mtime probe must also watch `specs/sources.json` + snapshot dirs so the amber Rescan dot lights after add/refresh.
4. **Refresh diff**: refetch llms.txt, diff the link set + content hashes; write changed files, delete removed ones, report `added/changed/removed/unchanged`. Unchanged docs keep their content hash ⇒ scan cache hits. Removed docs drop out of the corpus on the next scan (existing behavior for deleted repo docs).
5. **remove**: deletes `sources/<id>/` + registry entry; stale decisions referencing gone refs are handled the same as deleted repo docs today.

## Fetcher

New code (repo has no crawler today) in `packages/spec-consolidator/src/sources/`:
- `llms-txt.ts` — fetch + parse (title, sections, links with titles/descriptions).
- `fetcher.ts` — concurrency pool (~6), per-request timeout (10s), bounded retries with backoff honoring `Retry-After` (pattern from EE's Jira connector), `User-Agent: truecourse/<version>`, follows redirects, accepts only markdown/plain content types.
- `store.ts` — registry read/write, URL→path mapping, snapshot write/refresh-diff/remove.
- Progress via the existing `StepTracker` (fetch llms.txt → parse → fetch pages with a moving `fetched 42/214` counter — counters, no bars).

## Command + surface layer

- **Core** (`packages/core/src/commands/spec-sources.ts`): `addSpecSource`, `refreshSpecSources`, `removeSpecSource`, `listSpecSources` — tracker + confirm-callback options, shared by CLI and dashboard (same split as `spec-in-process.ts`).
- **CLI** (`tools/cli/src/commands/spec-sources.ts`, registered under `specCmd.command("source")` in `tools/cli/src/index.ts`): clack prompts for the fetch confirm, stdout step renderer, `-y/--yes`.
- **Dashboard server** (`apps/dashboard/server/src/routes/spec.ts` or a sibling): `GET/POST /:id/spec/sources`, `POST /:id/spec/sources/:sourceId/refresh`, `DELETE /:id/spec/sources/:sourceId`; progress over the existing `spec:progress` socket channel.
- **Dashboard client**: a "Sources" group in the spec corpus tree (one row per site: title + page count) whose selection opens the site's detail in the right pane (pages, skipped links, refresh/remove) and whose header "+" opens the focused add view; web docs get an origin badge in the doc tree, and the doc viewer shows the original page URL (enrichment from `sources.json`, same pattern as the `knowledge/` ref enrichment in `routes/spec.ts:123`). Ugly raw refs (`.truecourse/specs/sources/...`) are display-mapped to `<source title> / <page path>`.

## Out of scope (v1)

- HTML→markdown conversion for non-llms.txt sites (explicitly unsupported; clear error instead).
- `llms-full.txt`, sitemap.xml, recursive HTML crawling.
- Auth-gated docs sites (no credentials in OSS).
- OpenAPI/yaml links inside llms.txt (markdown pages only).
- EE "website" connector parity (the EE `KnowledgeConnector` seam could host this later; not now).
- No page-count caps of any kind — full fetch, with visible counts and a visible skipped list.

## Implementation phases (Opus agents)

Each phase lands green tests before the next dependent one starts.

1. **Sources engine** — `spec-consolidator/src/sources/` (llms.txt locate/parse, fetcher, URL mapping, snapshot store, refresh diff) + unit/integration tests against a local `node:http` fixture server (network-free, like guard-runner tests). — STATUS: BUILT
2. **Discovery + staleness integration** — `discoverDocs()` merge, scope/tcignore exemption, staleness probe, estimate-parity test proving source docs are priced. — STATUS: BUILT. As-built: source docs are appended after the walk, sorted by ref among themselves, so repo-doc walk order stays byte-identical; the estimate needed no change (it shares `discoverDocs`), and the staleness probe now also stats `specs/sources.json` + the snapshot tree (directory mtimes included, so a deleted page trips it).
3. **Core command + CLI** — `spec source add/list/refresh/remove` end-to-end against the fixture server; CLI tests in `tests/cli/`. — STATUS: BUILT. As-built: the core entry points are named `addSpecSourceInProcess` / `refreshSpecSourcesInProcess` / `removeSpecSourceInProcess` / `listSpecSourcesInProcess` (the `*InProcess` convention of `spec-in-process.ts`), plus `resolveSpecSources` (the sources a command targets) and `sourceRefreshSteps` — a refresh declares ONE step per source, so N sources render as N checklist lines rather than re-activating a shared step. A decline at `onConfirm` throws `SourceFetchDeclined` (exit 0); missing `--yes` with no TTY is an error (exit 1). Like `spec docs`, the source commands do not require a git repo — only `spec scan` does.
4. **Dashboard** — server routes + client Sources UI + doc-tree/viewer enrichment; tests in `tests/server/` + `tests/dashboard-client/`. — STATUS: BUILT. As-built: the routes live in their own sibling router (`apps/dashboard/server/src/routes/spec-sources.ts`) with a refresh-all at `POST /spec/sources/refresh` beside the per-source `POST /spec/sources/:sourceId/refresh`; the completion event is `spec:complete { kind: 'sources' }` (new union member) and, like the scan route, there is NO server-side lock — the client disables its buttons for the duration. Snapshots are working-tree files, so the routes 501 and the UI hides under hosted EE (`local-filesystem`, the External-APIs gate). Enrichment tags kept AND skipped docs (`origin: 'web'`, `sourceId`, `sourceTitle`, `url`) and falls back to the id in the ref when the source is gone; the doc route needed no change (a snapshot ref is a real repo-relative path the traversal guard already admits). Tests landed in `tests/dashboard-server/spec-routes.test.ts` (the dashboard-server project, where the sibling spec-route tests live) + `tests/dashboard-client/spec-sources.test.tsx`. **UI redesign (as-built, after user testing):** the flow was right but the shape was not — the bottom-pinned collapsible block with the add form squeezed inline is gone (`SpecSourcesSection.tsx` deleted), replaced by the app's standard master–detail: a **Sources group** in the corpus tree above Documents (one previewable row per site, "+" on the group header) whose selection opens the right pane as a Coverage tab — `SpecSourceDetail` (llms.txt link, last fetch, pages-kept/skipped stats, the clickable page list, the skipped links with reasons, Refresh + Remove as header actions) or `SpecSourceAddView` (URL → Check → preview → Fetch, then it hands off to the new source's detail). Source selection is URL-synced as `?gsrc=<sourceId>` (the add view rides the same param as `*new`, a value the source-id slug charset can never produce), joining `?guard`/`?gconf` in the Coverage tab codec. The sidebar group re-reads the registry off the existing `spec:complete { kind: 'sources' }` event (a page-level reload key, the `useGuardExternals` idiom). ONE server addition was needed: `GET /spec/sources/:sourceId` returns the source WITH its per-page manifest — the listing deliberately omits it (hundreds of entries on every sidebar mount) and the registry, not the corpus, is the truth about what a fetch wrote, so the detail pane lists pages even before the first scan. **Superseded (as-built, second redesign):** the tree group was still a sidebar doing a page's job — a narrow column holding a globe hero, a second empty state and no main pane — so sources now have their own **Sources page** in the guard rail (`tab=sources`, `local-filesystem`-gated like External APIs, `noPanel`), and `SpecSourcesGroup` / `SpecSourceAddView` are deleted. The page is one row per site (llms.txt link, `N pages kept · M skipped`, last fetch, Refresh + Remove) whose detail opens INSIDE the row at full width — stats, every fetched page (click → the Coverage doc viewer via `openSpecDoc`), the skipped links with reasons — selection URL-synced as `?gsrc=<sourceId>`; the add flow is the header's primary action, and with nothing registered it IS the page, under one `EmptyState`. `?gsrc` left the Coverage tab codec (docs + conflicts only again) and the pre-scan "No corpus yet" note keeps a single quiet line into the page. **Page click (as-built, third pass):** the jump to Coverage was a dead end before a scan — the doc rendered beside an empty corpus tree — so a page click now PREVIEWS in place (`SpecDocViewer` beside the page list, its header carrying the live-page link and a close), and the Coverage jump appears only when the corpus actually knows the ref (`corpusHasDoc` over docs ∪ skippedDocs; the corpus is read lazily, latched by the first preview); otherwise the header reads "Run Scan to add this page to the corpus." A `?guard=<sourceRef>` deep link that lands pre-scan gets the same truth from the Coverage pane itself — an amber caution strip plus the shared `SpecScanButton` (`local-filesystem`-gated, running the same `corpus.scan()` the header does). **Reading a fetched page (as-built, fourth pass):** Docusaurus container directives (`:::note … :::`, and whatever else a site invents) were landing as literal `:::` prose, so `DocMarkdown` now runs `remark-directive` + a `remarkAdmonitions` transform (`client/src/lib/remark-admonitions.ts`) that hands each container to the renderer as a `<div>` carrying its type and `[Custom title]` in two data attributes the sanitize schema deliberately admits — known types get tinted callouts, unknown ones the same box under their own capitalized name, and leaf/text directives are restored verbatim from the source (with the syntax on, prose like `note:here` parses as a directive and would otherwise be silently eaten). The in-place preview is also ONE height now: side by side the list column and the preview stretch to a single `xl:h-[32rem]` block and each scrolls inside it (`flex-1` on the preview is xl-only — stacked, its basis resolves against an indefinite column and it grew to the whole document); below `xl` both keep a 26rem cap.
5. **Docs + final sweep** — README (commands, storage), CLAUDE.md storage section (`specs/sources.json`, `specs/sources/` — both committable), full `pnpm test` green. — STATUS: BUILT. As-built: the sweep caught one Phase-4 defect — `SpecSourcesSection` wrote state from its mount-time load after unmount (it lacked the cancellation guard `SpecCorpusView` / `SpecDocViewer` use), surfacing as an unhandled rejection in the client suite; the load and the mutation path now check a mount-scoped `alive` ref.

6. **Battle-test fixes** (docs.strapi.io, 283 pages) — STATUS: BUILT. Two defects, both fixed at the root:
   - **Duplicate `add` was detected too late, and printed twice.** The registry check lived only inside `addSource`, so a re-add paid the llms.txt read and the whole confirm gate before failing. The check is now the exported `assertSourceAddable(repoRoot, url, id?)` — the same URL/id semantics `addSource` itself enforces — called at the top of `addSpecSourceInProcess`, so a re-add fails instantly with zero network. And a failed step now carries the ✕ marker alone (its last counter, never the reason): the reason belongs to the caller's closing line (CLI `p.cancel`, the route's error response), which is what printed it a second time.
   - **The scan estimate computed in silence for seconds.** `estimateScanTokens` discovered with `lastTouched`, i.e. one `git log` PROCESS per doc — 7.6s of the 8.3s a 492-doc estimate took, and nothing in the estimate reads it. It now discovers with `skipGit` (8.3s → 0.09s); curate still derives it for the corpus, and the doc list/hashes/sizes are identical either way. The estimate also gets its own progress step (`Estimating cost — N docs`, `withEstimateStep` in `progress.ts`, inserted first and only when the caller gates), shared with `guard generate`, whose estimate had the same silent gap.

Phases 1→2→3 are sequential; 4 depends on 3; 5 last. (2 and 3 can run in parallel after 1 if we want the wall-clock win.)

## Decisions to confirm

1. **Committable snapshots** — fetched markdown + `sources.json` are git-tracked (recommended, keeps fresh clones working for scan/guard without refetch). Alternative: gitignore the snapshot and require refetch per clone — breaks corpus/guard on clones until fetched.
2. **Same-origin filter** — only links sharing the llms.txt URL's origin are fetched; external links land in the visible `skipped` list (recommended).
3. **Web docs go through the normal relevance filter** — a registered site's pages can still be dropped as irrelevant (with force-include available), rather than auto-keeping everything (recommended: uniform pipeline, one-time cached cost).
