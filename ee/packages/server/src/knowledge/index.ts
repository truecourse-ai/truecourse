/**
 * Workspace Knowledge API (enterprise, protected by the OSS auth gate).
 *
 * Workspace Knowledge is the curated-corpus spec derived from connected tools
 * (Confluence/…), shared by every repo in the workspace. Every route is scoped to
 * the signed-in user's WorkOS organization (`req.user.organizationId`).
 *
 * Two stages: `/estimate` ("Sync now") is the only stage that talks to a source —
 * it fetches every doc, PERSISTS each body (content-addressed) + reconciles the
 * provenance ledger, and prices the work to process. `/sync` (Process) then
 * consolidates the stored union into a corpus with NO connector I/O. The per-doc
 * caches make unchanged pages cost ~0 LLM on re-process.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import type { Db } from '@truecourse/db';
import { PgKnowledgeStore, ActiveJobExistsError } from '@truecourse/ee-data-store';
import { IntegrationStore } from '../integrations/store.js';
import { CONNECTORS } from './connectors/registry.js';
import type { ConnectorKind } from './connectors/types.js';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '../llm/index.js';
import type { JobsApi } from '../jobs/index.js';
import {
  KNOWLEDGE_SYNC_TASK,
  KNOWLEDGE_ESTIMATE_TASK,
  workspaceSyncJobKey,
} from '../jobs/constants.js';
import { registerKnowledgeSpecRoutes, parsePageParams } from './spec-routes.js';

/** The OSS auth gate attaches the resolved user; read it without the augmentation. */
function orgIdOf(req: Request): string | null {
  const user = (req as Request & { user?: AuthUser }).user;
  return user?.organizationId ?? null;
}

// Any non-empty kind — the connector registry is the authority on which kinds
// exist (adding a connector must need no route changes), and an unknown kind
// gets a clean 400 from the registry lookup below.
const syncSchema = z.object({ kind: z.string().min(1) });

export function createKnowledgeRouter(db: Db, masterSecret: string, jobs: JobsApi): Router {
  const router = Router();
  const knowledge = new PgKnowledgeStore(db);
  const integrations = new IntegrationStore(db, masterSecret);

  // --- Reads -----------------------------------------------------------------

  // The provenance ledger for the Sources tab — server-paginated with an optional
  // search + source-kind filter (a Jira project can carry thousands of tickets).
  router.get('/documents', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const { limit, offset } = parsePageParams(req);
    const query = req.query.query ? String(req.query.query) : undefined;
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    const { documents, total } = await knowledge.listDocumentsPage(org, { query, kind, limit, offset });
    res.json({
      documents: documents.map((d) => ({
        sourceKind: d.sourceKind,
        externalId: d.externalId,
        docPath: d.docPath,
        title: d.title,
        url: d.url,
        version: d.version,
        lastSyncedAt: d.lastSyncedAt,
      })),
      total,
    });
  });

  // --- Process (consolidate the stored union) --------------------------------
  // Consolidates the UNION of every synced source's stored docs into a corpus with
  // NO connector I/O (Sync already fetched + persisted them). Unchanged docs cost
  // ~0 LLM (per-doc caches). Dispatched as a background job like the sweep.
  router.post('/sync', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = syncSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });

    const connector = CONNECTORS[parsed.data.kind as ConnectorKind];
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
    // a long sync never blocks/times-out this request. Processing is
    // workspace-scoped: the single-flight key is per ORG (not per connector), so
    // every source's Process button dispatches the same union job and a concurrent
    // click (any source) fails fast with 409. `kind` rides along for attribution.
    const key = workspaceSyncJobKey(org);
    let job;
    try {
      job = await jobs.jobStore.create({ org, type: KNOWLEDGE_SYNC_TASK, key });
    } catch (e) {
      if (e instanceof ActiveJobExistsError) {
        return res
          .status(409)
          .json({ error: 'Processing is already in progress for this workspace.', jobId: e.existing.id });
      }
      throw e;
    }
    await jobs.enqueueSync({ jobId: job.id, org, kind: parsed.data.kind }, key);
    return res.status(202).json({ jobId: job.id });
  });

  // --- Sync now ("Sync now" — Stage 1 of the Sync/Process flow) --------------
  // Sweeps the source (list + fetch), PERSISTS every body + reconciles the ledger
  // (Sources fills immediately), and prices the classify+consolidate stage WITHOUT
  // running it. Dispatched as a background job (a large first sweep is minutes of
  // HTTP). The job persists the delta + full estimate as the connection's `pending`
  // record — the client's Process button renders from it and opens its confirm
  // dialog from the stored estimate; the dialog's Confirm (or a free, no-stage
  // pending) then hits `/sync` (Process).
  router.post('/estimate', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = syncSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });

    const connector = CONNECTORS[parsed.data.kind as ConnectorKind];
    if (!connector) return res.status(400).json({ error: `Unknown connector: ${parsed.data.kind}` });

    const conn = await integrations.getConnection(org, parsed.data.kind);
    if (!conn?.token) {
      return res.status(409).json({
        error: `No ${parsed.data.kind} connection. Connect it in Settings → Integrations.`,
      });
    }

    // No LLM gate here: the sweep makes no LLM call and prices the ceiling from
    // bundled prices, so it must run even with no provider configured. The provider
    // gate lives on `/sync` (Process), which is what actually calls the LLM.

    // The key is ALSO graphile-worker's jobKey, which is globally unique with
    // replace semantics — it must embed the org (mirroring workspaceSyncJobKey)
    // or org B's sweep would silently replace org A's queued job, stranding org
    // A's tracked row as `queued` and wedging its single-flight key.
    const key = `${KNOWLEDGE_ESTIMATE_TASK}:${org}:${parsed.data.kind}`;
    let job;
    try {
      job = await jobs.jobStore.create({ org, type: KNOWLEDGE_ESTIMATE_TASK, key });
    } catch (e) {
      if (e instanceof ActiveJobExistsError) {
        return res
          .status(409)
          .json({ error: 'An estimate is already in progress for this source.', jobId: e.existing.id });
      }
      throw e;
    }
    await jobs.enqueueEstimate({ jobId: job.id, org, kind: parsed.data.kind }, key);
    return res.status(202).json({ jobId: job.id });
  });

  // --- Spec corpus + decisions (the Knowledge page's Spec tab) ---------------
  // The workspace level keeps ONLY specs + conflict resolution; scenarios are
  // generated by the connected repos, which fold the workspace corpus into their
  // own spec before guard generate (see EE_REPO_INHERITANCE_PLAN.md).
  registerKnowledgeSpecRoutes(router, { knowledge, jobs });

  return router;
}

/** Mount the Knowledge API. Protected by default (behind the enterprise auth gate). */
export function registerKnowledge(
  registry: EeServerRegistry,
  opts: { db: Db; masterSecret: string; jobs: JobsApi },
): void {
  registry.registerRouter('/api/ee/knowledge', createKnowledgeRouter(opts.db, opts.masterSecret, opts.jobs));
}
