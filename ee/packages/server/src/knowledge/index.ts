/**
 * Workspace Knowledge API (enterprise, protected by the OSS auth gate).
 *
 * Workspace Knowledge is the curated-corpus spec + the `.tc` contracts derived
 * from connected tools (Confluence/…), shared by every repo in the workspace.
 * Every route is scoped to the signed-in user's WorkOS organization
 * (`req.eeUser.organizationId`).
 *
 * `/sync` pulls from the connected source (Settings → Integrations): list →
 * fetch bodies transiently → curate the full set into a corpus → generate the
 * `.tc` contracts → reconcile the provenance ledger. Bodies are never stored; the
 * per-doc / per-slice caches make unchanged pages cost ~0 LLM on re-sync.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
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

/** The OSS auth gate attaches the resolved user; read it without the augmentation. */
function orgIdOf(req: Request): string | null {
  const user = (req as Request & { eeUser?: AuthUser }).eeUser;
  return user?.organizationId ?? null;
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

  router.get('/documents', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json({ documents: await knowledge.listDocuments(org) });
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

  // --- Sync (pull from the connected source) ---------------------------------
  // Lists every page in the connected Confluence space, fetches them transiently
  // (bodies in RAM, never stored), curates the full set into a corpus + generates
  // the `.tc` contracts, and reconciles the provenance ledger. Unchanged pages
  // cost ~0 LLM (per-doc / per-slice caches).
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

    // Fail loudly up front: curation + contract generation need the LLM, and the
    // curate fail-open handling would otherwise swallow a "no provider" failure
    // and report a successful sync with an empty corpus. (Checked here, before
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
