/**
 * The workspace's documentation SOURCES, and the documents they yielded: what
 * the Context routes and the MCP tools both call.
 *
 * A source belongs to the workspace, not to a repository, so every operation
 * takes the workspace it acts in. The repository half of a request — which
 * repositories may read a source, and how a Repository source reaches its
 * repository — is answered against the caller's own repositories: one another
 * workspace connected is not found, never fetched and refused.
 *
 * Refusals are thrown, never answered: an `AppError` carries its status, and
 * the engine's own refusals (`ContextConfigError` and its kin,
 * `WorkspaceDescriptionRequiredError`) carry their own words. An adapter —
 * route or tool — decides how to say them.
 *
 * Every mutation emits the workspace-level `context.changed` event, so the
 * Context pages re-read whichever surface made the change.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import { log } from '@truecourse/core/lib/logger';
import { readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
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
  repositoryConfig,
  repositorySourceId,
  siteConfig,
  siteSourceId,
  type ContextDocumentFilter,
  type ContextSourceDriver,
  type ContextSourceScope,
} from '@truecourse/core/services/context';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import {
  docCoveragePlainStatus,
  readGuardCoverageSources,
} from '@truecourse/core/commands/guard-read';
import { requireWorkspaceDescription } from '@truecourse/core/lib/workspace-profile-store';
import {
  CONTEXT_SOURCE_KINDS,
  type ContextDocumentsViewResponse,
  type ContextSource,
  type ContextSourceConfig,
  type ContextSourceKind,
  type ContextSourceView,
  type GuardCoveragePlainStatus,
  type RepositoryProviderId,
  type RepositorySourceConfig,
  type SiteSourceConfig,
} from '@truecourse/shared';
import { requireJobs } from '../jobs/current.js';
import { captureAction, EVENTS } from '../observability/posthog.js';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';
import { addableContextKinds, emitContextChanged, serverContextDrivers } from './context.service.js';

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

/** Who is acting on the workspace's Context, and what their repositories are answered from. */
export interface ContextCaller {
  org: string;
  /** The person behind the request, when one is. */
  userId?: string;
  /** Which workspace owns a connected repository; null means none is visible. */
  repoLinks: RepoOwnershipLookup | null | undefined;
  /** The GitHub connection's installation access; absent when GitHub is unconfigured. */
  github: ContextGithubAccess | null | undefined;
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

/** The source by id, or a 404 naming it. */
async function requireSource(org: string, sourceId: string): Promise<ContextSource> {
  const source = await getContextSource(org, sourceId);
  if (!source) throw createAppError(`Context source "${sourceId}" not found`, 404);
  return source;
}

/** A kind whose identity its DRIVER names, because the open edition cannot. */
type DriverNamedKind = Exclude<ContextSourceKind, 'repository' | 'site'>;

/**
 * A validated scope, tagged by the kind it belongs to, so callers narrow. The
 * two the open edition names itself carry their own shape; every other kind
 * arrives with the identity its driver gave it (an Atlassian source is named
 * after the site its workspace connected, which only the driver can look up).
 */
type NormalizedConfig =
  | { kind: 'repository'; config: RepositorySourceConfig }
  | { kind: 'site'; config: SiteSourceConfig }
  | { kind: DriverNamedKind; config: ContextSourceConfig; identity: ContextSourceScope };

/** Validate and normalize the scope a caller supplied for this kind. */
async function normalizeConfig(
  org: string,
  kind: ContextSourceKind,
  config: unknown,
): Promise<NormalizedConfig> {
  const raw = (config ?? {}) as ContextSourceConfig;
  if (kind === 'repository') return { kind, config: repositoryConfig(raw) };
  if (kind === 'site') return { kind, config: siteConfig(raw) };
  const driver = await driverFor(org, kind);
  if (!driver.scope) throw new ContextKindUnsupportedError(kind);
  const identity = await driver.scope(raw);
  return { kind, config: identity.config, identity };
}

/** A source's title at creation: the origin names it, and the first sync corrects it. */
function titleFor(scope: NormalizedConfig): string {
  if (scope.kind === 'repository') return scope.config.repoFullName;
  if (scope.kind === 'site') return new URL(scope.config.llmsTxtUrl).host;
  return scope.identity.title;
}

/**
 * The driver this server has for a kind IN THIS WORKSPACE, or a refusal naming
 * the kind. A kind an edition drives but this workspace is not entitled to has
 * no driver here, so it reads exactly as a kind nothing can sync.
 */
async function driverFor(org: string, kind: ContextSourceKind): Promise<ContextSourceDriver> {
  const driver = (await serverContextDrivers(org)).get(kind);
  if (!driver) throw new ContextKindUnsupportedError(kind);
  return driver;
}

/**
 * The kind a caller asked for, refusing anything this server cannot sync —
 * which is a question about the DRIVERS it registered at boot, not a constant.
 */
async function readKind(org: string, asked: unknown): Promise<ContextSourceKind> {
  const kind = typeof asked === 'string' ? asked.trim() : '';
  if (!(CONTEXT_SOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new ContextConfigError(
      `Unknown source kind ${JSON.stringify(kind)}. Known kinds: ${CONTEXT_SOURCE_KINDS.join(', ')}.`,
    );
  }
  await driverFor(org, kind as ContextSourceKind);
  return kind as ContextSourceKind;
}

/**
 * The repositories this caller may link, by both names they can be given:
 * the registry slug the client routes on, and the `owner/repo` the store
 * keys by. A repository another workspace connected is simply not here.
 */
async function linkableRepos(caller: ContextCaller): Promise<Map<string, RegistryEntry>> {
  const byName = new Map<string, RegistryEntry>();
  for (const entry of await readRegistry(caller.org)) {
    if (!(await isVisibleTo(caller.repoLinks, caller.org, entry))) continue;
    byName.set(entry.slug, entry);
    byName.set(entry.name, entry);
  }
  return byName;
}

/** Is this repository one this workspace connected in Code? */
async function isLinkable(caller: ContextCaller, repoFullName: string): Promise<boolean> {
  return (await linkableRepos(caller)).has(repoFullName);
}

/** `repoIds` (slugs or `owner/repo`) → the repo keys the bindings store uses. */
async function readRepoIds(caller: ContextCaller, value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ContextConfigError('repoIds must be a list.');
  const linkable = await linkableRepos(caller);
  const out: string[] = [];
  for (const raw of value) {
    const entry = typeof raw === 'string' ? linkable.get(raw.trim()) : undefined;
    if (!entry) throw createAppError(`Repository "${String(raw)}" not found`, 404);
    if (!out.includes(entry.name)) out.push(entry.name);
  }
  return out;
}

/**
 * WHICH installation reads a repository source, and on which branch. Two ways
 * in, and no third: the request names an installation of this workspace that
 * can reach the repository, or the repository is one this workspace connected
 * in Code and its link says both. Nothing is resolved for a repository that is
 * neither, and the scope it yields is refused for want of an installation.
 */
async function repositoryAccess(
  caller: ContextCaller,
  repoFullName: string,
  asked: unknown,
): Promise<{
  provider?: RepositoryProviderId;
  path?: string;
  installationId?: number;
  defaultBranch?: string;
}> {
  const access = caller.github ?? null;
  // A folder on this machine answers for itself: there is no account to name
  // and nothing to reach over the network, only the path it was connected
  // from. It must be one this workspace connected — the only way a path
  // becomes a repository here.
  if (await isLinkable(caller, repoFullName)) {
    const connected = await caller.repoLinks?.getRepo(repoFullName);
    if (connected?.provider === 'local' && connected.location) {
      return { provider: 'local', path: connected.location };
    }
  }
  if (asked === undefined || asked === null) {
    // The link is only read for a repository this workspace can see, so
    // naming another workspace's repository resolves nothing.
    if (!(await isLinkable(caller, repoFullName))) return {};
    const link = await access?.linkFor(repoFullName);
    return link
      ? { installationId: link.installationId, defaultBranch: link.defaultBranch }
      : {};
  }
  const installationId =
    typeof asked === 'number' && Number.isInteger(asked) && asked > 0 ? asked : 0;
  const installations =
    access && installationId > 0 ? await access.listInstallations(caller.org) : [];
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
  caller: ContextCaller,
  kind: ContextSourceKind,
  rawConfig: unknown,
  installationId: unknown,
): Promise<NormalizedConfig> {
  if (kind !== 'repository') return normalizeConfig(caller.org, kind, rawConfig);
  const raw = (rawConfig ?? {}) as Partial<RepositorySourceConfig>;
  const repoFullName = typeof raw.repoFullName === 'string' ? raw.repoFullName.trim() : '';
  const resolved = await repositoryAccess(caller, repoFullName, installationId);
  const branch = typeof raw.branch === 'string' ? raw.branch.trim() : '';
  return normalizeConfig(caller.org, 'repository', {
    ...raw,
    ...(resolved.provider === undefined ? {} : { provider: resolved.provider }),
    ...(resolved.path === undefined ? {} : { path: resolved.path }),
    ...(resolved.installationId === undefined ? {} : { installationId: resolved.installationId }),
    branch: branch || resolved.defaultBranch || '',
  });
}

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

/**
 * The id a driver named, refused when the workspace already holds it: a
 * project or a space is one source, and adding it twice would be two ledgers
 * of the same documents.
 */
function newDriverSourceId(existing: ContextSource[], identity: ContextSourceScope): string {
  const already = existing.find((source) => source.id === identity.sourceId);
  if (already) {
    throw createAppError(
      `${identity.title} is already a source of this workspace ("${already.id}").`,
      409,
    );
  }
  return identity.sourceId;
}

/**
 * A new scope for a source that already exists, validated exactly as the add
 * validates one. A repository source keeps the repository it was created for
 * — everything else about its scope (the branch, the patterns) is editable.
 */
async function editedConfig(
  org: string,
  source: ContextSource,
  raw: unknown,
): Promise<NormalizedConfig> {
  if (source.kind !== 'repository') return normalizeConfig(org, source.kind, raw);
  const current = source.config as Partial<RepositorySourceConfig>;
  const stored = current.repoFullName ?? '';
  const asked = (raw ?? {}) as Partial<RepositorySourceConfig>;
  const named = typeof asked.repoFullName === 'string' ? asked.repoFullName.trim() : '';
  if (named !== '' && named !== stored) {
    throw new ContextConfigError(
      `A repository source always reads ${stored}; its repository cannot be changed.`,
    );
  }
  // The repository and how it is read are what the source was created with;
  // an edit replaces the branch and the patterns around them.
  return normalizeConfig(org, 'repository', {
    ...asked,
    repoFullName: stored,
    ...(current.provider === undefined ? {} : { provider: current.provider }),
    ...(current.path === undefined ? {} : { path: current.path }),
    installationId: current.installationId,
  });
}

/**
 * Start the workspace Document scan after a change to WHICH documents the
 * corpus should hold (a source removed). Returns the job id, or null when a
 * scan is already running — which is not a failure: the running scan's settle
 * hook re-reads the workspace's staleness stamp and queues the one follow-up
 * run itself.
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

// --- Read --------------------------------------------------------------------

/** Every source, with its document count and readers, and the kinds this server can add. */
export async function listSources(org: string): Promise<{
  sources: ContextSourceView[];
  changedAt: string | null;
  addableKinds: ContextSourceKind[];
}> {
  const [sources, changedAt] = await Promise.all([listViews(org), contextChangedAt(org)]);
  // Which kinds can be ADDED is this server's own answer — the drivers it
  // registered at boot — so an add offers what exists here and nothing else.
  return { sources, changedAt, addableKinds: await addableContextKinds(org) };
}

/** ONE source, with the syncs that made it what it is. */
export async function readSource(
  org: string,
  sourceId: string,
): Promise<{ source: ContextSourceView; syncs: Awaited<ReturnType<typeof listContextSyncs>> }> {
  const source = await requireSource(org, sourceId);
  const [view, syncs] = await Promise.all([oneView(org, source), listContextSyncs(org, sourceId, 50)]);
  return { source: view, syncs };
}

/** One source's ledger: the documents it yielded. */
export async function readSourceDocuments(
  org: string,
  sourceId: string,
): Promise<{ source: ContextSourceView; documents: Awaited<ReturnType<typeof listContextDocuments>> }> {
  const source = await requireSource(org, sourceId);
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
  return { source: view, documents };
}

/**
 * THE Documents view: one row per document of the workspace corpus, composed
 * here rather than in the browser — the row's status is a join over every
 * repository that reads it, and no client may be asked to fan that out.
 *
 * The reads are per REPOSITORY, never per document: each repository's guard
 * state is read once and every document it reads is composed against it, and
 * each document's body is read once for the workspace however many
 * repositories read it. A document no repository reads is answered without
 * reading its body at all.
 *
 * The rows are every document Context knows, not only the kept ones: the
 * decisions ride in, so a document the scan skipped and a document a reader
 * excluded each get a row saying where it stands and why.
 */
export async function listWorkspaceDocuments(
  caller: ContextCaller,
  filter: ContextDocumentFilter,
): Promise<ContextDocumentsViewResponse> {
  const org = caller.org;
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
  if (!corpus) return { documents: [], corpusAt: null };
  const [sources, documents, bindings, decisions] = await Promise.all([
    listContextSources(org),
    listContextDocuments(org),
    listContextBindings(org),
    getWorkspaceDecisions(org),
  ]);

  // The repositories a row may name: the ones this caller can see, by the
  // `owner/repo` the bindings key on and the store key guard reads by.
  const visible = new Map<string, RegistryEntry>();
  for (const entry of (await linkableRepos(caller)).values()) visible.set(entry.name, entry);

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
    refsByRepo.set(binding.repoFullName, [...(refsByRepo.get(binding.repoFullName) ?? []), ...refs]);
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
    decisions: {
      manualIncludes: decisions.manualIncludes ?? [],
      manualExcludes: decisions.manualExcludes ?? [],
    },
  });
  return {
    documents: filterContextDocumentRows(rows, filter),
    corpusAt: corpus.generatedAt ?? null,
  };
}

// --- Check -------------------------------------------------------------------

/** The request that adds (or previews) a source. */
export interface SourceRequest {
  kind?: unknown;
  config?: unknown;
  installationId?: unknown;
}

/** What an add WOULD yield, before anything is stored: runs the real driver. */
export async function previewSource(caller: ContextCaller, request: SourceRequest) {
  const kind = await readKind(caller.org, request.kind);
  const scope = await scopeFor(caller, kind, request.config, request.installationId);
  return (await driverFor(caller.org, kind)).check(scope.config);
}

// --- Add ---------------------------------------------------------------------

/**
 * Add a source and, unless asked not to, sync it. Added without a sync, a
 * source is stored paused: the sweep and a push would otherwise sync one that
 * has never synced within the hour.
 */
export async function addSource(
  caller: ContextCaller,
  request: SourceRequest & { repoIds?: unknown; sync?: unknown },
): Promise<{ source: ContextSourceView; jobId?: string }> {
  const org = caller.org;
  // Nothing enters a workspace that has not said what its product is: the
  // documents this source yields would be attributed against nothing.
  await requireWorkspaceDescription(org);
  const sync = request.sync !== false;
  const kind = await readKind(org, request.kind);
  const scope = await scopeFor(caller, kind, request.config, request.installationId);
  const repoKeys = await readRepoIds(caller, request.repoIds);

  const existing = await listContextSources(org);
  const id =
    scope.kind === 'repository'
      ? newRepositorySourceId(existing, scope.config.repoFullName)
      : scope.kind === 'site'
        ? newSiteSourceId(existing, scope.config)
        : newDriverSourceId(existing, scope.identity);

  const source = await createContextSource(org, {
    id,
    kind,
    title: titleFor(scope),
    config: scope.config,
    ...(sync ? {} : { status: 'paused' as const }),
  });
  // A Repository source is read by the repository it scopes, when Code has
  // connected that repository; a source for one Code has not is read by
  // nobody until somebody links it. A site is read by whoever the caller
  // named, which may be nobody.
  const links =
    scope.kind === 'repository' && (await isLinkable(caller, scope.config.repoFullName))
      ? [...new Set([scope.config.repoFullName, ...repoKeys])]
      : repoKeys;
  for (const repoKey of links) {
    await setContextBindings(org, repoKey, [...new Set([...(await contextBindings(org, repoKey)), id])]);
  }
  await emitContextChanged(org, { change: 'sources', sourceId: id });

  if (caller.userId) {
    captureAction(EVENTS.contextSourceAdded, {
      userId: caller.userId,
      workspaceId: org,
      properties: { kind },
    });
  }

  const outcome = sync
    ? await requireJobs().enqueueContextSync({ workspaceOrgId: org, sourceId: id, source: 'add' })
    : null;
  return {
    source: { ...source, docCount: 0, repositories: links },
    ...(outcome?.status === 'queued' ? { jobId: outcome.jobId } : {}),
  };
}

// --- Edit the scope ----------------------------------------------------------

/**
 * The scope a source reads, replaced. The new documents are the old ones'
 * replacement, so the edit SYNCS — a paused source is the one exception, and
 * its answer says so rather than leaving the reader to guess.
 */
export async function editSource(
  org: string,
  sourceId: string,
  config: unknown,
): Promise<{ source: ContextSourceView; jobId?: string; note?: string }> {
  const source = await requireSource(org, sourceId);
  // A sync already reading the old scope would store documents the new one
  // does not name, so the edit waits for it rather than racing it.
  if (source.status === 'syncing') throw createAppError(`${source.title} is already syncing.`, 409);
  const scope = await editedConfig(org, source, config);
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
  } else if (scope.kind !== 'repository') {
    // A scope re-pointed at what another source of this workspace already
    // reads would be two ledgers of the same documents. The id it WOULD
    // take is what says so; this source keeps the id it was created with.
    const clash = (await listContextSources(org)).find(
      (other) => other.id !== sourceId && other.id === scope.identity.sourceId,
    );
    if (clash) {
      throw createAppError(
        `${scope.identity.title} is already a source of this workspace ("${clash.id}").`,
        409,
      );
    }
  }

  const updated = await updateContextSource(org, sourceId, { config: scope.config });
  if (!updated) throw createAppError(`Context source "${sourceId}" not found`, 404);
  await emitContextChanged(org, { change: 'sources', sourceId });
  const view = await oneView(org, updated);

  // Pausing is the user's own stop, and every trigger honors it — including
  // this one. Resuming is what syncs the scope just stored.
  if (updated.status === 'paused') {
    return { source: view, note: `${updated.title} is paused. Resume it to sync this scope.` };
  }
  const outcome = await requireJobs().enqueueContextSync({
    workspaceOrgId: org,
    sourceId,
    source: 'manual',
  });
  if (outcome.status === 'busy') throw createAppError(`${updated.title} is already syncing.`, 409);
  return { source: view, jobId: outcome.jobId };
}

// --- Sync now ----------------------------------------------------------------

export async function syncSource(org: string, sourceId: string): Promise<{ jobId: string }> {
  const source = await requireSource(org, sourceId);
  if (source.status === 'paused') {
    throw createAppError(`${source.title} is paused. Resume it to sync.`, 409);
  }
  const outcome = await requireJobs().enqueueContextSync({
    workspaceOrgId: org,
    sourceId,
    source: 'manual',
  });
  if (outcome.status === 'busy') throw createAppError(`${source.title} is already syncing.`, 409);
  return { jobId: outcome.jobId };
}

// --- Pause / resume ----------------------------------------------------------

export async function pauseSource(
  org: string,
  sourceId: string,
  paused: boolean,
): Promise<{ source: ContextSource | null }> {
  const source = await requireSource(org, sourceId);
  // Pausing keeps the note a failure left, so resuming puts the source back
  // where it was rather than reporting a success that never happened.
  const status = paused
    ? 'paused'
    : source.statusNote
      ? 'failed'
      : source.lastSyncAt
        ? 'synced'
        : 'never';
  const updated = await updateContextSource(org, sourceId, { status });
  await emitContextChanged(org, { change: 'sources', sourceId });
  return { source: updated };
}

// --- Remove ------------------------------------------------------------------

/** Drop the source, its documents and every link, then re-scan without them. */
export async function removeSource(
  org: string,
  sourceId: string,
): Promise<{ removed: ContextSource; repositories: string[]; jobId?: string }> {
  const source = await requireSource(org, sourceId);
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
  return { removed: source, repositories, ...(scan ? { jobId: scan } : {}) };
}
