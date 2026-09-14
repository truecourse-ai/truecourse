# Migration Plan: one app, one edition line, no CLI

Decided 2026-09-11 in conversation with the product owner, after PR #900
(`sm/context-page`). This is the contract for the work; it starts on a
fresh branch from main once #900 is merged, one pull request per slice.
Untracked, never committed.

## 1. Decisions

- **One app.** The dashboard built under `/preview` IS the product. It is
  mounted at `/`; the `/preview` prefix goes; the old client goes. No
  redirects from old addresses: nothing links to them.
- **No CLI.** `tools/cli` retires, and with it the file-mode stores (the
  registry, `~/.truecourse/`, the per-repo `.truecourse/` as a committed
  layout, the sessions files, ui-state, config), the committable-results
  convention and its docs. An MCP server over the HTTP API replaces the CLI
  for agents, as a FOLLOW-UP, not in this migration.
- **The engine's tree format stays.** The guard runner, the generator, the
  spec consolidator and the interface mapper read and write a `.truecourse/`
  tree inside a WORK DIRECTORY. Hosted jobs already materialize stored
  state into a clone and collect it back; a local folder run does the same
  into a copy. The tree is an implementation detail of a run, never a
  user-visible or committed thing.
- **Analyze and contracts go.** The analyzer (tree-sitter, Roslyn host),
  the graph, rules, violations, schema, the contract extractor and its
  `.tc` corpus, Knowledge, the analyze-era pages and stores, their tests
  and fixtures. Observability (the trace store, Sentry) goes too.
- **Open versus EE.** Everything is open except three things, which live
  in `ee/` and register into the open shell's nav, route and server
  registries:
  1. Connections: Jira, Confluence, Google Drive, OneDrive, Notion, Slack
     (the Settings tab and the connectors).
  2. Repository providers beyond GitHub and GitLab (Azure DevOps and later).
  3. Multiple workspaces: the switcher, Create workspace, the switch and
     create routes.
  Plus Admin, the operator console, built fresh in EE when there is
  something to administer; the old Admin page is deleted, not migrated.
  Nothing else in `ee/` survives.
- **Local shape of the open edition.** The same server and dashboard, run
  locally: Postgres through one `docker compose up` (one storage, one job
  runner), NO sign-in locally (one implicit user, one implicit workspace),
  repositories from GitHub, GitLab or a LOCAL FOLDER. Hosted keeps WorkOS.
- **Table names stay** (decided 2026-09-11), except the two GitHub-named
  ones, which widen with the provider seam in slice 5. The obsolete tables
  of the analyze and EE eras are dropped with their code (slices 2 and 4).
- **Local folder provider.** Offered only when the server runs locally: a
  path becomes a repository like a connected one; runs copy the folder
  into the run directory (never write into the user's tree); no push
  webhook, so sync is manual or on a watcher.

## 2. Open versus EE, the table

| Open | EE |
|---|---|
| The engine (setup, generation, runs, adjudication, interface authoring, the scan) | Connections and the six document connectors |
| Sign-in (hosted), one workspace, its members and invitations | Providers beyond GitHub and GitLab |
| Connect a repository (GitHub, GitLab, local folder), Code, the repository console | Multiple workspaces: switcher, create, switch |
| Context: repository sources, llms.txt sites, documents, conflicts, the Document scan | Admin (operator console, built fresh) |
| Flows, runs, evidence, the pull request gate and its checks | |
| Agent (every conversation) | |
| Home, section history, the trend | |
| Notifications | |
| Settings: Members, Repositories, Models | |

## 3. Slices (one pull request each, in this order)

1. **Promote the new app.** Mount `PreviewApp` at `/`; drop `PREVIEW_BASE`
   to `''` (or delete the constant and every use); delete the old client
   routes, pages and components (`components/analyses`, `analytics`,
   `code`, `files`, `graph`, `rules`, `schema`, `violations`, the old
   `layout`, `pages`, `repo`, `spec` twins), the preview's `vendor/` copies
   that only existed to avoid touching the old code (fold what the new
   app still uses into its own modules), the EE client pages the new app
   replaced (Overview, Repositories, Pull requests page, Workspace,
   Models, Integrations, Notifications, Knowledge, Admin) and the nav
   registry entries that pointed at them. Pull requests become a page in
   the new app under Code (the gate's list of PRs with their checks).
   Tests follow: the old client tests go, the preview tests lose the
   prefix.
2. **Delete analyze and contracts.** The analyzer package, the Roslyn host
   and its build, the contract extractor, the rules catalog, the graph and
   flow services, the analysis store, the analyze/verify/infer/contracts
   commands and routes and their stores and tables (a migration drops
   them), Knowledge (client, server, data-store), observability (traces,
   Sentry), the fixtures and tests of all of it. Keep what the guard
   engine still calls (the interface mapper's per-file facts come from the
   analyzer: confirm and keep exactly that subset, moved beside the
   mapper). Tables dropped here (one migration): `analyses`,
   `analysis_current`, `analysis_history`, `gh_baselines`, `gh_runs`,
   `gh_prs`, `gh_inferred_actions`, `pending_baselines`,
   `guard_backfill_markers`, `knowledge_documents`, `llm_traces`,
   `workspace_settings`, `spec_sets`, `registry`, `repo_config`,
   `repo_ui_state`; and the stray `truecourse_reset_backup` schema.
3. **Retire the CLI and the file stores.** `tools/cli`; the file
   implementations behind every store seam (analysis, spec, guard, config,
   ui-state, registry, sessions, LLM cache, locks), leaving the Postgres
   ones as the only implementation and simplifying the seams to match;
   `~/.truecourse/` and the global config; the in-repo `.truecourse/`
   gitignore template and the committable convention; `truecourse.json`
   per-repo config if nothing hosted reads it; the CLI docs, README
   sections and the Mintlify pages. The work-directory tree stays and gets
   one module that owns its layout. The stores keep their shape
   (decided 2026-09-11: `jobs` and `activity_runs` both keep their run
   state, `pending_guard_baselines` stays; the one visible drift, a
   restart marking the job failed and the run interrupted, is fixed by the
   boot sweep marking both the same way). A repository source keeps its own
   repository and branch (Context may read a repository that is not
   connected in Code).
4. **Draw the EE line.** Move Connections (tab and connectors), the extra
   providers (Azure DevOps in the connect flow and Settings › Repositories),
   and Workspaces (switcher, dialog, the three auth routes) into `ee/`,
   registered through the shell's registries and the server's router
   mounts; delete the rest of `ee/` (client, server modules, data-store
   extras, llm, storage) and its packages; the boundary test
   (`tests/architecture/ee-import-boundary.test.ts`) pins the new line.
   `integration_connections` is dropped or re-homed by EE's Connections,
   whichever the connectors need.
5. **Local mode.** A `local` server mode: no WorkOS, one implicit user and
   workspace (a fixed organization id), the auth gate answering that
   session; `docker-compose.yml` with Postgres; the Local folder provider
   in Settings › Repositories and the connect dialog (offered only in local
   mode), its registry rows, its run-directory copy, manual Sync now and
   a watcher; the README rewritten for this shape. The two GitHub-named
   tables widen with the seam (decided 2026-09-11): `gh_installations`
   becomes `provider_accounts` with a `provider` column, `gh_repos` becomes
   `repositories`; no other table is renamed. There is no old data to carry:
   drop and recreate, never ALTER.

## 4. Follow-ups, not in this migration

- The MCP server over the HTTP API.
- One definition of a section's status across the product (Code's
  Requirements bar reads the guard status summary; Home and the Documents
  view read the document coverage composition; they disagree).
- The EE Workspace page and `/api/ee/workspace/members` duplicate
  Settings › Members: they go with slice 1.
- Hosted adjudication (Out of date on Home), inferred documentation,
  requirements written in the product.
- Add context's repository step offers any repository the connected
  account can reach, not only the ones connected in Code (decided
  2026-09-11); a repository source then syncs from the provider on its
  own, whether or not Code knows the repository.
