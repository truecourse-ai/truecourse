/**
 * Context routes — the WORKSPACE's documentation sources.
 *
 *   GET    /api/context/sources               every source, with its document count and readers,
 *                                             and the KINDS this server can add
 *   POST   /api/context/sources               add one (kind, config, repoIds) and sync it, or
 *                                             with { sync: false } add it paused
 *   POST   /api/context/sources/preview       what a scope WOULD yield — reads, stores nothing
 *   GET    /api/context/sources/:id           one source and its syncs — the source's page
 *   PATCH  /api/context/sources/:id           { config } — a new scope, and the sync it starts
 *   POST   /api/context/sources/:id/sync      Sync now
 *   POST   /api/context/sources/:id/pause     { paused: boolean }
 *   DELETE /api/context/sources/:id           drop the source, its documents and every link
 *   GET    /api/context/sources/:id/documents its ledger
 *   GET    /api/context/doc?ref=              one document's body, by its corpus ref
 *   GET    /api/context/documents             the rows of the Documents view, status folded
 *                                             and inclusion said, corpus or not
 *   POST   /api/context/scan                  the workspace Document scan; 202 { jobId }
 *   GET    /api/context/staleness             has the context moved since the corpus?
 *   GET    /api/context/corpus                the workspace corpus + its decisions
 *   POST|DELETE /api/context/includes         force-include / un-include a document
 *   POST|DELETE /api/context/excludes         force-exclude / restore a document
 *   POST|DELETE /api/context/conflict-resolution   a section-scoped conflict verdict
 *
 * A source belongs to the workspace, not to a repository, so this router mounts
 * ABOVE the repository routers and behind the auth gate alone — there is no
 * slug to resolve. The per-repository half (which sources a repository reads)
 * is `createContextBindingsRouter`, which does sit behind the project resolver.
 *
 * Thin adapters: what a source operation and a decision DO is in
 * `context-sources.service` and `context-decisions.service`, which the MCP
 * tools call too. Here a request becomes their arguments and their answer or
 * refusal becomes a response.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { getProjectBySlug } from '@truecourse/core/config/registry';
import {
  contextBindings,
  listContextSources,
  readContextDocByRef,
  setContextBindings,
} from '@truecourse/core/lib/context-store';
import {
  ContextConfigError,
  ContextKindUnsupportedError,
} from '@truecourse/core/services/context';
import { InvalidSourceUrlError, LlmsTxtFetchError, diffCorpora, type CuratedCorpus } from '@truecourse/spec-consolidator';
import {
  listWorkspaceSpecVersions,
  loadWorkspaceSpec,
  readWorkspaceSpecVersion,
} from '@truecourse/core/lib/spec-store';
import {
  requireWorkspaceDescription,
  WorkspaceDescriptionRequiredError,
} from '@truecourse/core/lib/workspace-profile-store';
import {
  CreditsProviderUnavailableError,
  CreditsPricesUnavailableError,
  LlmNotConfiguredError,
  LlmProbeFailedError,
  startWorkspaceLlm,
} from '../services/workspace-llm.service.js';
import { recordFailedWorkspaceScanRun } from '../services/context-scan.service.js';
import { requireJobs } from '../jobs/current.js';
import { refusedWithoutCredits } from './credits.js';
import { emitContextChanged } from '../services/context.service.js';
import type { RepoOwnershipLookup } from '../middleware/project.js';
import {
  addSource,
  editSource,
  listSources,
  listWorkspaceDocuments,
  pauseSource,
  previewSource,
  readSource,
  readSourceDocuments,
  removeSource,
  syncSource,
  type ContextCaller,
  type ContextGithubAccess,
} from '../services/context-sources.service.js';
import {
  ConflictVerdictError,
  excludeDocument,
  includeDocument,
  readWorkspaceCorpus,
  resolveConflict,
  unexcludeDocument,
  unincludeDocument,
  unresolveConflict,
  workspaceStaleness,
} from '../services/context-decisions.service.js';

export interface ContextRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  repoLinks?: RepoOwnershipLookup | null;
  /** The same connection's installation access. Absent when GitHub is unconfigured. */
  github?: ContextGithubAccess | null;
}

/** The workspace the caller is acting in, or a refusal. */
function orgOf(req: Request): string {
  const org = req.user?.organizationId;
  if (!org) throw createAppError('This session has no workspace.', 403);
  return org;
}

/** The engine's own refusals are already user-facing; everything else is a bug. */
function statusOf(err: unknown): number | null {
  if (err instanceof ContextConfigError) return 400;
  if (err instanceof InvalidSourceUrlError || err instanceof LlmsTxtFetchError) return 400;
  if (err instanceof ContextKindUnsupportedError) return 400;
  if (err instanceof ConflictVerdictError) return 400;
  return null;
}

function respond(res: Response, next: NextFunction, err: unknown): void {
  // A workspace that has not said what its product is refuses with a CODE, not
  // a sentence: the client reads it and offers the page where it is set.
  if (err instanceof WorkspaceDescriptionRequiredError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  const status = statusOf(err);
  if (status === null) {
    next(err);
    return;
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

/** One query parameter's values — `?repo=a&repo=b` and `?repo=a` read alike. */
function queryValues(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value).trim()).filter((value) => value !== '');
}

export function createContextRouter(deps: ContextRouterDeps = {}): Router {
  const router: Router = Router();

  /** The caller as the services take it: the workspace, the person, their repositories. */
  const callerOf = (req: Request): ContextCaller => ({
    org: orgOf(req),
    ...(req.user?.id ? { userId: req.user.id } : {}),
    repoLinks: deps.repoLinks,
    github: deps.github,
  });

  // --- Read ----------------------------------------------------------------

  router.get('/sources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await listSources(orgOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // ONE source, with the syncs that made it what it is — the source's own page
  // reads exactly this, and says nothing it does not carry.
  router.get('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await readSource(orgOf(req), req.params.id as string));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.get('/sources/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await readSourceDocuments(orgOf(req), req.params.id as string));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // One document's body by its corpus ref — the address the Documents view,
  // the claims and the scenarios all use.
  router.get('/doc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const ref = typeof req.query.ref === 'string' ? req.query.ref : '';
      if (!ref) {
        res.status(400).json({ error: 'Missing ?ref=context/<source>/<document>.' });
        return;
      }
      const content = await readContextDocByRef(org, ref);
      if (content === null) {
        res.status(404).json({ error: `Doc not found: ${ref}` });
        return;
      }
      res.json({ ref, content });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // The workspace corpus, in the same payload shape the repository's corpus
  // route answers with, so the corpus components render either unchanged. The
  // documents carry their source in the artifact (the scan stamps it), so
  // nothing is enriched at read time.
  router.get('/corpus', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const read = await readWorkspaceCorpus(orgOf(req));
      if (!read) {
        res.status(404).json({ error: 'No documents have been scanned yet.' });
        return;
      }
      res.json(read);
    } catch (e) {
      respond(res, next, e);
    }
  });

  // GET — the workspace's corpus versions, newest first, each with its
  // provenance: the scan that wrote it and the model it ran on.
  router.get('/versions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      res.json({ versions: await listWorkspaceSpecVersions({ workspaceOrgId: org }, 'corpus') });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // GET — what changed between two corpus versions: the documents added,
  // removed and re-tagged, the areas that appeared or emptied, the overlap
  // flags that opened or closed. `?from=` and `?to=` are version ids.
  router.get('/versions/diff', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const fromId = String(req.query.from ?? '');
      const toId = String(req.query.to ?? '');
      if (!fromId || !toId) {
        res.status(400).json({ error: 'Missing ?from=<version id>&to=<version id>.' });
        return;
      }
      const [from, to] = await Promise.all([
        readWorkspaceSpecVersion(org, 'corpus', fromId),
        readWorkspaceSpecVersion(org, 'corpus', toId),
      ]);
      if (!from || !to) {
        res.status(404).json({ error: `No corpus version ${!from ? fromId : toId}.` });
        return;
      }
      const ref = { workspaceOrgId: org };
      const [prior, current] = await Promise.all([
        loadWorkspaceSpec<CuratedCorpus>(ref, 'corpus', { id: from.id }),
        loadWorkspaceSpec<CuratedCorpus>(ref, 'corpus', { id: to.id }),
      ]);
      res.json({ from, to, diff: diffCorpora(prior, current) });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // THE Documents view. `?area=&status=&source=&repo=&inclusion=` narrow the
  // answer, repeatable, AND across dimensions and OR within one — the same
  // reading the page's filter row has.
  router.get('/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await listWorkspaceDocuments(callerOf(req), {
          area: req.query.area === undefined ? [] : queryValues(req.query.area),
          status: req.query.status === undefined ? [] : queryValues(req.query.status),
          source: req.query.source === undefined ? [] : queryValues(req.query.source),
          repo: req.query.repo === undefined ? [] : queryValues(req.query.repo),
          inclusion: req.query.inclusion === undefined ? [] : queryValues(req.query.inclusion),
        }),
      );
    } catch (e) {
      respond(res, next, e);
    }
  });

  // Has the workspace's Context moved since the corpus was built? The amber dot
  // on Scan reads exactly this.
  router.get('/staleness', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await workspaceStaleness(orgOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Scan ----------------------------------------------------------------

  // The workspace Document scan. The asking workspace's provider is proved
  // BEFORE anything is queued: an unconfigured provider is a setting to fill
  // in, not a job that dies later.
  router.post('/scan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      // THE SUBJECT FIRST: the scan attributes every document against what the
      // workspace says its product is, so with no sentence there is nothing to
      // scan against — and this is the backstop for every other entry point.
      await requireWorkspaceDescription(org);
      // Then the balance: proving a provider that cannot be paid for is work
      // nobody asked for, and the refusal is about the money either way.
      if (await refusedWithoutCredits(req, res)) return;
      try {
        await startWorkspaceLlm(org);
      } catch (e) {
        // A workspace that chose credits on a server that holds none: a setting
        // to change, like an unconfigured provider, not a job that dies later.
        if (e instanceof CreditsProviderUnavailableError || e instanceof LlmNotConfiguredError) {
          res.status(409).json({ error: e.code, message: e.message });
          return;
        }
        if (e instanceof CreditsPricesUnavailableError) {
          res.status(503).json({ error: e.code, message: e.message });
          return;
        }
        if (e instanceof LlmProbeFailedError) {
          await recordFailedWorkspaceScanRun(org, { message: e.message, kind: 'llm-probe' });
          res.status(502).json({ error: e.code, message: e.message });
          return;
        }
        throw e;
      }
      const outcome = await requireJobs().enqueueContextScan({
        workspaceOrgId: org,
        source: 'manual',
        ...(req.user?.id ? { requestedBy: req.user.id } : {}),
      });
      if (outcome.status === 'busy') {
        res.status(409).json({ error: 'A document scan is already running for this workspace.' });
        return;
      }
      res.status(202).json({ jobId: outcome.jobId });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Decisions, at workspace scope ---------------------------------------

  const refOf = (req: Request): unknown => (req.body as { ref?: unknown } | undefined)?.ref;

  router.post('/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await includeDocument(orgOf(req), refOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await unincludeDocument(orgOf(req), refOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.post('/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await excludeDocument(orgOf(req), refOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await unexcludeDocument(orgOf(req), refOf(req)));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.post('/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const conflictResolutions = await resolveConflict(
        { org, ...(req.user?.id ? { userId: req.user.id } : {}) },
        req.body ?? {},
      );
      res.json({ conflictResolutions });
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ conflictResolutions: await unresolveConflict(orgOf(req), req.body ?? {}) });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Check ---------------------------------------------------------------

  // What an add WOULD yield, before anything is stored: the count and the first
  // titles. Runs the real driver — no source exists yet, so nothing is written.
  router.post('/sources/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await previewSource(callerOf(req), req.body ?? {}));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Add -----------------------------------------------------------------

  router.post('/sources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(202).json(await addSource(callerOf(req), req.body ?? {}));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Edit the scope ------------------------------------------------------

  router.patch('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { config?: unknown };
      res.status(202).json(await editSource(orgOf(req), req.params.id as string, body.config));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Sync now ------------------------------------------------------------

  router.post('/sources/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(202).json(await syncSource(orgOf(req), req.params.id as string));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Pause / resume ------------------------------------------------------

  router.post('/sources/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { paused?: unknown };
      if (typeof body.paused !== 'boolean') {
        res.status(400).json({ error: 'Missing { paused: boolean }.' });
        return;
      }
      res.json(await pauseSource(orgOf(req), req.params.id as string, body.paused));
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Remove --------------------------------------------------------------

  router.delete('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await removeSource(orgOf(req), req.params.id as string));
    } catch (e) {
      respond(res, next, e);
    }
  });

  return router;
}

/**
 * The per-repository half: which workspace sources one repository reads. Mounted
 * at `/api/repos` behind the project resolver, like every other repo router.
 */
export function createContextBindingsRouter(): Router {
  const router: Router = Router();

  router.get('/:id/context/bindings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const entry = await getProjectBySlug(org, req.params.id as string);
      if (!entry) throw createAppError('Project not found', 404);
      res.json({ repoFullName: entry.name, sourceIds: await contextBindings(org, entry.name) });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // PUT replaces the set: the toggles on the repository's Context tab are one
  // state, saved whole, so a link the caller did not send is removed.
  router.put('/:id/context/bindings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const entry = await getProjectBySlug(org, req.params.id as string);
      if (!entry) throw createAppError('Project not found', 404);
      const body = (req.body ?? {}) as { sourceIds?: unknown };
      if (!Array.isArray(body.sourceIds)) {
        res.status(400).json({ error: 'Missing { sourceIds: string[] }.' });
        return;
      }
      const known = new Set((await listContextSources(org)).map((source) => source.id));
      const wanted: string[] = [];
      for (const raw of body.sourceIds) {
        const sourceId = typeof raw === 'string' ? raw.trim() : '';
        if (!known.has(sourceId)) {
          res.status(404).json({ error: `Context source "${String(raw)}" not found` });
          return;
        }
        if (!wanted.includes(sourceId)) wanted.push(sourceId);
      }
      // Only a set that actually DIFFERS is a change: saving the toggles
      // untouched must start nothing.
      const before = await contextBindings(org, entry.name);
      const differs =
        before.length !== wanted.length || wanted.some((id) => !before.includes(id));
      await setContextBindings(org, entry.name, wanted);
      if (!differs) {
        res.json({ repoFullName: entry.name, sourceIds: await contextBindings(org, entry.name) });
        return;
      }
      await emitContextChanged(org, { change: 'bindings', repoFullName: entry.name });
      // The corpus stood still; only this repository's slice moved. Its tests
      // are what the change reaches, so it gets what a ripple would give it —
      // and a repository connecting right now is already setting up, so
      // nothing.
      const started = await requireJobs().startForLinks({
        workspaceOrgId: org,
        repoId: entry.slug,
        repoFullName: entry.name,
        sourceIds: wanted,
      });
      res.json({
        repoFullName: entry.name,
        sourceIds: await contextBindings(org, entry.name),
        ...(started ? { started: started.job } : {}),
      });
    } catch (e) {
      respond(res, next, e);
    }
  });

  return router;
}
