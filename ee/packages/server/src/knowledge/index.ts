/**
 * Workspace Knowledge API (enterprise, protected by the OSS auth gate).
 *
 * Workspace Knowledge is specs/contracts derived from connected tools
 * (Confluence/…), shared by every repo in the workspace. Every route is scoped
 * to the signed-in user's WorkOS organization (`req.eeUser.organizationId`).
 *
 * `/sync` pulls from the connected source (Settings → Integrations): list →
 * fetch bodies transiently → re-consolidate the full set → reconcile the
 * provenance ledger. Bodies are never stored; the Postgres extraction cache
 * makes unchanged pages cost 0 LLM on re-sync.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import { log } from '@truecourse/core/lib/logger';
import { captureEeException } from '../observability/sentry.js';
import {
  getWorkspaceScanState,
  getWorkspaceDecisions,
  getWorkspaceClaims,
  upsertWorkspaceDecision,
  revokeWorkspaceDecision,
  resolveAllWorkspaceDefaults,
  addWorkspaceManualChain,
  removeWorkspaceManualChain,
  addWorkspaceManualInclude,
  removeWorkspaceManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import {
  listWorkspaceContractFiles,
  readWorkspaceContractFile,
} from '@truecourse/core/lib/contract-store';
import { PgKnowledgeStore, ActiveJobExistsError } from '@truecourse/ee-data-store';
import { IntegrationStore } from '../integrations/store.js';
import { CONNECTORS } from './connectors/registry.js';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '../llm/index.js';
import type { JobsApi } from '../jobs/index.js';
import { KNOWLEDGE_SYNC_TASK } from '../jobs/constants.js';

const resolutionSchema = z.union([
  z.object({ kind: z.literal('pick'), candidateIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal('custom'), content: z.string().max(100_000) }),
]);
const decisionSchema = z.object({
  conflictId: z.string().min(1).max(500),
  resolution: resolutionSchema,
  candidateFingerprint: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
});
const chainSchema = z.object({
  older: z.string().min(1).max(1000),
  newer: z.string().min(1).max(1000),
  note: z.string().max(2000).optional(),
});
const docPathSchema = z.object({ path: z.string().min(1).max(1000) });

/** The OSS auth gate attaches the resolved user; read it without the augmentation. */
function orgIdOf(req: Request): string | null {
  const user = (req as Request & { eeUser?: AuthUser }).eeUser;
  return user?.organizationId ?? null;
}

/** The fields the canonical browser needs from a stored ClaimsFile (loosely typed at the boundary). */
interface ClaimsFileLike {
  generatedAt: string;
  modules: Array<{ name: string } & Record<string, unknown>>;
  claims: Array<{ module: string; topic: string; subject: string } & Record<string, unknown>>;
}

const syncSchema = z.object({ kind: z.enum(['confluence']) });

/**
 * Group flat posix-relative `.tc` paths by top-level segment (module), matching
 * the repo `/contracts/tree` shape so the reused ContractsPanel renders workspace
 * contracts unchanged. `_shared`/… sort first.
 */
function groupByModule(relPaths: string[]): Array<{ name: string; files: Array<{ name: string; path: string }> }> {
  const byModule = new Map<string, Array<{ name: string; path: string }>>();
  for (const p of relPaths) {
    const slash = p.indexOf('/');
    const moduleName = slash === -1 ? p : p.slice(0, slash);
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (!byModule.has(moduleName)) byModule.set(moduleName, []);
    byModule.get(moduleName)!.push({ name, path: p });
  }
  const modules = [...byModule.entries()].map(([name, files]) => ({
    name,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }));
  modules.sort((a, b) => {
    const aLeading = a.name.startsWith('_') ? 0 : 1;
    const bLeading = b.name.startsWith('_') ? 0 : 1;
    if (aLeading !== bLeading) return aLeading - bLeading;
    return a.name.localeCompare(b.name);
  });
  return modules;
}

export function createKnowledgeRouter(db: EeDb, masterSecret: string, jobs: JobsApi): Router {
  const router = Router();
  const knowledge = new PgKnowledgeStore(db);
  const integrations = new IntegrationStore(db, masterSecret);

  // --- Reads -----------------------------------------------------------------

  router.get('/scan-state', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const state = await getWorkspaceScanState(org);
    if (!state) return res.status(404).json({ error: 'No workspace knowledge yet.' });
    res.json(state);
  });

  router.get('/claims', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json(await getWorkspaceClaims(org)); // null → client shows the empty state
  });

  router.get('/decisions', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json(await getWorkspaceDecisions(org));
  });

  router.get('/documents', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json({ documents: await knowledge.listDocuments(org) });
  });

  // Canonical spec browser — the same shapes the repo `/spec/canonical/*` routes
  // return, so the reused SpecPanel renders workspace claims unchanged.
  router.get('/canonical/tree', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const claims = await getWorkspaceClaims<ClaimsFileLike>(org);
    if (!claims) return res.json({ hasCanonical: false, modules: [] });
    const byModuleTopic = new Map<string, Map<string, number>>();
    for (const c of claims.claims) {
      const byTopic = byModuleTopic.get(c.module) ?? new Map<string, number>();
      byTopic.set(c.topic, (byTopic.get(c.topic) ?? 0) + 1);
      byModuleTopic.set(c.module, byTopic);
    }
    const modules = claims.modules
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((manifest) => ({
        name: manifest.name,
        manifest,
        topics: [...(byModuleTopic.get(manifest.name) ?? new Map()).entries()]
          .map(([topic, claimCount]) => ({ topic, claimCount }))
          .sort((a, b) => a.topic.localeCompare(b.topic)),
      }));
    res.json({ hasCanonical: true, generatedAt: claims.generatedAt, modules });
  });

  router.get('/canonical/section', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const moduleName = String(req.query.module ?? '');
    const topic = String(req.query.topic ?? '');
    if (!moduleName || !topic) {
      return res.status(400).json({ error: 'Missing `module` or `topic` query parameter.' });
    }
    const claims = await getWorkspaceClaims<ClaimsFileLike>(org);
    if (!claims) return res.status(404).json({ error: 'No canonical spec yet.' });
    const manifest = claims.modules.find((m) => m.name === moduleName);
    if (!manifest) return res.status(404).json({ error: `Module ${moduleName} not found.` });
    const items = claims.claims
      .filter((c) => c.module === moduleName && c.topic === topic)
      .sort((a, b) => a.subject.localeCompare(b.subject));
    res.json({ module: moduleName, topic, manifest, claims: items });
  });

  // Contracts browser — the workspace `.tc` corpus generated on sync. Same
  // `{ hasContracts, modules }` + `{ path, content }` shapes as the repo
  // `/contracts/*` routes, so the reused ContractsPanel renders it unchanged.
  router.get('/contracts/tree', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const files = await listWorkspaceContractFiles({ workspaceOrgId: org }, 'contracts');
    res.json({ hasContracts: files.length > 0, modules: groupByModule(files) });
  });

  router.get('/contracts/file', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const requested = String(req.query.path ?? '');
    if (!requested) return res.status(400).json({ error: 'Missing `path` query parameter.' });
    // The store rejects traversal (a path not in its manifest returns null).
    const content = await readWorkspaceContractFile({ workspaceOrgId: org }, 'contracts', requested);
    if (content === null) return res.status(404).json({ error: 'File not found.' });
    res.json({ path: requested, content });
  });

  // --- Decisions (resolve conflicts) -----------------------------------------
  // Each mutation re-merges from the persisted raw claims + chains through the
  // store seam (no docs, no LLM) and returns the refreshed scan-state. Same
  // semantics as the repo `/spec/decisions*` routes; storage is the only diff.
  //
  // A decision changes the canonical claims (the spec re-merge is synchronous, so
  // the Decisions view is fresh on return), and the derived contract corpus is
  // refreshed too — NO manual "Generate" step. The slow `.tc` regen is deferred to
  // the background queue (off the request path), debounced per workspace. Enqueue
  // is best-effort: a hiccup must never undo the already-persisted decision, and
  // the next decision/sync regenerates.
  async function withContractRefresh<T>(org: string, mutation: Promise<T>): Promise<T> {
    const scanState = await mutation;
    try {
      await jobs.enqueueWorkspaceContracts(org);
    } catch (e) {
      log.warn(`[ee-knowledge] contract refresh enqueue failed (org ${org}): ${(e as Error).message}`);
      captureEeException(e, {
        component: 'knowledge',
        orgId: org,
        route: 'workspace-decision-regen',
        level: 'warning',
      });
    }
    return scanState;
  }

  router.post('/decisions', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    res.json(await withContractRefresh(org, upsertWorkspaceDecision(org, parsed.data)));
  });

  router.delete('/decisions/:conflictId', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json(await withContractRefresh(org, revokeWorkspaceDecision(org, String(req.params.conflictId))));
  });

  router.post('/decisions/batch', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    if ((req.body as { mode?: string } | undefined)?.mode !== 'all-defaults') {
      return res.status(400).json({ error: 'Only mode="all-defaults" is supported.' });
    }
    res.json(await withContractRefresh(org, resolveAllWorkspaceDefaults(org)));
  });

  router.post('/chains/manual', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = chainSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    if (parsed.data.older === parsed.data.newer) {
      return res.status(400).json({ error: 'older and newer must be different docs.' });
    }
    res.json(await withContractRefresh(org, addWorkspaceManualChain(org, parsed.data)));
  });

  router.delete('/chains/manual', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = chainSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    res.json(
      await withContractRefresh(
        org,
        removeWorkspaceManualChain(org, { older: parsed.data.older, newer: parsed.data.newer }),
      ),
    );
  });

  router.post('/docs/include', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = docPathSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    res.json(await withContractRefresh(org, addWorkspaceManualInclude(org, parsed.data.path)));
  });

  router.delete('/docs/include', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = docPathSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    res.json(await withContractRefresh(org, removeWorkspaceManualInclude(org, parsed.data.path)));
  });

  // --- Sync (pull from the connected source) ---------------------------------
  // Lists every page in the connected Confluence space, fetches them transiently
  // (bodies in RAM, never stored), re-consolidates the full set, and reconciles
  // the provenance ledger. Unchanged pages cost 0 LLM (Postgres extraction cache).
  router.post('/sync', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = syncSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });

    const connector = CONNECTORS[parsed.data.kind];
    if (!connector) return res.status(400).json({ error: `Unknown connector: ${parsed.data.kind}` });

    const conn = await integrations.getConnection(org, parsed.data.kind);
    if (!conn?.token) {
      return res.status(409).json({
        error: `No ${parsed.data.kind} connection. Connect it in Settings → Integrations.`,
      });
    }

    // Fail loudly up front: claim extraction + contract generation need the LLM,
    // and the consolidator's fail-open error handling (relevance filter defaults
    // to "include" on a transport error) would otherwise SWALLOW a "no provider"
    // failure and report a successful sync with zero claims. (Checked here, before
    // enqueue, so a missing provider is a synchronous 409 — not a failed job.)
    if (!isLlmConfigured()) {
      return res.status(409).json({ error: NO_LLM_PROVIDER_MESSAGE });
    }

    // Create the job, then enqueue it — the work runs in the background worker so
    // a long sync never blocks/times-out this request. The partial-unique index
    // (one active job per org+key) makes a concurrent sync fail fast with 409
    // instead of queuing a duplicate.
    const key = `${KNOWLEDGE_SYNC_TASK}:${parsed.data.kind}`;
    let job;
    try {
      job = await jobs.jobStore.create({ org, type: KNOWLEDGE_SYNC_TASK, key });
    } catch (e) {
      if (e instanceof ActiveJobExistsError) {
        return res
          .status(409)
          .json({ error: 'A sync is already in progress for this source.', jobId: e.existing.id });
      }
      throw e;
    }
    await jobs.enqueueSync({ jobId: job.id, org, kind: parsed.data.kind }, key);
    return res.status(202).json({ jobId: job.id });
  });

  return router;
}

/** Mount the Knowledge API. Protected by default (behind the enterprise auth gate). */
export function registerKnowledge(
  registry: EeServerRegistry,
  opts: { db: EeDb; masterSecret: string; jobs: JobsApi },
): void {
  registry.registerRouter('/api/ee/knowledge', createKnowledgeRouter(opts.db, opts.masterSecret, opts.jobs));
}
