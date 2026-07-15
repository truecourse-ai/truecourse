# EE Jira Connector — workspace Knowledge from Jira issues

Status: **IMPLEMENTED (uncommitted, worktree `jira-integration`).** This is the
implementation contract for the Jira connector (docs/EE_KNOWLEDGE_PLAN.md
Phase 5, first entry). Built and green: the connector + ADF converter, the
`optional`/`fetchMany` seam extensions, the sweep/estimate engine + job, the
two-button **Sync now / Process** flow with the persisted `pending` record
(migration `0003`), and the test suites
(`tests/ee-server/jira-connector.test.ts`,
`tests/ee-server/knowledge-sync-estimate.test.ts`,
`tests/ee-server/knowledge-sync-pending.test.ts`,
`tests/dashboard-client/integrations-page.test.tsx`).

Base branch: **`sm/spec-guards-ee`** (PR #743 — Guard Phase 8 EE adaptation;
rebased 2026-07-14 from `claude/spec-coverage-local-skills`). That base retired
verify/drift and moved enforcement to the guard (spec → scenario) pipeline; it
had also retired the EE knowledge sync engine (`knowledge/{sync,index}.ts`,
`PgKnowledgeStore`, the knowledge job kinds), which THIS branch re-introduces —
re-mounted in `ee/packages/server/src/index.ts`, store re-exported from
`ee-data-store`, migration regenerated as `0007` (pending column only; the
latent upstream `verify_snapshots` drop was deliberately NOT bundled). The
processing stage still runs `syncWorkspaceCorpusInProcess` (curate over a
transient scratch tree — corpus-only; workspace contract generation was removed,
see the Knowledge-page plan); the verify-era "re-verify repos on
contract change" ripple was dropped with verify itself — the guard-era
workspace ripple is part of the upcoming Knowledge-on-Spec/Guard work. Per-doc
LLM caches survive the ephemeral scratch scope by design — keys fold
`(prompt fingerprint, relative docPath, contentHash)`, so unchanged docs hit
across syncs (see the cache note in `relevance-filter.ts`).

## Context

Enterprise requirements live in Jira issues (epics/stories with descriptions and
acceptance criteria) at least as often as in Confluence pages. The
`KnowledgeConnector` seam (`ee/packages/server/src/knowledge/connectors/types.ts`)
was built for exactly this: a connector's only job is `test()` / `list()` /
`fetch()` + self-describing `fields[]`; everything downstream (the corpus
pipeline over a transient scratch tree, the content-keyed LLM caches, the
provenance ledger) is source-agnostic. `'jira'` is already in `ConnectorKind`.

What Jira adds that Confluence didn't:

1. **Granularity + scale** — a project has hundreds–thousands of small issues,
   not tens of large pages. Per-issue HTTP fetch (the Confluence pattern) means
   an N+1 sync and guaranteed 429s; the doc set needs a sensible default filter
   so the first sync's relevance-filter LLM cost isn't paid for every bug ticket.
2. **ADF bodies** — Jira Cloud v3 returns rich text as Atlassian Document Format
   (a JSON node tree), not XHTML. It needs its own deterministic converter
   (`renderedFields` HTML is NOT an option — it renders dates/mentions per user
   locale, which breaks the byte-identical-markdown requirement that keeps
   unchanged issues at 0 LLM cost on re-sync).

## Locked decisions

- **One doc per issue.** No epic-grouped documents (Deferred). `docPath` =
  `knowledge/jira/<issueId>.md` via the existing `connectorDocPath`.
- **`externalId` = the immutable numeric issue id**, not the key (keys change on
  project-key rename / issue move; the ledger prune/upsert must not churn).
  The key stays visible in the title, H1, and URL.
- **Doc content = summary + description only.** Title `"<KEY>: <summary>"`;
  markdown starts with `# <KEY>: <summary>` (same H1 trick as Confluence — every
  doc has a slice anchor even when the description has no headings), followed by
  the ADF-converted description. Comments, changelogs, attachments, and linked
  issues are excluded (churn + noise). AC custom fields: Deferred.
- **Sync ALL issues; classification decides what's spec.** No time filter, no
  issue-type filter beyond excluding sub-tasks (work-tracking fragments of their
  parent, never standalone requirements). Base JQL is
  `project = "<projectKey>" AND issuetype in standardIssueTypes()`. The
  relevance filter (the classify stage) is the mechanism that separates
  spec-bearing issues from noise — NOT JQL. The **optional `jql` field** remains
  as an escape hatch (`project = "<projectKey>" AND (<jql>)`) but the
  out-of-box behavior is everything. Always `ORDER BY created ASC` (stable
  enumeration). The field is a *filter* — it must not contain its own `ORDER BY`
  (the parenthesization makes that a loud JQL error, not a silent misparse).
- **Sync is two-staged: estimate, then classify+consolidate.** Because the
  default scope is "everything", the LLM stage gets a cache-aware pre-flight
  estimate (the OSS scan-estimate pattern) shown BEFORE it runs. See
  "Two-stage sync" below. This is engine-generic — Confluence gets it for free.
- **Batched fetch, not N+1.** The seam gains an *optional* `fetchMany` (see Seam
  extensions); Jira implements it with one search call per 100 issues
  (`id in (...)` + `fields=description,...`), turning a 2 000-issue sync from
  ~2 001 requests into ~21. Confluence is untouched (no `fetchMany` → engine
  falls back to per-doc `fetch`, exactly today's behavior).
- **429-aware HTTP.** Jira Cloud rate-limits aggressively; the connector's HTTP
  helper retries 429 (and 503-with-Retry-After) honoring `Retry-After`, bounded
  attempts. Kept inside `jira.ts` — not generalized until a second connector
  needs it.
- **Change marker = `fields.updated`.** Jira has no version counter; the
  `updated` ISO timestamp is bumped by every edit. It becomes both
  `DocRef.version` (ledger/UI) and `DocRef.updatedAt` (feeds `lastTouched` /
  newest-wins). Note the sync engine intentionally never diffs on it (whole-set
  re-consolidate; the extraction cache makes unchanged docs free).
- **Jira Cloud only**, Basic auth (`accountEmail:apiToken`) — identical to
  Confluence. Server/DC: Deferred.

## Config fields

Same Atlassian credential shape as Confluence, plus the optional filter:

| key            | label            | type     | notes                                        |
| -------------- | ---------------- | -------- | -------------------------------------------- |
| `baseUrl`      | Site base URL    | text     | `https://your-site.atlassian.net`            |
| `projectKey`   | Project key      | text     | e.g. `ENG`                                   |
| `jql`          | JQL filter       | text     | **`optional: true`** — placeholder shows the default (`issuetype in standardIssueTypes()`) |
| `accountEmail` | Account email    | email    |                                              |
| `apiToken`     | API token        | password | `secret: true` (exactly one secret)          |

## API surface

Use the **enhanced search endpoint** `/rest/api/3/search/jql` with
`nextPageToken` pagination everywhere. Do NOT use `/rest/api/3/search` +
`startAt` — it was removed from Jira Cloud in 2025 (training-data muscle memory
will suggest it; it 410s).

- **`test(cfg)`** — the same read the sync uses, limit 1:
  `GET /rest/api/3/search/jql?jql=<base JQL>&maxResults=1&fields=summary`.
  A passing Test ⇒ Sync will work (bad project key surfaces here as a 400).
- **`list(cfg)`** — page through
  `GET /rest/api/3/search/jql?jql=<base JQL>&maxResults=100&fields=summary,updated[&nextPageToken=…]`
  until `nextPageToken` is absent (or a page returns no issues — defensive stop,
  like Confluence). Map each issue →
  `DocRef { id: issue.id, title: "<key>: <summary>", url: "<siteBase>/browse/<key>", version: fields.updated, updatedAt: fields.updated }`.
- **`fetchMany(cfg, ids)`** — one call per chunk (engine chunks by
  `fetchBatchLimit = 100`):
  `GET /rest/api/3/search/jql?jql=id in (…) ORDER BY created ASC&maxResults=100&fields=summary,description`.
  Returns `Map<id, DocContent>`; an id missing from the response (issue deleted
  mid-sync) is simply absent — the engine drops it and the reconcile prunes its
  derived claims.
- **`fetch(cfg, id)`** — `GET /rest/api/3/issue/<id>?fields=summary,description`.
  Required by the interface; the engine prefers `fetchMany` but `fetch` must
  work standalone.

**Errors.** Jira's error body is `{ errorMessages: string[], errors: {} }` — NOT
Confluence's `{ message }`. `describeError` for Jira: 401 → "Authentication
failed — check the account email and API token."; 403 → first `errorMessages`
entry or "Access denied — this account may not have Jira access."; 400 (bad
project key / bad JQL) → joined `errorMessages` (this is where "The value 'X'
does not exist for the field 'project'" surfaces); otherwise generic with
status. Throw `UpstreamHttpError` (status rides to Sentry via
`upstreamStatusOf`). Never leak the token, the JQL, the request path, or raw
JSON into the message (tested, same as Confluence).

## ADF → markdown (`adf-to-markdown.ts`)

Dependency-free, **DETERMINISTIC** walker over the ADF node tree — same ADF must
always yield byte-identical markdown (block ids are
`sha256(docPath + headingPath + text)`; any nondeterminism = cache miss = LLM
cost for unchanged issues). Mirrors the philosophy of `html-to-markdown.ts`:
headings preserved (the slicing anchors), everything else readable text.

Node handling (`adfToMarkdown(doc: unknown): string`):

- `heading` → `#`×`attrs.level` + inline content. **Demote by one level** (H1 →
  H2, H6 stays H6): the issue H1 is reserved for the `# KEY: summary` line so
  in-description headings never collide with the doc anchor.
- `paragraph` → line; `hardBreak` → `\n`; `rule` → `---`.
- `bulletList`/`orderedList`/`listItem` → `- ` items (nesting flattened, like the
  Confluence converter). `taskList`/`taskItem` → `- [ ]` / `- [x]` (attrs.state).
  `decisionList`/`decisionItem` → `- `.
- `codeBlock` → fenced block with `attrs.language` when present.
- `blockquote` → `> ` per line. `panel` / `expand` / `nestedExpand` → inner
  content kept, wrapper dropped (expand `attrs.title` becomes a `**bold**` line).
- `table`/`tableRow`/`tableCell`/`tableHeader` → one line per row, cells joined
  with ` | ` (no header separator — deterministic and readable; AC often lives
  in tables, so cell separation matters).
- `text` with marks: `strong` → `**…**`, `em` → `_…_`, `code` → `` `…` ``,
  `link` → `[text](href)`; other marks (underline, strike, color…) → plain text.
- Inline atoms — from attrs, never locale-rendered: `mention` → `@attrs.text`
  (strip a leading `@` in attrs first, then prepend one), `emoji` →
  `attrs.shortName`, `status` → `attrs.text`, `inlineCard` → `attrs.url`,
  `date` → `attrs.timestamp` (epoch ms string) formatted `YYYY-MM-DD` in UTC.
- `mediaSingle`/`mediaGroup`/`media` → dropped (text-only corpus).
- **Unknown node type → recurse into `content`, emit text leaves.** Never throw
  on unrecognized nodes (ADF grows; a new node type must not fail a sync).
- Output normalization identical to the Confluence converter: collapse 3+
  newlines to 2, strip trailing spaces, trim.

Empty/absent description → the doc is just the `# KEY: summary` H1 (the
relevance filter drops it if there's nothing spec-worthy — cached, so it's a
one-time cost per content).

## Two-stage sync: estimate, then classify+consolidate

> **Superseded by EE_SYNC_STORE_PLAN.** Stage 1 ("Sync now", `syncSource`) now
> also PERSISTS every fetched body (content-addressed in the shared `content`
> table, keyed by the ledger's `contentHash`) and reconciles the ledger, so
> Sources fills the moment a sync completes. Stage 2 (Process) consolidates the
> STORED union with no connector I/O — it no longer re-fetches. "Nothing is
> persisted by this stage" below applies only to the estimate's scratch tree, not
> to the bodies. `syncWorkspaceKnowledge` (the old single-connector fetch→
> consolidate helper) was removed.

Today `syncWorkspaceKnowledge` is one job: fetch everything → consolidate, with
no cost visibility up front. That's fine for a 40-page Confluence space; it is
not fine for a 10 000-issue first sync. Split it:

- **Stage 1 — Estimate (no LLM).** One paginated sweep (for Jira, the SAME
  search calls as list+fetch — `fields=summary,updated,description`), bodies
  held transiently. Materialize the same transient scratch tree stage 2 uses,
  then run the EXISTING cache-aware scan estimator against it —
  `estimateScanTokens` (`packages/core/src/services/llm/spec-estimate.ts`),
  which reads the real relevance/area-tag caches via
  `readRelevanceCache`/`isAreaTagCached`. The cache keys are scope-independent
  (prompt fingerprint + relative docPath + contentHash), so the ephemeral
  scratch scope sees exactly what stage 2 will hit. Alongside, diff content
  hashes against the provenance ledger for the `N new / M changed / K removed of
  T total` subject line. Then DELETE the scratch tree — nothing is persisted by
  this stage. Do not diff on Jira's `updated` — it bumps on any field change
  (status, assignee) and over-counts; the content hash is exact. One inherent
  limit: a non-empty delta auto-chains scenario (guard) generation after the
  scan, which this estimate doesn't price — so it sets `costPartial: true` (the
  modal renders `$X+` / "priced stages only") instead of implying a ceiling it
  can't guarantee.
- **Stage 2 — Run (LLM).** On user confirm: re-fetch (stateless — bodies are
  never held across the confirmation boundary) and run the existing
  `syncWorkspaceCorpusInProcess` + ledger-reconcile path unchanged. Unchanged
  docs are cache hits, as today.
- **Flow — two explicit buttons, workspace-visible state** (supersedes the
  earlier auto-modal design; a 10k sweep is minutes of HTTP, so nobody should
  have to babysit a page waiting for a modal):
  - **"Sync now"** dispatches the sweep job (`knowledge.estimate`, via the jobs
    infra). While it runs, the row shows **"Syncing…"** — derived from the
    org-scoped active-jobs state, so it survives refreshes and is visible to
    EVERY user in the workspace (the SSE hub fans out per org). On completion
    a toast lands (org-wide notification) naming the DELTA ONLY — the cost is
    seen/confirmed at Process time, never at sync time:
    - delta EMPTY → "up to date — nothing to process"; any stored pending
      record is cleared.
    - delta non-empty → "Sync complete — <subject> to process.", and the
      sweep persists a **pending record** per (org, kind): the delta, the
      FULL `LlmEstimate` (stages/tokens/cost — computed quietly during the
      sweep, while the bodies are in hand; recomputing at Process-click would
      re-download the whole source and stall the confirm for minutes), and
      sweptAt. NOT the bodies — Process re-fetches internally.
    - The sweep endpoint must NOT gate on `isLlmConfigured` — it makes no LLM
      call and needs no provider (bundled prices suffice for the ceiling).
      The process endpoint keeps the gate.
  - **"Process"** renders only while a pending record exists, with the delta
    summary (subject line, no cost) beside it. Click opens the OSS
    `LlmEstimateModal` INSTANTLY with the STORED estimate (no re-sweep);
    **Confirm** dispatches the processing job (`knowledge.sync` — the existing
    fetch+consolidate job), **Cancel** closes. A stored estimate
    with NO LLM stages (e.g. removed-only pruning) skips the modal and
    dispatches directly — the explicit Process click is consent enough for
    free work. While the job runs the row shows **"Processing…"** (same
    org-scoped mechanics); on success the job clears the pending record.
    Processing is never silent or automatic.
  - Pending staleness is fine by design: the sweep's numbers are a snapshot;
    Process always re-fetches and consolidates CURRENT source truth, and a
    re-click of "Sync now" overwrites the pending record.
- Both stages are **engine-generic** (they use only `list`/`fetchMany`/`fetch`),
  live in the sync engine, and apply to every connector. No connector-specific
  estimate code.

## Seam extensions (generic, not Jira-specific)

1. **`ConnectorField.optional?: boolean`** (`connectors/types.ts`). The server
   already tolerates absent non-secret fields (`splitValues` keeps only
   non-empty values); the one gap is `IntegrationsPage.tsx` `hasConfig`, which
   currently requires EVERY non-secret field before showing "configured" — it
   must skip `optional` fields.
2. **Optional batched fetch** (`connectors/types.ts` + `sync.ts`):

   ```ts
   /** Max ids per fetchMany call. Present iff fetchMany is implemented. */
   readonly fetchBatchLimit?: number;
   /** Batched fetch. Missing ids (deleted upstream mid-sync) are simply absent. */
   fetchMany?(cfg: Cfg, ids: string[]): Promise<Map<string, DocContent>>;
   ```

   `syncWorkspaceKnowledge` prefers it when present: chunk `refs` by
   `fetchBatchLimit`, call per chunk, advance the per-doc progress counter by
   chunk; refs absent from the result are skipped (→ reconcile prunes them).
   No `fetchMany` → the existing per-ref `fetch` loop, byte-for-byte the same
   behavior for Confluence.

## Files

New:
- `ee/packages/server/src/knowledge/connectors/jira.ts` — config, HTTP helper
  (Basic auth + 429 retry + `describeError`), `test`/`list`/`fetch`/`fetchMany`,
  field metadata.
- `ee/packages/server/src/knowledge/connectors/adf-to-markdown.ts`
- `tests/ee-server/jira-connector.test.ts`

Modified:
- `ee/packages/server/src/knowledge/connectors/types.ts` — `optional` on
  `ConnectorField`; `fetchBatchLimit`/`fetchMany` on `KnowledgeConnector`.
- `ee/packages/server/src/knowledge/connectors/registry.ts` — add the entry
  (the only per-connector registration step).
- `ee/packages/server/src/knowledge/sync.ts` — the `fetchMany` fast path +
  `estimateWorkspaceSync` (the engine-generic Stage 1).
- `ee/packages/server/src/knowledge/index.ts` — estimate endpoint beside the
  existing sync endpoint.
- `ee/packages/server/src/jobs/worker.ts` — sweep job (`knowledge.estimate`,
  popup title "Syncing knowledge") persists/clears the pending record + posts
  the completion toast; processing job (`knowledge.sync`, retitled
  "Processing knowledge") clears pending on success.
- `ee/packages/db` — `pending` jsonb column (nullable) on
  `integration_connections` + migration. The one schema change; holds the
  `IntegrationPendingView` payload (see `packages/shared/src/types/ee.ts`),
  never bodies.
- `ee/packages/server/src/integrations/store.ts` — read/write/clear `pending`;
  `getView` returns it (`IntegrationConnectionView.pending`).
- `ee/packages/client/src/IntegrationsPage.tsx` — `hasConfig` skips `optional`
  fields; per-row **Sync now** ("Syncing…" while the sweep job is active) +
  **Process** (rendered from `connection.pending`, "Processing…" while the
  processing job is active, pending summary shown beside it). Job-settled
  events reload the view; toasts arrive via the org-wide notification feed.

No consolidator changes; the only schema change is the `pending` column.

## Tests (`tests/ee-server/jira-connector.test.ts`, mirroring the Confluence suite)

- `adfToMarkdown`: heading demotion + level preservation, lists/task lists,
  marks, code blocks, table rows with ` | ` cells, mention/status/date/emoji
  from attrs, unknown-node recursion (no throw), determinism (same ADF →
  byte-identical), empty/absent description.
- `list()`: `nextPageToken` pagination across pages; `DocRef` mapping (numeric
  id, `KEY: summary` title, `/browse/` url, `updated` as version+updatedAt);
  default JQL contains `standardIssueTypes()`; the `jql` field is ANDed in
  parentheses.
- `fetchMany()`: chunking contract (≤100 ids), map keyed by id, missing id
  absent (not an error); `fetch()` single-issue path.
- Errors: 401/403/400 messages from `errorMessages[]`; no token/JQL/raw-JSON
  leak; `UpstreamHttpError.status` preserved; 429 retried honoring
  `Retry-After`, bounded.
- `test()`: ok on 200; friendly error on 400 bad project key.
- Field metadata: exactly one secret (`apiToken`); `jql` marked `optional`.
- `sync.ts` fast path: a stub connector with `fetchMany` gets chunked calls +
  correct progress; a connector without it uses per-doc `fetch` (Confluence
  regression guard); a ref missing from `fetchMany`'s result is pruned from the
  ledger.
- `estimateWorkspaceSync`: new/changed/removed counted by content hash against
  the KV caches + ledger (an issue whose `updated` bumped but whose content is
  unchanged counts as a cache hit — the over-count guard; a doc reverted to
  previously-cached content costs 0 despite a ledger-hash change); a
  removed-only delta reports zero LLM cost but a non-empty delta (still
  surfaces a Process button — pruning must run); estimate persists nothing (no
  ledger writes, no cache writes); works against a `fetchMany`-less stub
  connector too.
- Sync/Process flow: sweep job persists the pending record (delta + full
  estimate) on a non-empty delta + posts the delta-only toast, clears it (and
  toasts "up to date") on an empty one; the sweep endpoint works with NO LLM
  provider configured; processing job clears pending on success and keeps the
  provider gate; `getView` returns `pending`. Client: Process renders only
  with `pending` (delta summary, no cost); Process click opens
  `LlmEstimateModal` from the stored estimate, Confirm dispatches processing,
  a no-stage estimate skips the modal and dispatches directly; Sync/Process
  busy states derive from the org's active jobs (refresh/workspace-safe).

## Deferred

- **AC custom fields** — many teams keep acceptance criteria in a custom field;
  reading it needs a per-workspace field id (or name-based discovery). Add an
  optional config field later if description-only proves insufficient.
- **Epic-grouped docs** — one doc per epic with child issues as sections (bigger
  docs, better cross-issue context for the consolidator; worse ledger
  granularity + orphan handling).
- **Comments** as spec addenda; **Jira Server/DC** (PAT auth, different search
  API); **webhook-triggered sync**.

## Open questions (for review)

- Is `# KEY: summary` right, or summary-only H1 (keys in headings end up quoted
  in extracted claims/contract provenance — arguably useful, arguably noise)?

Decided (2026-07-07): sync everything (all issue types except sub-tasks, all
statuses, no time filter) — classification is the gate, not JQL; and sync is
two-staged so the classify stage shows a cost estimate before running.
