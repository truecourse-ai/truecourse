/**
 * Context routes — the WORKSPACE's documentation sources.
 *
 *   GET    /api/context/sources               every source, with its document count and readers
 *   POST   /api/context/sources               add one (kind, config, repoIds) and sync it
 *   POST   /api/context/sources/preview       what a scope WOULD yield — reads, stores nothing
 *   GET    /api/context/sources/:id           one source and its syncs — the source's page
 *   PATCH  /api/context/sources/:id           { config } — a new scope, and the sync it starts
 *   POST   /api/context/sources/:id/sync      Sync now
 *   POST   /api/context/sources/:id/pause     { paused: boolean }
 *   DELETE /api/context/sources/:id           drop the source, its documents and every link
 *   GET    /api/context/sources/:id/documents its ledger
 *   GET    /api/context/doc?ref=              one document's body, by its corpus ref
 *   GET    /api/context/documents             the rows of the Documents view, status folded
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
 * Every mutation emits the workspace-level `context.changed` event on the SSE
 * stream the workspace already holds open, so the Context pages re-read without
 * a repo socket room.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { log } from '@truecourse/core/lib/logger';
import { getProjectBySlug, readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import {
  contextBindings,
  contextChangedAt,
  contextReposForSource,
  createContextSource,
  getContextSource,
  listContextBindings,
  listContextDocuments,
  listContextSources,
  listContextSyncs,
  readContextDocByRef,
  removeContextSource,
  setContextBindings,
  updateContextSource,
} from '@truecourse/core/lib/context-store';
import {
  composeContextDocumentRows,
  corpusDocSourceId,
  ContextConfigError,
  ContextKindUnsupportedError,
  filterContextDocumentRows,
  isImplementedContextKind,
  repositoryConfig,
  repositorySourceId,
  siteConfig,
  siteSourceId,
} from '@truecourse/core/services/context';
import {
  InvalidSourceUrlError,
  LlmsTxtFetchError,
  type ConflictResolution,
  type CuratedCorpus,
  type DecisionsFile,
} from '@truecourse/spec-consolidator';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  addWorkspaceConflictResolution,
  addWorkspaceManualExclude,
  addWorkspaceManualInclude,
  getWorkspaceDecisions,
  removeWorkspaceConflictResolution,
  removeWorkspaceManualExclude,
  removeWorkspaceManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import {
  docCoveragePlainStatus,
  readGuardCoverageSources,
} from '@truecourse/core/commands/guard-read';
import { LlmNotConfiguredError, LlmProbeFailedError, startWorkspaceLlm } from '../services/workspace-llm.service.js';
import {
  contextIsStale,
  recordFailedWorkspaceScanRun,
} from '../services/context-scan.service.js';
import {
  CONTEXT_SOURCE_KINDS,
  type ContextSource,
  type GuardCoveragePlainStatus,
  type ContextSourceConfig,
  type ContextSourceKind,
  type ContextSourceView,
  type RepositorySourceConfig,
  type SiteSourceConfig,
} from '@truecourse/shared';
import { requireJobs } from '../jobs/current.js';
import { emitContextChanged, serverContextDrivers } from '../services/context.service.js';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';

/**
 * What Context needs of GitHub to store a source for a repository, whether or
 * not Code has connected it. A source may read ANY repository one of the
 * workspace's installations can reach, so the installation is what is
 * validated, and reaching the repository through it is also where its default
 * branch comes from.
 */
export interface ContextGithubAccess {
  /** The ids of the installations this workspace connected. */
  listInstallations(workspaceOrgId: string): Promise<number[]>;
  /** The Code link of a connected repository, or null when it has none. */
  linkFor(
    repoFullName: string,
  ): Promise<{ installationId: number; defaultBranch: string } | null>;
  /** The repository as one installation sees it, or null when it cannot reach it. */
  reachRepository(
    installationId: number,
    repoFullName: string,
  ): Promise<{ defaultBranch: string } | null>;
}

export interface ContextRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  githubLinks?: RepoOwnershipLookup | null;
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

/** The same view for ONE source: its documents counted, its readers named. */
async function oneView(org: string, source: ContextSource): Promise<ContextSourceView> {
  const [documents, readers] = await Promise.all([
    listContextDocuments(org, source.id),
    contextReposForSource(org, source.id),
  ]);
  return toView(
    source,
    new Map([[source.id, documents.length]]),
    new Map([[source.id, readers]]),
  );
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

/** One query parameter's values — `?repo=a&repo=b` and `?repo=a` read alike. */
function queryValues(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((value) => String(value).trim()).filter((value) => value !== '');
}

/** The verdicts a conflict resolution may carry — the repository route's set. */
const CONFLICT_VERDICTS = ['a', 'b', 'dismissed'] as const;

/**
 * Start the workspace Document scan after a change to WHICH documents the
 * corpus should hold (a source removed, a repository's links replaced). Returns
 * the job id, or null when a scan is already running — which is not a failure:
 * the running scan's settle hook re-reads the workspace's staleness stamp and
 * queues the one follow-up run itself.
 */
async function startWorkspaceScan(org: string, source: 'link'): Promise<string | null> {
  try {
    const outcome = await requireJobs().enqueueContextScan({ workspaceOrgId: org, source });
    return outcome.status === 'queued' ? outcome.jobId : null;
  } catch (err) {
    // A queue that is not running must not fail the change the user just made.
    log.warn(`[context] could not start the document scan for ${org}: ${(err as Error).message}`);
    return null;
  }
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

  // ONE source, with the syncs that made it what it is — the source's own page
  // reads exactly this, and says nothing it does not carry.
  router.get('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      const [view, syncs] = await Promise.all([
        oneView(org, source),
        listContextSyncs(org, sourceId, 50),
      ]);
      res.json({ source: view, syncs });
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

  // The workspace corpus, in the same payload shape the repository's corpus
  // route answers with, so the corpus components render either unchanged. The
  // documents carry their source in the artifact (the scan stamps it), so
  // nothing is enriched at read time.
  router.get('/corpus', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const [corpus, decisions] = await Promise.all([
        loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
        getWorkspaceDecisions(org),
      ]);
      if (!corpus) {
        res.status(404).json({ error: 'No documents have been scanned yet.' });
        return;
      }
      res.json({
        corpus,
        manualIncludes: decisions.manualIncludes ?? [],
        manualExcludes: decisions.manualExcludes ?? [],
        conflictResolutions: decisions.conflictResolutions ?? [],
      });
    } catch (e) {
      respond(res, next, e);
    }
  });

  /**
   * THE Documents view (plan §5): one row per document of the workspace
   * corpus, composed here rather than in the browser — the row's status is a
   * join over every repository that reads it, and no client may be asked to
   * fan that out.
   *
   * The reads are per REPOSITORY, never per document: each repository's guard
   * state is read once and every document it reads is composed against it, and
   * each document's body is read once for the workspace however many
   * repositories read it. A document no repository reads is answered without
   * reading its body at all.
   *
   * `?area=&status=&source=&repo=` narrow the answer, repeatable, AND across
   * dimensions and OR within one — the same reading the page's filter row has.
   */
  router.get('/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
      if (!corpus) {
        res.json({ documents: [], corpusAt: null });
        return;
      }
      const [sources, documents, bindings] = await Promise.all([
        listContextSources(org),
        listContextDocuments(org),
        listContextBindings(org),
      ]);

      // The repositories a row may name: the ones this caller can see, by the
      // `owner/repo` the bindings key on and the store key guard reads by.
      const visible = new Map<string, RegistryEntry>();
      for (const entry of (await linkableRepos(req)).values()) visible.set(entry.name, entry);

      // Which documents each visible repository reads: its linked sources' docs.
      const docsBySource = new Map<string, string[]>();
      for (const doc of corpus.docs) {
        const sourceId = corpusDocSourceId(doc);
        if (!sourceId) continue;
        docsBySource.set(sourceId, [...(docsBySource.get(sourceId) ?? []), doc.ref]);
      }
      const refsByRepo = new Map<string, string[]>();
      for (const binding of bindings) {
        if (!visible.has(binding.repoFullName)) continue;
        const refs = docsBySource.get(binding.sourceId) ?? [];
        if (refs.length === 0) continue;
        refsByRepo.set(binding.repoFullName, [
          ...(refsByRepo.get(binding.repoFullName) ?? []),
          ...refs,
        ]);
      }

      // One body read per document, for the documents somebody reads.
      const bodies = new Map<string, string>();
      for (const ref of new Set([...refsByRepo.values()].flat())) {
        const body = await readContextDocByRef(org, ref);
        if (body !== null) bodies.set(ref, body);
      }

      // One guard-state read per repository, then every document it reads
      // composed against it. The externals index is deliberately not read: it
      // never changes which of the five words a section wears.
      const coverage = new Map<string, Map<string, GuardCoveragePlainStatus>>();
      for (const [repoFullName, refs] of refsByRepo) {
        const guard = await readGuardCoverageSources(visible.get(repoFullName)!.path, undefined, {
          externals: false,
        });
        const words = new Map<string, GuardCoveragePlainStatus>();
        for (const ref of new Set(refs)) {
          const body = bodies.get(ref);
          if (body === undefined) continue;
          const word = docCoveragePlainStatus(ref, body, guard);
          if (word) words.set(ref, word);
        }
        coverage.set(repoFullName, words);
      }

      const rows = composeContextDocumentRows({
        corpus,
        sources,
        documents,
        bindings,
        coverage,
        visibleRepos: new Set(visible.keys()),
      });
      res.json({
        documents: filterContextDocumentRows(rows, {
          area: req.query.area === undefined ? [] : queryValues(req.query.area),
          status: req.query.status === undefined ? [] : queryValues(req.query.status),
          source: req.query.source === undefined ? [] : queryValues(req.query.source),
          repo: req.query.repo === undefined ? [] : queryValues(req.query.repo),
        }),
        corpusAt: corpus.generatedAt ?? null,
      });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // Has the workspace's Context moved since the corpus was built? One stamp
  // against one stamp — the amber dot on Scan reads exactly this.
  router.get('/staleness', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const [changedAt, corpus] = await Promise.all([
        contextChangedAt(org),
        loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
      ]);
      const corpusAt = corpus?.generatedAt ?? null;
      // No corpus yet is not "stale": there is nothing to be behind. The
      // Context page shows a workspace that never scanned as never scanned.
      res.json({ changedAt, corpusAt, stale: contextIsStale(corpusAt, changedAt) });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Scan ----------------------------------------------------------------

  // The workspace Document scan. The asking workspace's provider is proved
  // BEFORE anything is queued, exactly as the repository scan route did it: an
  // unconfigured provider is a setting to fill in, not a job that dies later.
  router.post('/scan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      try {
        await startWorkspaceLlm(org);
      } catch (e) {
        if (e instanceof LlmNotConfiguredError) {
          res.status(409).json({ error: e.code, message: e.message });
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
  //
  // The workspace's corpus is one corpus, so a force-include, a force-exclude
  // and a conflict verdict are settled ONCE here rather than per repository.
  // Each write persists the decisions artifact and acks it; the corpus itself
  // is unchanged until the next scan, which is what the staleness dot says.

  const includeAck = (decisions: DecisionsFile): Record<string, unknown> => ({
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
  });

  /** `{ ref }` off a decision request body, or a refusal. */
  function readRef(req: Request): string {
    const ref = (req.body as { ref?: unknown })?.ref;
    if (typeof ref !== 'string' || !ref.trim()) throw new ContextConfigError('Missing ref.');
    return ref.trim();
  }

  router.post('/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      res.json(includeAck(await addWorkspaceManualInclude(org, readRef(req))));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/includes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      res.json(includeAck(await removeWorkspaceManualInclude(org, readRef(req))));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.post('/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      res.json(includeAck(await addWorkspaceManualExclude(org, readRef(req))));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/excludes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      res.json(includeAck(await removeWorkspaceManualExclude(org, readRef(req))));
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.post('/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const body = (req.body ?? {}) as Partial<ConflictResolution>;
      if (!body.docA || !body.docB || body.docA === body.docB) {
        res.status(400).json({ error: 'docA and docB are required and must differ.' });
        return;
      }
      if (!body.verdict || !CONFLICT_VERDICTS.includes(body.verdict)) {
        res.status(400).json({ error: `verdict must be one of ${CONFLICT_VERDICTS.join(', ')}.` });
        return;
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
      res.json({ conflictResolutions: decisions.conflictResolutions ?? [] });
    } catch (e) {
      respond(res, next, e);
    }
  });

  router.delete('/conflict-resolution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const body = (req.body ?? {}) as {
        docA?: string;
        anchorA?: string | null;
        docB?: string;
        anchorB?: string | null;
      };
      if (!body.docA || !body.docB) {
        res.status(400).json({ error: 'docA and docB are required.' });
        return;
      }
      const decisions = await removeWorkspaceConflictResolution(org, {
        docA: body.docA,
        anchorA: body.anchorA ?? null,
        docB: body.docB,
        anchorB: body.anchorB ?? null,
      });
      res.json({ conflictResolutions: decisions.conflictResolutions ?? [] });
    } catch (e) {
      respond(res, next, e);
    }
  });

  // --- Check ---------------------------------------------------------------

  // What an add WOULD yield, before anything is stored: the count and the first
  // titles. Runs the real driver — no source exists yet, so nothing is written.
  router.post('/sources/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const body = (req.body ?? {}) as { kind?: unknown; config?: unknown; installationId?: unknown };
      const kind = readKind(body);
      const scope = await scopeFor(req, kind, body.config, body.installationId);
      const driver = serverContextDrivers(org).get(kind)!;
      res.json(await driver.check(scope.config));
    } catch (e) {
      respond(res, next, e);
    }
  });

  /** Is this repository one this workspace connected in Code? */
  async function isLinkable(req: Request, repoFullName: string): Promise<boolean> {
    return (await linkableRepos(req)).has(repoFullName);
  }

  /**
   * WHICH installation reads a repository source, and on which branch. Two ways
   * in, and no third: the request names an installation of this workspace that
   * can reach the repository, or the repository is one this workspace connected
   * in Code and its link says both. Nothing is resolved for a repository that is
   * neither, and the scope it yields is refused for want of an installation.
   */
  async function repositoryAccess(
    req: Request,
    repoFullName: string,
    asked: unknown,
  ): Promise<{ installationId?: number; defaultBranch?: string }> {
    const access = deps.github ?? null;
    if (asked === undefined || asked === null) {
      // The link is only read for a repository this workspace can see, so
      // naming another workspace's repository resolves nothing.
      if (!(await isLinkable(req, repoFullName))) return {};
      const link = await access?.linkFor(repoFullName);
      return link
        ? { installationId: link.installationId, defaultBranch: link.defaultBranch }
        : {};
    }
    const installationId =
      typeof asked === 'number' && Number.isInteger(asked) && asked > 0 ? asked : 0;
    const installations =
      access && installationId > 0 ? await access.listInstallations(orgOf(req)) : [];
    if (!installations.includes(installationId)) {
      throw createAppError('That GitHub account is not connected to this workspace.', 400);
    }
    const reached = await access!.reachRepository(installationId, repoFullName);
    if (!reached) {
      throw createAppError(`Repository "${repoFullName}" not found`, 404);
    }
    return { installationId, defaultBranch: reached.defaultBranch };
  }

  /**
   * The scope a source is stored and checked with. A repository scope is
   * completed first: the installation it reads through and, when the request
   * named no branch, the branch that installation resolved.
   */
  async function scopeFor(
    req: Request,
    kind: ContextSourceKind,
    rawConfig: unknown,
    installationId: unknown,
  ): Promise<NormalizedConfig> {
    if (kind !== 'repository') return normalizeConfig(kind, rawConfig);
    const raw = (rawConfig ?? {}) as Partial<RepositorySourceConfig>;
    const repoFullName = typeof raw.repoFullName === 'string' ? raw.repoFullName.trim() : '';
    const resolved = await repositoryAccess(req, repoFullName, installationId);
    const branch = typeof raw.branch === 'string' ? raw.branch.trim() : '';
    return normalizeConfig('repository', {
      ...raw,
      ...(resolved.installationId === undefined ? {} : { installationId: resolved.installationId }),
      branch: branch || resolved.defaultBranch || '',
    });
  }

  // --- Add -----------------------------------------------------------------

  router.post('/sources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const body = (req.body ?? {}) as {
        kind?: unknown;
        config?: unknown;
        repoIds?: unknown;
        installationId?: unknown;
      };
      const kind = readKind(body);
      const scope = await scopeFor(req, kind, body.config, body.installationId);
      const repoKeys = await readRepoIds(req, body.repoIds);

      const existing = await listContextSources(org);
      const id =
        scope.kind === 'repository'
          ? newRepositorySourceId(existing, scope.config.repoFullName)
          : newSiteSourceId(existing, scope.config);

      const source = await createContextSource(org, {
        id,
        kind,
        title: titleFor(scope),
        config: scope.config,
      });
      // A Repository source is read by the repository it scopes, when Code has
      // connected that repository; a source for one Code has not is read by
      // nobody until somebody links it. A site is read by whoever the caller
      // named, which may be nobody.
      const links =
        scope.kind === 'repository' && (await isLinkable(req, scope.config.repoFullName))
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
  function newRepositorySourceId(existing: ContextSource[], repoFullName: string): string {
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

  // --- Edit the scope ------------------------------------------------------

  /**
   * A new scope for a source that already exists, validated exactly as the add
   * validates one. A repository source keeps the repository it was created for
   * — everything else about its scope (the branch, the patterns) is editable.
   */
  function editedConfig(source: ContextSource, raw: unknown): NormalizedConfig {
    if (!isImplementedContextKind(source.kind)) throw new ContextKindUnsupportedError(source.kind);
    if (source.kind !== 'repository') return normalizeConfig(source.kind, raw);
    const current = source.config as Partial<RepositorySourceConfig>;
    const stored = current.repoFullName ?? '';
    const asked = (raw ?? {}) as Partial<RepositorySourceConfig>;
    const named = typeof asked.repoFullName === 'string' ? asked.repoFullName.trim() : '';
    if (named !== '' && named !== stored) {
      throw new ContextConfigError(
        `A repository source always reads ${stored}; its repository cannot be changed.`,
      );
    }
    // The repository and the installation that reads it are what the source was
    // created with; an edit replaces the branch and the patterns around them.
    return normalizeConfig('repository', {
      ...asked,
      repoFullName: stored,
      installationId: current.installationId,
    });
  }

  /**
   * The scope a source reads, replaced. The new documents are the old ones'
   * replacement, so the edit SYNCS — a paused source is the one exception, and
   * its answer says so rather than leaving the reader to guess.
   */
  router.patch('/sources/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const sourceId = req.params.id as string;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      // A sync already reading the old scope would store documents the new one
      // does not name, so the edit waits for it rather than racing it.
      if (source.status === 'syncing') {
        res.status(409).json({ error: `${source.title} is already syncing.` });
        return;
      }
      const body = (req.body ?? {}) as { config?: unknown };
      const scope = editedConfig(source, body.config);
      if (scope.kind === 'site') {
        const clash = (await listContextSources(org)).find(
          (other) =>
            other.id !== sourceId &&
            other.kind === 'site' &&
            (other.config as SiteSourceConfig).llmsTxtUrl === scope.config.llmsTxtUrl,
        );
        if (clash) {
          throw createAppError(
            `${scope.config.llmsTxtUrl} is already a source of this workspace ("${clash.id}").`,
            409,
          );
        }
      }

      const updated = await updateContextSource(org, sourceId, { config: scope.config });
      if (!updated) {
        res.status(404).json({ error: `Context source "${sourceId}" not found` });
        return;
      }
      await emitContextChanged(org, { change: 'sources', sourceId });
      const view = await oneView(org, updated);

      // Pausing is the user's own stop, and every trigger honors it — including
      // this one. Resuming is what syncs the scope just stored.
      if (updated.status === 'paused') {
        res.status(202).json({
          source: view,
          note: `${updated.title} is paused. Resume it to sync this scope.`,
        });
        return;
      }
      const outcome = await requireJobs().enqueueContextSync({
        workspaceOrgId: org,
        sourceId,
        source: 'manual',
      });
      if (outcome.status === 'busy') {
        res.status(409).json({ error: `${updated.title} is already syncing.` });
        return;
      }
      res.status(202).json({ source: view, jobId: outcome.jobId });
    } catch (e) {
      respond(res, next, e);
    }
  });

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
      // The corpus still holds this source's documents; re-scanning is what
      // takes them out of it (and out of every repository's slice).
      const scan = await startWorkspaceScan(org, 'link');
      res.json({ removed: source, repositories, ...(scan ? { jobId: scan } : {}) });
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
      // Only a set that actually DIFFERS is a change: saving the toggles
      // untouched must not re-scan the workspace.
      const before = await contextBindings(org, entry.name);
      const differs =
        before.length !== wanted.length || wanted.some((id) => !before.includes(id));
      await setContextBindings(org, entry.name, wanted);
      if (!differs) {
        res.json({ repoFullName: entry.name, sourceIds: await contextBindings(org, entry.name) });
        return;
      }
      await emitContextChanged(org, { change: 'bindings', repoFullName: entry.name });
      // The slices moved, so the corpus must be recomputed over them — the scan
      // is what re-derives who reads what, and its ripple regenerates the tests.
      const jobId = await startWorkspaceScan(org, 'link');
      res.json({
        repoFullName: entry.name,
        sourceIds: await contextBindings(org, entry.name),
        ...(jobId ? { jobId } : {}),
      });
    } catch (e) {
      respond(res, next, e);
    }
  });

  return router;
}
