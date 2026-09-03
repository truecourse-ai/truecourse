/**
 * Workspace Knowledge — the Spec tab's corpus read + decision writes (enterprise,
 * org-scoped). The object shapes mirror the repo `/spec/*` routes
 * (apps/dashboard/server/src/routes/spec.ts) so the reused corpus components render
 * the workspace corpus unchanged; the differences are all about SCALE:
 *
 *   - `GET /spec/corpus` returns kept docs + a skipped SUMMARY (never the full
 *     skipped array — a project can have thousands of dropped bug tickets).
 *   - `GET /spec/skipped` pages the skipped docs behind the "Not included (N)"
 *     expander, with search + reason filter.
 *   - `GET /spec/doc` reads one doc's STORED body via the ledger row (the body
 *     Sync persisted, content-addressed); 404 for an unknown ref.
 *   - the decision writes (includes / excludes / conflict verdicts)
 *     persist the `'decisions'` artifact, then — ONLY once no conflicts remain
 *     open — enqueue the workspace processing job (best-effort — a full queue
 *     never fails the write). Resolving a batch of conflicts one by one thus
 *     re-processes exactly once, on the last verdict (the EE analog of OSS's
 *     "resolve all → Rescan" — there is no scan button here, so it fires
 *     itself). The corpus GET also folds the decisions at read time, so
 *     verdicts render instantly without waiting for the re-process.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { openConflicts, type AuthUser, type KnowledgeSkippedSummary } from '@truecourse/shared';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  getWorkspaceDecisions,
  addWorkspaceManualInclude,
  removeWorkspaceManualInclude,
  addWorkspaceManualExclude,
  removeWorkspaceManualExclude,
  addWorkspaceConflictResolution,
  removeWorkspaceConflictResolution,
  type ConflictResolution,
  type CuratedCorpus,
  type DecisionsFile,
} from '@truecourse/core/commands/spec-in-process';
import { PgKnowledgeStore, ActiveJobExistsError } from '@truecourse/ee-data-store';
import { isLlmConfigured } from '../llm/index.js';
import type { JobsApi } from '../jobs/index.js';
import { KNOWLEDGE_SYNC_TASK, workspaceSyncJobKey } from '../jobs/constants.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { user?: AuthUser }).user?.organizationId ?? null;
}

const CONFLICT_VERDICTS = ['a', 'b', 'dismissed'] as const;

/** Default page size / hard cap for the raw-list surfaces (skipped, documents). */
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/** Parse `?limit=&offset=` with a sane default + a hard cap so a client can never
 *  request an unbounded slice. Shared by the skipped + documents listings. */
export function parsePageParams(req: Request): { limit: number; offset: number } {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

/** The relevance-dropped docs as a count + per-reason breakdown (most-common first). */
function skippedSummary(corpus: CuratedCorpus): KnowledgeSkippedSummary {
  const skipped = corpus.skippedDocs ?? [];
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const byReason = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
  return { total: skipped.length, byReason };
}

interface SpecRouteDeps {
  knowledge: PgKnowledgeStore;
  jobs: JobsApi;
}

/**
 * Re-process the workspace after a decision write — but ONLY when no conflicts
 * remain open. While a resolution session is underway (open conflicts left),
 * writes batch silently; the LAST verdict fires exactly one re-process. Also
 * best-effort: single-flight (a process already queued will pick up the newer
 * decisions) and gated on a configured LLM provider (an ungated enqueue would just
 * fail with no provider). Any failure is swallowed — the decision is already
 * saved, and the corpus GET folds it at read time regardless.
 */
async function enqueueWorkspaceProcess(jobs: JobsApi, org: string, kind: string): Promise<void> {
  if (!isLlmConfigured()) return;
  // No corpus yet ⇒ nothing to re-process (the first process is user-dispatched);
  // open conflicts ⇒ the session is still underway, keep batching.
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
  if (!corpus) return;
  const decisions = await getWorkspaceDecisions(org);
  if (openConflicts(corpus, decisions).length > 0) return;
  const key = workspaceSyncJobKey(org);
  try {
    const job = await jobs.jobStore.create({ org, type: KNOWLEDGE_SYNC_TASK, key });
    await jobs.enqueueSync({ jobId: job.id, org, kind }, key);
  } catch (e) {
    if (e instanceof ActiveJobExistsError) return; // the running process will fold it
    /* best-effort — never fail the decision write */
  }
}

/** The persisted include/exclude lists (the include/exclude write response). */
function includeAck(d: DecisionsFile): { manualIncludes: string[]; manualExcludes: string[] } {
  return { manualIncludes: d.manualIncludes ?? [], manualExcludes: d.manualExcludes ?? [] };
}

/**
 * Read-time DISPLAY enrichment: join each row's `ref` (the synthetic stable
 * docPath, which participates in the LLM cache keys and never changes) against the
 * ledger and attach the human `title` + deep-link `url` when a live row matches.
 * One batched query. A ref with no ledger row (pruned since the corpus was built)
 * is left as-is, so the client falls back to the ref. Identity is untouched — only
 * optional display fields are added.
 */
async function enrichRefs<T extends { ref: string }>(
  knowledge: PgKnowledgeStore,
  org: string,
  rows: T[],
): Promise<Array<T & { title?: string; url?: string | null }>> {
  if (rows.length === 0) return rows;
  const meta = await knowledge.titlesByDocPath(org, rows.map((r) => r.ref));
  return rows.map((r) => {
    const m = meta.get(r.ref);
    return m ? { ...r, title: m.title, url: m.url } : r;
  });
}

export function registerKnowledgeSpecRoutes(router: Router, deps: SpecRouteDeps): void {
  const { knowledge, jobs } = deps;

  // --- Corpus read -----------------------------------------------------------

  // The workspace corpus payload: the same shape as the repo `/spec/corpus` route,
  // except the full `skippedDocs` array is replaced by a `skipped` summary (the
  // rows come paginated from `/spec/skipped`). Decisions ride alongside so the
  // client folds resolved/dismissed conflict state instantly (buildCorpusConflicts).
  router.get('/spec/corpus', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
      if (!corpus) {
        return res
          .status(404)
          .json({ error: 'No workspace corpus yet. Process a connected source first.' });
      }
      const decisions = await getWorkspaceDecisions(org);
      // Enrich each kept doc's ref with its ledger title + deep-link for display.
      const docs = await enrichRefs(knowledge, org, corpus.docs);
      res.json({
        // Strip the (potentially huge) skipped array — the summary + paged endpoint
        // replace it. Keep it a valid CuratedCorpus for the client's parser.
        corpus: { ...corpus, docs, skippedDocs: [] },
        skipped: skippedSummary(corpus),
        manualIncludes: decisions.manualIncludes ?? [],
        manualExcludes: decisions.manualExcludes ?? [],
        conflictResolutions: decisions.conflictResolutions ?? [],
      });
    } catch (e) {
      next(e);
    }
  });

  // Paginated relevance-dropped docs behind the "Not included (N)" expander, with
  // an optional substring query (ref/reason) + exact reason filter.
  router.get('/spec/skipped', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
      const all = corpus?.skippedDocs ?? [];
      const query = String(req.query.query ?? '').trim().toLowerCase();
      const reason = String(req.query.reason ?? '').trim();
      let filtered = all;
      if (query) {
        filtered = filtered.filter(
          (s) => s.ref.toLowerCase().includes(query) || s.reason.toLowerCase().includes(query),
        );
      }
      if (reason) filtered = filtered.filter((s) => s.reason === reason);
      const { limit, offset } = parsePageParams(req);
      // Enrich the page's refs with their ledger title + deep-link for display.
      const page = filtered.slice(offset, offset + limit).map((s) => ({ ref: s.ref, reason: s.reason }));
      res.json({
        skipped: await enrichRefs(knowledge, org, page),
        total: filtered.length,
      });
    } catch (e) {
      next(e);
    }
  });

  // One doc's markdown, read from the STORED body via the ledger row (the body Sync
  // persisted, content-addressed by its hash) — no connector I/O, so it works even
  // after the source was disconnected. An unknown ref (or a body somehow absent) is
  // a clean 404.
  router.get('/spec/doc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const ref = String(req.query.ref ?? '');
      if (!ref) return res.status(400).json({ error: 'Missing ?ref=<doc path>.' });

      const row = await knowledge.findByDocPath(org, ref);
      if (!row) return res.status(404).json({ error: `Doc not found: ${ref}` });
      const content = await knowledge.getDocBody(org, row.contentHash);
      if (content == null) return res.status(404).json({ error: `Doc not found: ${ref}` });
      res.json({ ref, content });
    } catch (e) {
      next(e);
    }
  });

  // --- Decision writes -------------------------------------------------------
  // Each write persists the `'decisions'` artifact, then enqueues a re-process
  // (best-effort). The response mirrors the repo route's non-recurate shape (the
  // updated decision arrays); the client re-derives conflict state from them.

  router.post('/spec/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const ref = (req.body as { ref?: string }).ref;
      if (!ref) return res.status(400).json({ error: 'Missing ref.' });
      const decisions = await addWorkspaceManualInclude(org, ref);
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json(includeAck(decisions));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/spec/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const ref = (req.body as { ref?: string }).ref;
      if (!ref) return res.status(400).json({ error: 'Missing ref.' });
      const decisions = await removeWorkspaceManualInclude(org, ref);
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json(includeAck(decisions));
    } catch (e) {
      next(e);
    }
  });

  router.post('/spec/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const ref = (req.body as { ref?: string }).ref;
      if (!ref) return res.status(400).json({ error: 'Missing ref.' });
      const decisions = await addWorkspaceManualExclude(org, ref);
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json(includeAck(decisions));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/spec/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const ref = (req.body as { ref?: string }).ref;
      if (!ref) return res.status(400).json({ error: 'Missing ref.' });
      const decisions = await removeWorkspaceManualExclude(org, ref);
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json(includeAck(decisions));
    } catch (e) {
      next(e);
    }
  });

  router.post('/spec/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const body = req.body as Partial<ConflictResolution>;
      if (!body.docA || !body.docB || body.docA === body.docB) {
        return res.status(400).json({ error: 'docA and docB are required and must differ.' });
      }
      if (!body.verdict || !CONFLICT_VERDICTS.includes(body.verdict)) {
        return res.status(400).json({ error: `verdict must be one of ${CONFLICT_VERDICTS.join(', ')}.` });
      }
      const decisions = await addWorkspaceConflictResolution(org, {
        docA: body.docA,
        anchorA: body.anchorA ?? null,
        quoteA: body.quoteA,
        docB: body.docB,
        anchorB: body.anchorB ?? null,
        quoteB: body.quoteB,
        verdict: body.verdict,
        resolvedAt: new Date().toISOString(),
        note: body.note,
      });
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json({ conflictResolutions: decisions.conflictResolutions ?? [] });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/spec/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgIdOf(req);
      if (!org) return res.status(401).json({ error: 'no workspace' });
      const body = req.body as { docA?: string; anchorA?: string | null; docB?: string; anchorB?: string | null };
      if (!body.docA || !body.docB) return res.status(400).json({ error: 'docA and docB are required.' });
      const decisions = await removeWorkspaceConflictResolution(org, {
        docA: body.docA,
        anchorA: body.anchorA ?? null,
        docB: body.docB,
        anchorB: body.anchorB ?? null,
      });
      await enqueueWorkspaceProcess(jobs, org, '');
      res.json({ conflictResolutions: decisions.conflictResolutions ?? [] });
    } catch (e) {
      next(e);
    }
  });
}
