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
- **Dashboard client**: a "Sources" management block (add URL input, per-source rows: title, page count, last fetched, refresh/remove) in the spec corpus view; web docs get an origin badge in the doc tree, and the doc viewer shows the original page URL (enrichment from `sources.json`, same pattern as the `knowledge/` ref enrichment in `routes/spec.ts:123`). Ugly raw refs (`.truecourse/specs/sources/...`) are display-mapped to `<source title> / <page path>`.

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
4. **Dashboard** — server routes + client Sources UI + doc-tree/viewer enrichment; tests in `tests/server/` + `tests/dashboard-client/`. — STATUS: BUILT. As-built: the routes live in their own sibling router (`apps/dashboard/server/src/routes/spec-sources.ts`) with a refresh-all at `POST /spec/sources/refresh` beside the per-source `POST /spec/sources/:sourceId/refresh`; the completion event is `spec:complete { kind: 'sources' }` (new union member) and, like the scan route, there is NO server-side lock — the client disables its buttons for the duration. Snapshots are working-tree files, so the routes 501 and the UI hides under hosted EE (`local-filesystem`, the External-APIs gate). Enrichment tags kept AND skipped docs (`origin: 'web'`, `sourceId`, `sourceTitle`, `url`) and falls back to the id in the ref when the source is gone; the doc route needed no change (a snapshot ref is a real repo-relative path the traversal guard already admits). Tests landed in `tests/dashboard-server/spec-routes.test.ts` (the dashboard-server project, where the sibling spec-route tests live) + `tests/dashboard-client/spec-sources.test.tsx`.
5. **Docs + final sweep** — README (commands, storage), CLAUDE.md storage section (`specs/sources.json`, `specs/sources/` — both committable), full `pnpm test` green. — STATUS: BUILT. As-built: the sweep caught one Phase-4 defect — `SpecSourcesSection` wrote state from its mount-time load after unmount (it lacked the cancellation guard `SpecCorpusView` / `SpecDocViewer` use), surfacing as an unhandled rejection in the client suite; the load and the mutation path now check a mount-scoped `alive` ref.

Phases 1→2→3 are sequential; 4 depends on 3; 5 last. (2 and 3 can run in parallel after 1 if we want the wall-clock win.)

## Decisions to confirm

1. **Committable snapshots** — fetched markdown + `sources.json` are git-tracked (recommended, keeps fresh clones working for scan/guard without refetch). Alternative: gitignore the snapshot and require refetch per clone — breaks corpus/guard on clones until fetched.
2. **Same-origin filter** — only links sharing the llms.txt URL's origin are fetched; external links land in the visible `skipped` list (recommended).
3. **Web docs go through the normal relevance filter** — a registered site's pages can still be dropped as irrelevant (with force-include available), rather than auto-keeping everything (recommended: uniform pipeline, one-time cached cost).
