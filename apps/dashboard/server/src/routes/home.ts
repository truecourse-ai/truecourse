/**
 * Home, the product owner's dashboard, in ONE read.
 *
 *   GET /api/home?period=7d|30d|90d|all   (default 30d)
 *
 * Workspace-scoped like every route behind the gate. It joins what is already
 * stored and composes it in core (`@truecourse/core/services/home`): today's
 * flows, the trend across the repositories' baseline runs, each area's
 * composition, what waits on a person and which documents moved.
 *
 * The reads are the Documents view's, one guard state per repository rather
 * than one per document, plus three the Documents view has no use for: each
 * repository's FLOWS (the headline, read exactly as the Flows page reads them),
 * its stored COVERAGE HISTORY (the trend; a run stored before flows were
 * recorded has its own filled in from its snapshot, once) and the runs,
 * conflicts, sources and provider the attention rows are made of.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import {
  listContextBindings,
  listContextDocuments,
  listContextSources,
  readContextDocByRef,
} from '@truecourse/core/lib/context-store';
import { composeContextDocumentRows, corpusDocSourceId } from '@truecourse/core/services/context';
import {
  composeHome,
  type HomeConflictRow,
  type HomeRepoView,
  type HomeRunRow,
  type HomeSourceRow,
} from '@truecourse/core/services/home';
import {
  docCoverageWords,
  listGuardFlows,
  readGuardCoverageHistory,
  readGuardCoverageSources,
} from '@truecourse/core/commands/guard-read';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import {
  listStoredSessionRunsForRepos,
  workspaceSessionsKey,
} from '@truecourse/core/lib/sessions-store';
import {
  guardFlowPlainStatus,
  openConflicts,
  HOME_PERIODS,
  type GuardCoveragePlainStatus,
  type HomePeriod,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { isVisibleTo, type RepoOwnershipLookup } from '../middleware/project.js';
import {
  operatorClaudeCode,
  workspaceLlmConfigStore,
} from '../services/workspace-llm.service.js';

export interface HomeRouterDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  repoLinks?: RepoOwnershipLookup | null;
}

/**
 * How many runs the attention rows look back over. Only the LATEST run of each
 * (repository, kind) can be a row, so the window has to hold at least one page
 * of recent work, not the whole archive.
 */
const RUN_WINDOW = 200;

/** The workspace the caller is acting in, or a refusal. */
function orgOf(req: Request): string {
  const org = req.user?.organizationId;
  if (!org) throw createAppError('This session has no workspace.', 403);
  return org;
}

function periodOf(value: unknown): HomePeriod {
  const asked = typeof value === 'string' ? value : '30d';
  return (HOME_PERIODS as readonly string[]).includes(asked) ? (asked as HomePeriod) : '30d';
}

export function createHomeRouter(deps: HomeRouterDeps = {}): Router {
  const router: Router = Router();

  /** The repositories this caller can see, by the `owner/repo` every store keys by. */
  async function visibleRepos(req: Request): Promise<Map<string, RegistryEntry>> {
    const visible = new Map<string, RegistryEntry>();
    for (const entry of await readRegistry(orgOf(req))) {
      if (!(await isVisibleTo(deps.repoLinks, req, entry))) continue;
      visible.set(entry.name, entry);
    }
    return visible;
  }

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const period = periodOf(req.query.period);
      const now = new Date().toISOString();

      const [corpus, sources, ledger, bindings, visible] = await Promise.all([
        loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
        listContextSources(org),
        listContextDocuments(org),
        listContextBindings(org),
        visibleRepos(req),
      ]);

      // Which documents each visible repository reads: its linked sources' docs.
      const docsBySource = new Map<string, string[]>();
      for (const doc of corpus?.docs ?? []) {
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

      // One body read per document somebody reads.
      const bodies = new Map<string, string>();
      for (const ref of new Set([...refsByRepo.values()].flat())) {
        const body = await readContextDocByRef(org, ref);
        if (body !== null) bodies.set(ref, body);
      }

      // One guard-state read per repository, then every document it reads
      // composed against it, the Documents view's reading kept per SECTION —
      // plus the repository's FLOWS, which are what the headline counts.
      const repos: HomeRepoView[] = [];
      const coverage = new Map<string, Map<string, GuardCoveragePlainStatus>>();
      for (const [repoFullName, refs] of refsByRepo) {
        const guard = await readGuardCoverageSources(visible.get(repoFullName)!.path, undefined, {
          externals: false,
        });
        const sections = new Map<string, GuardCoveragePlainStatus>();
        const blockedReasons = new Map<string, readonly string[]>();
        const docWords = new Map<string, GuardCoveragePlainStatus>();
        for (const ref of new Set(refs)) {
          const body = bodies.get(ref);
          if (body === undefined) continue;
          const words = docCoverageWords(ref, body, guard);
          for (const [sectionRef, word] of words.sections) sections.set(sectionRef, word);
          if (words.blockedReasons.length > 0) blockedReasons.set(ref, words.blockedReasons);
          if (words.doc) docWords.set(ref, words.doc);
        }
        coverage.set(repoFullName, docWords);
        repos.push({
          repository: repoFullName,
          sections,
          flows: await readRepoFlows(visible.get(repoFullName)!.path),
          blockedReasons,
          history: await readGuardCoverageHistory(visible.get(repoFullName)!.path),
        });
      }

      // A repository that reads no document still has flows and a history worth
      // drawing: the headline is the workspace's proving, not its documentation.
      for (const [repoFullName, entry] of visible) {
        if (refsByRepo.has(repoFullName)) continue;
        const [flows, history] = await Promise.all([
          readRepoFlows(entry.path),
          readGuardCoverageHistory(entry.path),
        ]);
        if (flows.length === 0 && history.length === 0) continue;
        repos.push({ repository: repoFullName, sections: new Map(), flows, history });
      }

      const documents = corpus
        ? composeContextDocumentRows({
            corpus,
            sources,
            documents: ledger,
            bindings,
            coverage,
            visibleRepos: new Set(visible.keys()),
          })
        : [];

      const conflicts: HomeConflictRow[] = corpus
        ? openConflicts(corpus, await getWorkspaceDecisions(org)).map((conflict) => ({
            id: conflict.id,
            title: conflict.note || `${conflict.a} and ${conflict.b}`,
            area: conflict.area,
          }))
        : [];

      const homeSources: HomeSourceRow[] = sources.map((source) => ({
        id: source.id,
        title: source.title,
        status: source.status,
        statusNote: source.statusNote,
        lastSyncAt: source.lastSyncAt,
      }));

      res.json(
        composeHome({
          now,
          period,
          documents,
          repos,
          runs: await readRuns(req, org, visible),
          conflicts,
          sources: homeSources,
          providerConfigured: await hasProvider(org),
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/**
 * ONE repository's flows today, as the words they wear on the Flows page — the
 * same read that page makes, so Home's headline and the list it opens can only
 * ever agree. A repository with nothing generated yet answers an empty list.
 */
async function readRepoFlows(repoPath: string): Promise<GuardCoveragePlainStatus[]> {
  const { flows } = await listGuardFlows(repoPath);
  return flows.map((flow) => guardFlowPlainStatus(flow));
}

/**
 * The workspace's recent runs, each named by the repository it belongs to, or
 * by none, for the work the workspace itself does (a Document scan).
 */
async function readRuns(
  req: Request,
  org: string,
  visible: ReadonlyMap<string, RegistryEntry>,
): Promise<HomeRunRow[]> {
  const byPath = new Map([...visible.values()].map((entry) => [entry.path, entry.name]));
  const keys = [...byPath.keys(), workspaceSessionsKey(org)];
  const runs = await listStoredSessionRunsForRepos(keys, { limit: RUN_WINDOW });
  return runs.map((run) => ({
    runId: run.runId,
    command: run.command,
    status: run.status,
    repository: byPath.get(run.repoKey) ?? null,
    at: run.finishedAt ?? run.startedAt,
    ...(run.error?.message ? { message: run.error.message } : {}),
  }));
}

/** Whether this workspace has a provider a run could use. */
async function hasProvider(org: string): Promise<boolean> {
  if (operatorClaudeCode()) return true;
  try {
    return (await workspaceLlmConfigStore().getView(org)) != null;
  } catch {
    // An unanswered read is not a claim that the workspace has no provider.
    return true;
  }
}
