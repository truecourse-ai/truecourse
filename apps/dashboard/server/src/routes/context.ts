/**
 * Context routes — the WORKSPACE's documentation sources.
 *
 *   GET    /api/context/sources               every source, with its document count and readers
 *   POST   /api/context/sources               add one (kind, config, repoIds) and sync it
 *   POST   /api/context/sources/preview       what a scope WOULD yield — reads, stores nothing
 *   POST   /api/context/sources/:id/sync      Sync now
 *   POST   /api/context/sources/:id/pause     { paused: boolean }
 *   DELETE /api/context/sources/:id           drop the source, its documents and every link
 *   GET    /api/context/sources/:id/documents its ledger
 *   GET    /api/context/doc?ref=              one document's body, by its corpus ref
 *
 * A source belongs to the workspace, not to a repository, so this router mounts
 * ABOVE the repository routers and behind the auth gate alone — there is no
 * slug to resolve. The per-repository half (which sources a repository reads)
 * is `createContextBindingsRouter`, which does sit behind the project resolver.
 *
 * Every mutation emits the workspace-level `context.changed` event on the SSE
 * stream the workspace already holds open, so the Context pages re-read without
 * a repo socket room.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { getProjectBySlug, readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import {
  contextBindings,
  contextChangedAt,
  createContextSource,
  getContextSource,
  listContextBindings,
  listContextDocuments,
  listContextSources,
  readContextDocByRef,
  removeContextSource,
  setContextBindings,
  updateContextSource,
} from '@truecourse/core/lib/context-store';
import {
  ContextConfigError,
  ContextKindUnsupportedError,
  isImplementedContextKind,
  repositoryConfig,
  repositorySourceId,
  siteConfig,
  siteSourceId,
} from '@truecourse/core/services/context';
import {
  InvalidSourceUrlError,
  LlmsTxtFetchError,
} from '@truecourse/spec-consolidator';
import {
  CONTEXT_SOURCE_KINDS,
  type ContextSource,
  type ContextSourceConfig,
  type ContextSourceKind,
  type ContextSourceView,
  type RepositorySourceConfig,
  type SiteSourceConfig,
} from '@truecourse/shared';
import { requireJobs } from '../jobs/current.js';
import { emitContextChanged, serverContextDrivers } from '../services/context.service.js';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';

export interface ContextRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  githubLinks?: RepoOwnershipLookup | null;
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
  return null;
}

function respond(res: Response, next: NextFunction, err: unknown): void {
  const status = statusOf(err);
  if (status === null) {
    next(err);
    return;
  }
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

/** A source plus the two facts every listing shows: how many docs, who reads it. */
function toView(
  source: ContextSource,
  docCounts: Map<string, number>,
  readers: Map<string, string[]>,
): ContextSourceView {
  return {
    ...source,
    docCount: docCounts.get(source.id) ?? 0,
    repositories: readers.get(source.id) ?? [],
  };
}

/** Compose the whole listing from three reads, not one per source. */
async function listViews(org: string): Promise<ContextSourceView[]> {
  const [sources, documents, bindings] = await Promise.all([
    listContextSources(org),
    listContextDocuments(org),
    listContextBindings(org),
  ]);
  const docCounts = new Map<string, number>();
  for (const doc of documents) docCounts.set(doc.sourceId, (docCounts.get(doc.sourceId) ?? 0) + 1);
  const readers = new Map<string, string[]>();
  for (const binding of bindings) {
    readers.set(binding.sourceId, [...(readers.get(binding.sourceId) ?? []), binding.repoFullName]);
  }
  return sources.map((source) => toView(source, docCounts, readers));
}

/** A validated scope, tagged by the kind it belongs to, so callers narrow. */
type NormalizedConfig =
  | { kind: 'repository'; config: RepositorySourceConfig }
  | { kind: 'site'; config: SiteSourceConfig };

/** Validate and normalize the scope a caller supplied for this kind. */
function normalizeConfig(kind: ContextSourceKind, config: unknown): NormalizedConfig {
  const raw = (config ?? {}) as ContextSourceConfig;
  return kind === 'repository'
    ? { kind, config: repositoryConfig(raw) }
    : { kind: 'site', config: siteConfig(raw) };
}

/** A source's title at creation: the origin names it, and the first sync corrects it. */
function titleFor(scope: NormalizedConfig): string {
  return scope.kind === 'repository'
    ? scope.config.repoFullName
    : new URL(scope.config.llmsTxtUrl).host;
}

/** Read `kind` off a request body, refusing anything that cannot sync. */
function readKind(body: { kind?: unknown }): ContextSourceKind {
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  if (!(CONTEXT_SOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new ContextConfigError(
      `Unknown source kind ${JSON.stringify(kind)}. Known kinds: ${CONTEXT_SOURCE_KINDS.join(', ')}.`,
    );
  }
  if (!isImplementedContextKind(kind)) throw new ContextKindUnsupportedError(kind);
  return kind as ContextSourceKind;
}

export function createContextRouter(deps: ContextRouterDeps = {}): Router {
  const router: Router = Router();

  /**
   * The repositories this caller may link, by both names they can be given:
   * the registry slug the client routes on, and the `owner/repo` the store
   * keys by. A repository another workspace connected is simply not here.
   */
  async function linkableRepos(req: Request): Promise<Map<string, RegistryEntry>> {
    const byName = new Map<string, RegistryEntry>();
    for (const entry of await readRegistry()) {
      if (!(await isVisibleTo(deps.githubLinks, req, entry))) continue;
      byName.set(entry.slug, entry);
      byName.set(entry.name, entry);
    }
    return byName;
  }

  /** `repoIds` (slugs or `owner/repo`) → the repo keys the bindings store uses. */
  async function readRepoIds(req: Request, value: unknown): Promise<string[]> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new ContextConfigError('repoIds must be a list.');
    const linkable = await linkableRepos(req);
    const out: string[] = [];
    for (const raw of value) {
      const entry = typeof raw === 'string' ? linkable.get(raw.trim()) : undefined;
      if (!entry) throw createAppError(`Repository "${String(raw)}" not found`, 404);
      if (!out.includes(entry.name)) out.push(entry.name);
    }
    return out;
  }

  // --- Read ----------------------------------------------------------------

  router.get('/sources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const [sources, changedAt] = await Promise.all([listViews(org), contextChangedAt(org)]);
      res.json({ sources, changedAt });
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.get('/sources/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      const [documents, readers] = await Promise.all([
        listContextDocuments(org, sourceId),
        listContextBindings(org),
      ]);
      const view = toView(
        source,
        new Map([[sourceId, documents.length]]),
        new Map([
          [sourceId, readers.filter((b) => b.sourceId === sourceId).map((b) => b.repoFullName)],
        ]),
      );
      res.json({ source: view, documents });
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

  // --- Check ---------------------------------------------------------------

  // What an add WOULD yield, before anything is stored: the count and the first
  // titles. Runs the real driver — no source exists yet, so nothing is written.
  router.post('/sources/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      orgOf(req);
      const body = (req.body ?? {}) as { kind?: unknown; config?: unknown };
      const kind = readKind(body);
      const scope = normalizeConfig(kind, body.config);
      if (scope.kind === 'repository') await requireLinkable(req, scope.config.repoFullName);
      const driver = serverContextDrivers().get(kind)!;
      res.json(await driver.check(scope.config));
    } catch (e) {
      respond(res, next, e);
    }
  });

  /** A repository source may only scope a repository this workspace connected. */
  async function requireLinkable(req: Request, repoFullName: string): Promise<void> {
    const linkable = await linkableRepos(req);
    if (!linkable.has(repoFullName)) {
      throw createAppError(`Repository "${repoFullName}" not found`, 404);
    }
  }

  // --- Add -----------------------------------------------------------------

  router.post('/sources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const body = (req.body ?? {}) as { kind?: unknown; config?: unknown; repoIds?: unknown };
      const kind = readKind(body);
      const scope = normalizeConfig(kind, body.config);
      const repoKeys = await readRepoIds(req, body.repoIds);

      const existing = await listContextSources(org);
      const id =
        scope.kind === 'repository'
          ? await newRepositorySourceId(req, existing, scope.config.repoFullName)
          : newSiteSourceId(existing, scope.config);

      const source = await createContextSource(org, {
        id,
        kind,
        title: titleFor(scope),
        config: scope.config,
      });
      // A Repository source is always read by the repository it scopes; a site
      // is read by whoever the caller named, which may be nobody.
      const links =
        scope.kind === 'repository'
          ? [...new Set([scope.config.repoFullName, ...repoKeys])]
          : repoKeys;
      for (const repoKey of links) {
        await setContextBindings(org, repoKey, [
          ...new Set([...(await contextBindings(org, repoKey)), id]),
        ]);
      }
      await emitContextChanged(org, { change: 'sources', sourceId: id });

      const outcome = await requireJobs().enqueueContextSync({
        workspaceOrgId: org,
        sourceId: id,
        source: 'add',
      });
      res.status(202).json({
        source: { ...source, docCount: 0, repositories: links },
        ...(outcome.status === 'queued' ? { jobId: outcome.jobId } : {}),
      });
    } catch (e) {
      respond(res, next, e);
    }
  });

  /** The id a new Repository source takes, refusing a second one for a repository. */
  async function newRepositorySourceId(
    req: Request,
    existing: ContextSource[],
    repoFullName: string,
  ): Promise<string> {
    await requireLinkable(req, repoFullName);
    const already = existing.find(
      (source) =>
        source.kind === 'repository' &&
        (source.config as { repoFullName?: string }).repoFullName === repoFullName,
    );
    if (already) {
      throw createAppError(
        `${repoFullName} already has a Repository source ("${already.id}").`,
        409,
      );
    }
    return repositorySourceId(repoFullName);
  }

  /** The id a new site source takes, refusing a URL the workspace already has. */
  function newSiteSourceId(existing: ContextSource[], config: SiteSourceConfig): string {
    const already = existing.find(
      (source) =>
        source.kind === 'site' &&
        (source.config as SiteSourceConfig).llmsTxtUrl === config.llmsTxtUrl,
    );
    if (already) {
      throw createAppError(
        `${config.llmsTxtUrl} is already a source of this workspace ("${already.id}").`,
        409,
      );
    }
    return siteSourceId(config.llmsTxtUrl, new Set(existing.map((source) => source.id)));
  }

  // --- Sync now ------------------------------------------------------------

  router.post('/sources/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      if (source.status === 'paused') {
        res.status(409).json({ error: `${source.title} is paused. Resume it to sync.` });
        return;
      }
      const outcome = await requireJobs().enqueueContextSync({
        workspaceOrgId: org,
        sourceId,
        source: 'manual',
      });
      if (outcome.status === 'busy') {
        res.status(409).json({ error: `${source.title} is already syncing.` });
        return;
      }
      res.status(202).json({ jobId: outcome.jobId });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Pause / resume ------------------------------------------------------

  router.post('/sources/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const body = (req.body ?? {}) as { paused?: unknown };
      if (typeof body.paused !== 'boolean') {
        res.status(400).json({ error: 'Missing { paused: boolean }.' });
        return;
      }
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      // Pausing keeps the note a failure left, so resuming puts the source back
      // where it was rather than reporting a success that never happened.
      const status = body.paused
        ? 'paused'
        : source.statusNote
          ? 'failed'
          : source.lastSyncAt
            ? 'synced'
            : 'never';
      const updated = await updateContextSource(org, sourceId, { status });
      await emitContextChanged(org, { change: 'sources', sourceId });
      res.json({ source: updated });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Remove --------------------------------------------------------------

  router.delete('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      // Named BEFORE the removal, because the links go with it — the answer
      // says which repositories just stopped reading this source.
      const repositories = (await listContextBindings(org))
        .filter((binding) => binding.sourceId === sourceId)
        .map((binding) => binding.repoFullName);
      await removeContextSource(org, sourceId);
      await emitContextChanged(org, { change: 'sources', sourceId });
      res.json({ removed: source, repositories });
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
      const entry = await getProjectBySlug(req.params.id as string);
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
      const entry = await getProjectBySlug(req.params.id as string);
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
      await setContextBindings(org, entry.name, wanted);
      await emitContextChanged(org, { change: 'bindings', repoFullName: entry.name });
      res.json({ repoFullName: entry.name, sourceIds: await contextBindings(org, entry.name) });
    } catch (e) {
      respond(res, next, e);
    }
  });

  return router;
}
