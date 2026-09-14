# Context Plan: sources, the workspace corpus, and what a repository reads

The plan for moving Context out of the repository and into the product,
from the product-owner mockup on `sm/product-owner` to real data on
`origin/main`. It is the first slice of `docs/PRODUCT_OWNER_PLAN.md` Phase 1,
revised by the decisions of 2026-09-10 (§2). This document is untracked by
design and is the contract the implementation agents build from.

Worktree: `context-page` (branch `worktree-context-page`, off origin/main at
`65c25423`). Vocabulary, layout and list rules are inherited from the Agent
page work (`sm/agent-page`, PR #896): one-line index tables, the one-row
Add-filter, one-row headers, no count subtitles, no made-up text.

---

## 1. What changes, in one paragraph

Documentation stops belonging to a repository. A workspace has **sources**
(a repository's own markdown, a public documentation site; later Jira and
the rest), each source yields **documents**, and the workspace has ONE
**corpus**: the Document scan runs over every source's documents and settles
areas, conflicts and decisions for the workspace. A repository **binds** the
sources it reads, and its corpus is the workspace corpus cut down to those
sources; Test setup, Test generation and Test run stay per repository over
that slice. The per-repository scan, the repository's Corpus tab, its
Sources tab and its source registry retire.

## 2. Decisions taken (2026-09-10)

1. **Sources are workspace objects; a repository binds them.** (Plan §4.)
2. **Two kinds work in this slice: Repository and Documentation site.**
   Jira, Confluence, Google Drive, OneDrive, Notion and Slack are LISTED in
   the add dialog, locked, with the words "Coming soon", and have no
   implementation, no connection and no settings.
3. **The Document scan runs at the workspace level.** One corpus per
   workspace. Curation, areas, overlaps, conflicts, decisions and the
   scan's caches are the workspace's. A conflict is a property of the
   workspace's documents, not of a repository, and is resolved once.
4. **The per-repository scan retires in this slice**, with the repository
   console's Corpus tab, the Sources tab, the per-repository source
   registry (`spec_sources`) and the per-repository spec sets. Nothing keeps
   working beside the workspace scan.
5. **The scan no longer looks for documents.** Finding a repository's
   markdown is the Repository source's sync, scoped by its include and
   exclude patterns, run on every push to the default branch. The scan
   receives the bound documents and does everything after discovery:
   curation, areas, overlaps, verification, the fold.

## 3. The model

| object | is | key |
|---|---|---|
| **source** | one feed of documents of one kind, with a scope | workspace + id |
| **document** | one page or file a source yielded, stored as it was read, versioned by content | source + document id (the page URL for a site, the repo-relative path for a repository) |
| **sync** | one refresh of a source: when, and the counts added / changed / removed / unchanged | source + time |
| **binding** | a repository reads a source | repository + source |
| **corpus** | the workspace's curated documents: kept documents with their areas, the areas, the skipped documents, the conflicts | workspace + scan |
| **decisions** | the workspace's standing choices: scope verdicts, manual includes and excludes, manual areas, relations, conflict resolutions, instructions | workspace |
| **slice** | the corpus restricted to the documents of the sources a repository binds | derived per repository, never stored as a corpus |

**Kinds.** `repository` (scope: include and exclude path patterns; default
`docs/**` and `**/*.md`, minus changelogs and licenses, on top of the
engine's skip list) and `site` (scope: the llms.txt URL; the engine that
exists, re-homed to the workspace). The six tool kinds are names in a list.

**The Repository source.** Connecting a repository creates its Repository
source, bound to that repository, and syncs it. A sync of a Repository
source checks the default branch out, walks it with today's discovery
(markdown and OpenAPI files, the skip list, the ignore file), keeps what
the patterns include, and stores every file content-addressed. A push to
the default branch syncs it again. The source belongs to the workspace like
any other: a second repository may bind it (a platform repository's docs
feeding a service).

**Document identity.** One ref grammar for every document of the corpus:
`context/<sourceId>/<docPath>`, where `docPath` is the repo-relative path
for a repository source and the snapshot path for a site. That ref is the
document's address in the corpus, in claims, in scenarios and in the
Documents view. The two old grammars (`.truecourse/specs/sources/...` and
`knowledge/...`) retire.

**Status of a document, per repository.** The coverage the engine already
derives per section, folded worst-first to the document, read through one
repository, in the product owner's words:

| engine | word |
|---|---|
| Succeeded | Proved |
| Failed | Failed |
| Blocked | Blocked |
| Not testable | Not testable |
| Never run | Not run |
| (no repository reads it) | Not linked |

A document's status is folded across EVERY repository that reads it, worst
first, so the Documents view has one row per document. A document no
repository reads is Not linked (grey, like Not testable). "Out of date" (a
failure adjudicated as document drift) and "Inferred" are NOT in this slice;
the words stay reserved.

**The verb.** A repository is LINKED to a source (the user's word). The
Context tab's toggle reads "Linked", the add dialog asks which repositories
to link; "binding" is the internal name of the row.

## 4. The pipeline

**Sync.** `sync(source)`: list, diff against the stored documents, fetch what
changed, store bodies content-addressed under the workspace, write the
sync record. A site syncs on add, on Sync now and daily; a repository source
on add and on every push to its default branch. A sync that changed
anything marks the workspace corpus stale.

**Scan.** `Document scan` is a workspace job, single-flight per workspace,
coalescing (a sync landing during a scan queues one more scan, not N). It
materializes every source's documents into a scratch tree under
`context/<sourceId>/` with the workspace decisions, and runs the scan engine
over that tree with discovery replaced by "the tree is the universe". No
repository clone. Unchanged documents are cache hits. Its facts say which
sources yielded how many documents. The run is recorded under the workspace
(no repository on its Agent row).

**Ripple.** When a scan changed the corpus, every repository whose slice
changed gets Test generation enqueued (then Test run), quiet (one
notification for the scan, none per repository), and only when the
workspace has no open conflict; a repository already working coalesces.
This is the EE inheritance ripple, ported.

**The repository's chain.** Connect: create and sync the Repository source,
bind it, run the workspace scan, then Test setup, Test generation, Test run
for the repository. Test generation materializes the repository's slice
(its bound sources' documents, the corpus entries for them, the workspace
decisions) into the clone as `.truecourse/specs/` plus the documents under
`context/`, and runs as today. The doc reader resolves a `context/` ref
from the workspace's store.

**Relevance.** The scan's curator was briefed with the repository's
identity. It is now briefed with the workspace (its name, the connected
repositories' identities) and, per document, the source it came from and
its kind. The scope session's verdicts are per source and per subtree
within a repository source; user verdicts still win.

## 5. The pages

**Context › Documents** (`/preview/context/documents`; the nav entry with the
Layers icon, between Home and Code, lights for the whole of
`/preview/context/**`). One table, one row per document, worst first.
Columns: Document, Area, Source (the source's title), Repositories (the one
that reads it, "N repositories" past one, "—"
for none), Status (folded across its repositories; Not linked for none),
Updated (the document's last change at its source). Search on the title. The
one-row Add-filter over Area, Status, Source, Repository, AND across
dimensions and OR within one, all in the address (`?area=&status=&source=&repo=`).
Narrowed to exactly one source, the trail reads `Context › Sources ›
<title> › Documents` with the title linking back to the source's page, and
the header carries the source's sync status word — and nothing to press: a
source's actions are on its page (amended 2026-09-11). A row opens the
document's coverage page.

**Context › Sources** (decided 2026-09-11; `/preview/context`, which is where
the section LANDS — the side menu reads Sources, Documents, Conflicts). One
table, one row per source of the workspace, worst first (failed, never
synced, syncing, paused, synced) then by title. Columns: Source (the title),
Kind (Repository / Documentation site, the add dialog's own words),
Repositories (the one that reads it, "N repositories" past one, "—" for
none), Status (the sync status word; a failed source's stored `statusNote`
on the row, as the agent's conversation shows a run's reason), Documents (the
source's document count), Last sync ("—" when nothing has synced it yet).
Search on the title; no filter row — a source list has nothing to narrow
along that the search does not do. A row does ONE thing: on a single click
it opens the source's page (amended 2026-09-11 — the row has no menu, and
nothing on a row is pressable). Empty: "No source yet. Add context to
connect one."

**Context › Sources › source** (decided 2026-09-11;
`/preview/context/sources/<id>`, the Sources row's target; the older
singular `/preview/context/source/<id>` redirects here). Crumbs `Context ›
Sources › <title>`; the frame's Scan and Add context stay. The header
carries the source's sync status word and then the actions that used to be
the row's menu, as buttons: **Sync now** (disabled while syncing or paused),
**Pause / Resume**, and **Remove** for a site only — the confirmation names
the repositories that read it, and the removal leaves for `/preview/context`.
A repository source is removed by disconnecting its repository.

The body is three plain sections, no cards. **Scope**, editable, per kind: a
repository shows its repository (read-only — a repository source never moves),
Branch (empty means the default branch), Include patterns and Exclude
patterns one per line; a site shows its llms.txt URL. **Save** is live only
when something changed; it `PATCH`es the scope, and the source SYNCS on it so
the new scope's documents replace the old — a paused source stores its scope
and the answer says it syncs on Resume. A refusal is the server's own words
in a toast. **Read by**: every connected repository with a Linked switch over
the source's readers; toggling one saves that repository's whole binding set,
and a repository source's own repository cannot be unlinked here ("its own
repository"). **Syncs**: the document count as a link to
`/preview/context/documents?source=<id>`, the failure note when the status is
failed, and the source's syncs newest first — When, Added, Changed, Removed,
Unchanged — or "No sync yet."

Server: `GET /api/context/sources/:id` answers `{ source, syncs }` (newest
first, last 50) and `PATCH /api/context/sources/:id` takes `{ config }`,
validates it exactly as the add validates one (a repository's `repoFullName`
cannot change; a site's URL must be an llms.txt the workspace does not
already have — 409), stores it, emits the workspace event and enqueues a
manual `context.sync`, answering `202 { source, jobId? | note? }`; a sync
already in flight is a 409.

**The Context header's actions.** **Scan** (the workspace Document scan, with
the stale dot when a sync or a link is newer than the corpus) and **Add
context** belong to the workspace, not to one list, so they sit in
`ContextFrame`'s header and EVERY section carries them (amended 2026-09-11 —
decided 2026-09-10 that the scan starts on Context and nowhere else).

**Amendments of 2026-09-11.** (1) **Sync now and Pause / Resume belong to
every source, not only a site**: a repository source is normally refreshed by
its push, but one that has never synced, or whose push was lost, is still
refreshed by hand. Remove stays site-only — a repository source goes when the
repository is disconnected. (2) **The sweep syncs what never synced**:
`listDueContextSites` becomes `listDueContextSources` and returns every
non-paused site older than the age given PLUS every non-paused source of any
kind whose `lastSyncAt` is null, and the server runs one sweep AT BOOT (right
after the queue starts) beside the hourly interval, so a migrated or lost
source gets its first sync instead of waiting for an event that never comes.
A restart loop cannot become a fetch storm: the enqueue is single-flight per
source and a sync that lands moves `lastSyncAt` out of the next sweep.

**Context › Conflicts.** Every conflict of the workspace corpus, open first;
Add filter over Status and Area; a row opens the existing resolver, on
Context's side. Resolving writes the workspace decisions.

**The document page** (`/preview/context/doc/<ref>?repo=`). The EXISTING
coverage page, read through one repository (the worst one by default);
when several read it, chips in the header switch. A Not linked document
opens as the plain document with its source and the repositories it could
be linked to. Crumbs `Context › <source> › <document>`.

**Add context.** Step 1: the kind. Rows: Repository, Documentation site,
then the six tool kinds each with a lock and "Coming soon" (not
selectable). Step 2: the scope. Repository: pick the repository and edit
its patterns (a repository that already has its source shows that source
instead). Site: the llms.txt URL. **Check** runs the real preview (the
count and the first titles) before anything is stored. Step 3: the
repositories that read it, default none. **Add and sync** stores the
source, binds, syncs with progress, and closes on the Documents view
narrowed to the new source.

**The repository's Context tab** (setup group; replaces Sources). One list
of every workspace source in one order, a Linked toggle per row for this
repository, the source's title linking to the narrowed Documents view, its
status word, kind, document count and last sync. Toggling relinks and
marks the corpus stale (the scan recomputes the slices; Test generation
follows on the ripple). No Rescan here: the scan starts on Context. Add
context links to Context.

**Home** keeps reading the repositories' stored summaries as it does on
main; the product owner's Home is Phase 2. The connect dialog gains no
Context step in this slice (bindings are set on the Context tab or in the
add dialog); the plan's step is Phase 1b.

**Settings.** No Connections tab in this slice: there is no connector to
connect. The Integrations tab stays as it is on main.

**Notifications** (decided 2026-09-11; `/preview/notifications`). The feed
is the SERVER's notification store, the one every job posts into when it
settles (`GET /api/notifications`, `POST /api/notifications/read`, the
`notification` frame on `/api/events`), read as it is stored. Nothing is
derived on the client any more: no row for a run starting (a run in flight
is on the Agent page), no session-local read state, and the workspace scan
and the source syncs appear because the store has them. One table, newest
first, the shell's index table: Notification (the title, then the body
muted on the same line, truncated), Repository (mono, 14rem; blank for a
workspace event), Status (8rem; the level as a status word: success Done,
warning Needs you, error Failed, info Note), When (7rem, relative). An
unread row carries its title in the foreground weight, a read one muted;
no dot. The search matches title and body; the one Add-filter row over
Read (Unread, Read), Status, Repository, all in the address
(`?read=&status=&repo=`). Mark all read sits in the header while anything
is unread. Opening a row marks it read and goes where the event happened:
the run's conversation (`agent/<runId>`) for a setup, a generation or a
scan; the repository's run page (`repos/<slug>/runs/<guardRunId>`) for a
flow run; the source's page for a sync; a row with no address stays put.
The sidebar badge is the store's unread count.

Every job's notification carries its address in `data` beside the `jobId`
the harness adds: `repoFullName` and `runId` (the session run id) for a
setup and a generation; `repoFullName` and `guardRunId` for a flow run;
`runId` for the scan (captured from `onRunStarted`; absent when the probe
died before a run opened); `sourceId` and `sourceTitle` for a sync. The
titles say what happened in the product's words: Flow setup complete /
Flow setup did not complete / Flow setup failed; Flows generated / Flows
generated, findings to review / Flows up to date / Flow generation blocked
/ Flow generation failed; Flows passed / Flows ran, failures to review /
Flow run failed; Documents scanned / Documents scanned, conflicts to
resolve / Document scan failed; Source synced / Source sync failed. The
body is the fact alone (the counts, the reason), never prefixed with the
repository or the source, since the row's own column names it. No dashes
in either.

**Settings › Members** (decided 2026-09-11). The workspace's people are its
WorkOS organization's memberships, read live, never a roster written here.
The tab is the Settings list idiom (the rows of Repositories and
Connections): the full-width search, then one row per member and one per
open invitation, each row the person's name (an invitation has only its
email), the email muted, a status word (Member; Invited; Expired for an
invitation past its date), when (joined, or invited), and at the right
edge the row's one action: Remove for a member (never for yourself, never
for the last member), Revoke for an invitation, plus Copy link on an
invitation so the address reaches someone whose mail did not. Invite
member sits in the tab's header line as the Repositories tab's Add
account does: one dialog, one field (the email), Send. The invitation is
WorkOS's (`sendInvitation`, seven days, the signed-in user as inviter),
and WorkOS mails it. An invited person who signs in with a membership but
an org-less session is put INTO that organization by the session probe
(`GET /api/auth/me`) and by the workspace-naming route, so accepting an
invitation never creates a second workspace.

Server: `GET /api/workspace/members` (members with name, email, joined,
whether it is you; invitations with email, state, expiry, the accept
address), `POST /api/workspace/invitations` (email; refused for a member
or an open invitation), `DELETE /api/workspace/invitations/:id`,
`DELETE /api/workspace/members/:id`. All behind the auth gate, scoped to
the session's organization, on the auth layer's WorkOS client.

**Workspaces** (decided 2026-09-11). A workspace is a WorkOS organization
the signed-in user is a member of, and the session is minted into one of
them. The workspace badge at the top of the side menu becomes the
SWITCHER, in the badge's place: the current workspace's initial and name
with a chevron; opened, the user's workspaces one per row (initial, name,
the current one in the foreground weight and the others muted), then a
last row, Create workspace. Choosing another switches the session into it
and reloads the app at the section root (everything is the organization's,
so the shell starts over rather than re-reading piecemeal). Create
workspace is one dialog, one field (the name), Create: the server creates
the organization, adds the user as its first member, mints the session
into it, and the app reloads into the new, empty workspace. The collapsed
menu shows the initial alone; it opens the same list.

Server, on the auth router: `GET /api/auth/workspaces` (the user's active
memberships as `{ id, name, current }`, names read through the same cache
`/me` uses), `POST /api/auth/workspaces` (`{ name }`; always creates, unlike
the onboarding `POST /api/auth/workspace`, which keeps its no-op guard for a
user already in one), `POST /api/auth/workspaces/switch`
(`{ organizationId }`; 404 unless the user has an active membership there;
refreshes the session into it and sets the cookie). Shared types
`WorkspaceSummary`, `WorkspacesResponse`.

**Home** (decided 2026-09-11; the product owner's dashboard of
`docs/PRODUCT_OWNER_PLAN.md` §8 as the mock on `sm/product-owner` last read
it, built only from what the product holds). Layout: the page header
(Home, no page action), the hero SECTIONS OVER TIME full width, then a grid
of equal widgets: Needs attention, Areas, Recently changed. No Written
here (nothing is written here yet), no Out of date (nothing adjudicates a
failure as drift yet), no inferred documents, no session that waits on a
question (no real session does; a conversation that ended failed or
interrupted takes that place), no pull-request attribution on a change
(Home reads baseline runs only): five words, in the order
Proved, Failed, Blocked, Not testable, Not run, with the plan's colours
(green, red, the darker blue, grey, the lighter blue). The sections
counted are those of documents LINKED to at least one repository, each
section's status folded worst-first across the repositories that read it;
an unlinked document is nobody's promise and is off Home.

The chart is the mock's `preview/ui/stacked-area.tsx`, copied, never
redesigned: the workspace's sections by status across time, one point per
baseline run of any repository, the value at each point the fold across
every repository's latest baseline run at that moment; periods 7d, 30d,
90d, All as the filter idiom's chips on the readout row; the readout at
rest is today's tally and its words open Documents narrowed to that
status. A workspace with one run draws one point.

Needs attention: one list, four-corner rows, each a door, newest first:
a conversation that ended failed or interrupted, when it is the LATEST run
of its kind on its repository (a later success clears it), opening the
conversation; every open conflict, opening the conflict page; every
document whose folded status is Blocked, with its blocked count and the
first reason as the fact, opening the document; a source whose last sync
failed, opening the source page; and, when the workspace has no usable
LLM provider, one row opening Settings › Models. Nothing else: no finding
counts, no invented rows.

Areas: one composition strip per area, full width, the name left and the
dot-word counts right, sorted by the share of Failed and Blocked, opening
Documents narrowed to the area.

Recently changed: documents whose folded status changed at a baseline run
in the chart's period, grouped Today, Yesterday, Earlier, each row saying
what happened (Failed, Proved, Blocked, Not testable, First read) and
when, opening the document.

Server: SECTION HISTORY. Every stored baseline run gains a section
summary, `{ sectionRef: status }` over the document sections of the
scenario set it ran, written when the run is persisted; runs stored
without one are backfilled once (a boot sweep, from the run's own stored
scenario set and report) and a run whose summary cannot be derived is left
out of history and logged, never guessed. One read, `GET /api/home?period=`,
composes today's tally, the trend, the areas, the attention rows and the
changes, workspace-scoped; the folds share the document-status code the
Documents view uses (`core/src/services/context/documents.ts`).

**Home onboarding** (decided 2026-09-12). Until the workspace has BOTH a
context source and a connected repository, Home is not the dashboard: it
is two checkpoints, in this order, "Connect your first context" and
"Connect your first repository". Each is a row in the Settings list
idiom: a mark (a check when done, the step's number when not), the
title, one line saying what it gives the workspace, and at the right
edge the row's action (Add context, opening Add context on Context;
Connect repository, opening Code's connect dialog) while it is not done,
or the status word Done once it is. The action of the next checkpoint to
do is the primary button; the other is the bordered one. A checkpoint is
done when the workspace has at least one context source of any kind, or
at least one connected repository; the user may do them in either order.
When both are done the checkpoints go and Home is the dashboard, even
before anything has run. Until the two reads that decide this have both
landed, Home draws nothing, so the checkpoints never flash on a
workspace that has everything. Add context opens from the checkpoint by
address (`context?add=1`, the kind step; `context?add=repository` stays
the install's return), and Connect repository by `code?connect=1`.

**Retired surfaces.** The repository console's Corpus tab and its document
and conflict pages, the Sources tab and source page, the Coverage tab's
corpus reads, and every Rescan in the console (the scan starts on Context).
The console lands on Tests.

## 6. Storage (hosted)

New tables, workspace-scoped:

- `context_sources` (workspace_org_id, id, kind, title, config jsonb, status,
  status_note, last_sync_at, created_at, updated_at)
- `context_syncs` (workspace_org_id, source_id, at, parent_at, added, changed,
  removed, unchanged)
- `context_documents` (workspace_org_id, source_id, doc_id, doc_path, title,
  url, content_hash, updated_at, created_at) — the ledger; bodies in
  `content` under scope `context:ws:<org>` by content hash
- `context_bindings` (workspace_org_id, repo_full_name, source_id)

Reused: `workspace_spec_sets` (corpus, decisions, docs snapshot) under
`spec:ws:<org>`; `decisions` with scope `ws:<org>`; `activity_runs` with the
workspace as the run's key. Retired: `spec_sources`, the per-repository
`spec_sets` (a migration turns each connected repository's registered sites
into workspace sources bound to that repository and creates its Repository
source; the per-repository corpus is not converted, the first workspace
scan replaces it; per-repository decisions are folded into the workspace
decisions where their subjects still exist).

Purge on disconnect removes the repository's bindings and its Repository
source's documents when nothing else binds that source; a site's bodies
live as long as the source.

File mode (the CLI) is a one-repository workspace and is untouched in this
slice: its scan still reads the tree and the registry it has.

## 7. Server

A workspace router mounted above the repository routers:

- `GET /api/context/sources`, `POST /api/context/sources` (kind, config,
  repoIds), `POST /api/context/sources/preview`, `POST .../:id/sync`,
  `POST .../:id/pause`, `DELETE .../:id`
- `GET /api/context/documents?area=&status=&source=&repo=` — the rows of
  the Documents view, composed on the server from the workspace corpus, the
  bindings and each repository's stored coverage
- `GET /api/context/corpus`, `GET /api/context/doc?ref=`, the decisions
  routes (includes, excludes, conflict-resolution) at workspace scope
- `GET|PUT /api/repos/:id/context/bindings`
- `POST /api/context/scan` — the workspace Document scan; `/api/repos/:id/spec/corpus/scan` retires

Jobs: `context.sync` (per source, single-flight per source), `context.scan`
(per workspace, coalescing), the ripple into `repo.guard-generate`. The
GitHub webhook's push on the default branch enqueues `context.sync` for the
repository's source.

## 8. Engine

- The scan engine gains a universe mode: "these documents are the
  universe" (the scratch tree of materialized sources), with discovery's
  walk replaced by the sources' listings and the ref grammar of §3.
- The Repository source's sync IS today's discovery walk plus the patterns,
  factored out of the scan into a sync driver beside the llms.txt fetcher.
- The relevance briefing takes a workspace identity (§4).
- Corpus documents carry their source (`sourceId`, `kind`) in the artifact,
  not as a read-time enrichment.
- The generate's materialization reads the slice (§4). Claims, flows and
  scenarios key on the new refs; existing hosted scenario sets regenerate.

## 9. Slices of work (each lands green)

STATUS 1 — LANDED, `9fc2772e` (storage, the source drivers, `context.sync`, the migration).
STATUS 2 — LANDED, `93267525` (+ `f49d0c5f`): the workspace scan, the slice, the ripple.
STATUS 3 — LANDED, `0128b87d`: Context, Conflicts, the document page, Add context, the repository Context tab.
STATUS 4 — DONE, uncommitted in the `context-page` worktree: the retirements.
STATUS 5 — LANDED, `df14524b`: Notifications over the server store.
STATUS 6 — IN PROGRESS (2026-09-11): Settings › Members with invitations.
STATUS 7 — QUEUED (2026-09-11), on the same agent after 6: the workspace switcher and Create workspace.
STATUS 8 — LANDED, `e870c7a2` (+ strip and widget layout): Home.
STATUS 9 — IN PROGRESS (2026-09-12): Home onboarding checkpoints.

1. **Storage and sync**: the four tables and stores; the source drivers
   (site re-homed, repository sync); `context.sync`; the migration.
2. **The workspace scan**: universe mode, the scratch tree, the workspace
   run record, the ripple; the generate reading the slice; retiring the
   per-repository scan job.
3. **The pages**: Context, Conflicts, the document page, Add context, the
   repository Context tab; the retirements in the console; the Agent page
   showing the workspace scan.
4. **Cleanup**: routes, client API, README, docs.
5. **Notifications**: the page over the server's store, the jobs'
   notification words and addresses, the shell badge; the derived feed and
   its session-local read state retired.
6. **Members**: the workspace's memberships and invitations from WorkOS,
   the invite dialog, remove and revoke, the accept path into the org.
7. **Workspaces**: the switcher in the side menu, Create workspace, the
   switch and create routes on the auth router.
8. **Home**: section history on stored runs, the one home read, the page
   from the mock's components.

## 10. Open

- (decided 2026-09-10) The Documents view shows every document, one row
  each, status folded across its repositories, Not linked for none.
- The "Since" column (the time the status last changed) waits for run
  history to record section transitions; "Updated" stands in.
- Out of date, Inferred, Written here, the connect dialog's Context step,
  Settings › Connections: later slices.
