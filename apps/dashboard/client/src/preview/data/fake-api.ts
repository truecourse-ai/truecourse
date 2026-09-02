/**
 * The preview's fake backend for the REAL components it reuses.
 *
 * Two seams, and only two. The spec components read through `SpecSource`, so the
 * preview supplies one over the corpus and web-source fixtures; everything else
 * calls the API client directly, so while the preview is mounted `window.fetch`
 * answers the per-repo guard and spec routes from the fixtures and passes every
 * other request through untouched.
 *
 * The routes answered here are exactly the ones the vendored components read or
 * write: the flows inventory and a flow's detail, the committed test inventory,
 * the claim corpus, the interface catalog and its Map, one entity's raw artifact,
 * the run store (latest, history, one run, a scenario's source, an evidence
 * transcript, a run's visual evidence), the generate report, the status summary,
 * the dismissals, the dependency catalog with its per-row registration, and the
 * web-source registry with its add / refresh / remove. A write updates the
 * in-memory fixture and answers with the fresh payload, exactly as the real
 * routes do, so the UI reflects it without a socket. Nothing persists.
 */

import type { SpecSource } from '@/components/spec/spec-source';
import { sliceSkipped } from '@/components/spec/spec-source';
import { KNOWLEDGE_DOCS, knowledgeCorpusResponse, knowledgeDocByRef } from './knowledge';
import type { SpecCorpusResponse } from '@/preview/vendor/lib/api';
import type { GuardDecisions } from '@/preview/vendor/shared';
import { EMPTY_GUARD_DECISIONS } from '@/preview/vendor/shared';
import type { GuardDependencyPatch } from '@/preview/vendor/types/guard-dependencies';
import {
  corpusResponse,
  docByRef,
  docCoverage,
  docMarkdown,
  stalenessFor,
  statusSummary,
} from './corpus-fixtures';
import { dependenciesView, saveDependency } from './dependency-fixtures';
import {
  claimsView,
  flowDetail,
  flowsView,
  generateReport,
  scenarioInventory,
} from './flow-fixtures';
import { guardForRepo } from './index';
import { REPOS } from './repos';
import { interfacesView } from './interface-fixtures';
import { artifactRaw } from './artifact-fixtures';
import {
  evidenceByPath,
  evidenceText,
  latestRun,
  latestRunOnCommit,
  runById,
  runHistory,
  scenarioSource,
} from './run-fixtures';
import {
  addSource,
  listSources,
  previewSource,
  refreshSources,
  removeSource,
  sourceDetail,
  sourcePageMarkdown,
} from './source-fixtures';

/** One doc's markdown: a curated corpus doc, else a snapshotted web page. */
function markdownFor(repoId: string, ref: string): string | null {
  const doc = docByRef(repoId, ref);
  if (doc) return docMarkdown(doc);
  return sourcePageMarkdown(repoId, ref);
}

export function createPreviewSpecSource(repoId: string, versionId?: string | null): SpecSource {
  let state: SpecCorpusResponse | null = corpusResponse(repoId, versionId);
  const ack = () => ({ manualIncludes: state?.manualIncludes ?? [], manualExcludes: state?.manualExcludes ?? [] });
  return {
    supportsScan: false,
    async getCorpus() {
      return state;
    },
    async getDoc(ref) {
      const content = markdownFor(repoId, ref);
      return { ref, content: content ?? `# ${ref}\n\nNo snapshot for this document.` };
    },
    async listSkipped(q) {
      return sliceSkipped(state?.corpus.skippedDocs ?? [], q);
    },
    async addInclude(ref) {
      if (state) state = { ...state, manualIncludes: [...(state.manualIncludes ?? []), ref] };
      return ack();
    },
    async removeInclude(ref) {
      if (state) state = { ...state, manualIncludes: (state.manualIncludes ?? []).filter((r) => r !== ref) };
      return ack();
    },
    async addExclude(ref) {
      if (state) state = { ...state, manualExcludes: [...(state.manualExcludes ?? []), ref] };
      return ack();
    },
    async removeExclude(ref) {
      if (state) state = { ...state, manualExcludes: (state.manualExcludes ?? []).filter((r) => r !== ref) };
      return ack();
    },
    async postConflictResolution(payload) {
      const resolution = { ...payload, resolvedAt: new Date().toISOString() };
      if (state) state = { ...state, conflictResolutions: [...(state.conflictResolutions ?? []), resolution] };
      return { conflictResolutions: state?.conflictResolutions ?? [] };
    },
    async deleteConflictResolution(payload) {
      if (state) {
        state = {
          ...state,
          conflictResolutions: (state.conflictResolutions ?? []).filter(
            (r) =>
              !(
                ((r.docA === payload.docA && r.docB === payload.docB) ||
                  (r.docA === payload.docB && r.docB === payload.docA)) &&
                r.anchorA === payload.anchorA &&
                r.anchorB === payload.anchorB
              ),
          ),
        };
      }
      return { conflictResolutions: state?.conflictResolutions ?? [] };
    },
    async scan() {
      // No on-demand scan over fixtures.
    },
  };
}

// ---------------------------------------------------------------------------
// The dismissals, the one guard write with no fixture of its own: it starts
// empty and holds whatever the reader rules out while the page is open.
// ---------------------------------------------------------------------------

const DECISIONS = new Map<string, GuardDecisions>();

function decisions(repoId: string): GuardDecisions {
  let current = DECISIONS.get(repoId);
  if (!current) {
    current = { ...EMPTY_GUARD_DECISIONS, dismissedClaims: [], dismissedFlows: [] };
    DECISIONS.set(repoId, current);
  }
  return current;
}

interface ClaimBody {
  doc: string;
  anchor: string;
  title: string;
  note?: string;
}

function dismissClaim(repoId: string, claim: ClaimBody): GuardDecisions {
  const current = decisions(repoId);
  const next: GuardDecisions = {
    ...current,
    dismissedClaims: [
      ...current.dismissedClaims.filter(
        (c) => !(c.doc === claim.doc && c.anchor === claim.anchor && c.title === claim.title),
      ),
      { ...claim, dismissedAt: new Date().toISOString() },
    ],
  };
  DECISIONS.set(repoId, next);
  return next;
}

function undismissClaim(repoId: string, claim: ClaimBody): GuardDecisions {
  const current = decisions(repoId);
  const next: GuardDecisions = {
    ...current,
    dismissedClaims: current.dismissedClaims.filter(
      (c) => !(c.doc === claim.doc && c.anchor === claim.anchor && c.title === claim.title),
    ),
  };
  DECISIONS.set(repoId, next);
  return next;
}

function dismissFlow(repoId: string, flow: { flowId: string; title: string; note?: string }): GuardDecisions {
  const current = decisions(repoId);
  const next: GuardDecisions = {
    ...current,
    dismissedFlows: [
      ...current.dismissedFlows.filter((f) => f.flowId !== flow.flowId),
      { ...flow, dismissedAt: new Date().toISOString() },
    ],
  };
  DECISIONS.set(repoId, next);
  return next;
}

function undismissFlow(repoId: string, flowId: string): GuardDecisions {
  const current = decisions(repoId);
  const next: GuardDecisions = {
    ...current,
    dismissedFlows: current.dismissedFlows.filter((f) => f.flowId !== flowId),
  };
  DECISIONS.set(repoId, next);
  return next;
}

// ---------------------------------------------------------------------------
// The fetch shim.
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function plain(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
}

function missing(what: string): Response {
  return json({ error: `Not found: ${what}` }, 404);
}

/** The route path after `/api/repos/:repoId/`, decoded segment by segment. */
function segments(rest: string): string[] {
  return rest.split('/').map((s) => decodeURIComponent(s));
}

function answerGet(repoId: string, rest: string, params: URLSearchParams): Response {
  const parts = segments(rest);
  switch (rest) {
    case 'guard/staleness':
      return json(stalenessFor(repoId));
    case 'guard/flows':
      return json(flowsView(repoId));
    case 'guard/interfaces':
      return json(interfacesView(repoId));
    case 'guard/claims':
      return json(claimsView(repoId));
    case 'guard/scenarios':
      return json(scenarioInventory(repoId));
    case 'guard/status':
      return json(statusSummary(repoId));
    case 'guard/report':
      return json(generateReport(repoId));
    case 'guard/decisions':
      return json(decisions(repoId));
    case 'guard/dependencies':
      return json(dependenciesView(repoId));
    case 'guard/history': {
      const pr = params.get('pr');
      return json(runHistory(repoId, pr ? Number(pr) : undefined));
    }
    case 'guard/evidence/visuals':
      // Every fake run is cli or api, so none recorded a screenshot or a video:
      // the route answers an empty list, exactly as a browserless run's does.
      return json({ visuals: [] });
    case 'spec/sources':
      return json(listSources(repoId));
    default:
      break;
  }
  if (rest === 'guard/latest') {
    // With a ref (a pull request head) the route answers the envelope: the run on
    // that commit, or none yet. Without one, the raw latest run.
    const ref = params.get('ref');
    if (ref) return json({ latest: latestRunOnCommit(repoId, ref), pending: null });
    const run = latestRun(repoId);
    return run ? json(run) : missing('no guard run yet');
  }
  if (rest === 'guard/coverage') {
    const doc = docByRef(repoId, params.get('doc') ?? '');
    return doc ? json(docCoverage(repoId, doc)) : missing(params.get('doc') ?? 'doc');
  }
  if (rest === 'spec/doc') {
    const ref = params.get('ref') ?? '';
    const content = markdownFor(repoId, ref);
    return content === null ? missing(ref) : json({ ref, content });
  }
  if (rest === 'guard/scenario') {
    const source = scenarioSource(repoId, params.get('id') ?? '');
    return source ? json(source) : missing(params.get('id') ?? 'scenario');
  }
  if (rest === 'guard/evidence') {
    const transcript = evidenceText(repoId, params.get('scenarioId') ?? '');
    return transcript === null ? missing('evidence') : plain(transcript);
  }
  if (rest === 'guard/finding-evidence') {
    const transcript = evidenceByPath(repoId, params.get('path') ?? '');
    return transcript === null ? missing('evidence') : plain(transcript);
  }
  if (parts.length === 3 && parts[0] === 'guard' && parts[1] === 'flows') {
    const detail = flowDetail(repoId, parts[2]!);
    return detail ? json(detail) : missing(parts[2]!);
  }
  if (parts.length === 3 && parts[0] === 'guard' && parts[2] === 'raw') {
    const source = artifactRaw(repoId, parts[1]!, params.get('id') ?? '');
    return source ? json(source) : missing(`${parts[1]} artifact`);
  }
  if (parts.length === 3 && parts[0] === 'guard' && parts[1] === 'runs') {
    const run = runById(repoId, parts[2]!);
    return run ? json(run) : missing(parts[2]!);
  }
  if (parts.length === 3 && parts[0] === 'spec' && parts[1] === 'sources') {
    const detail = sourceDetail(repoId, parts[2]!);
    return detail ? json(detail) : missing(parts[2]!);
  }
  return missing(rest);
}

function answerPost(repoId: string, rest: string, body: Record<string, unknown>): Response {
  const parts = segments(rest);
  switch (rest) {
    case 'guard/map':
      return json(interfacesView(repoId));
    case 'guard/dismiss':
      return json(dismissClaim(repoId, body as unknown as ClaimBody));
    case 'guard/undismiss':
      return json(undismissClaim(repoId, body as unknown as ClaimBody));
    case 'guard/flows/dismiss':
      return json(dismissFlow(repoId, body as unknown as { flowId: string; title: string }));
    case 'guard/flows/undismiss':
      return json(undismissFlow(repoId, String(body.flowId ?? '')));
    case 'spec/sources/preview':
      return json(previewSource(String(body.url ?? '')));
    case 'spec/sources/refresh':
      return json(refreshSources(repoId));
    case 'spec/sources':
      return json(addSource(repoId, String(body.url ?? ''), body.id ? String(body.id) : undefined));
    default:
      break;
  }
  if (parts.length === 4 && parts[0] === 'spec' && parts[1] === 'sources' && parts[3] === 'refresh') {
    return json(refreshSources(repoId, parts[2]!));
  }
  return missing(rest);
}

function answerPut(repoId: string, rest: string, body: Record<string, unknown>): Response {
  if (rest === 'guard/dependencies') {
    const { name, ...patch } = body as { name?: string } & GuardDependencyPatch;
    return json(saveDependency(repoId, String(name ?? ''), patch));
  }
  return missing(rest);
}

function answerDelete(repoId: string, rest: string): Response {
  const parts = segments(rest);
  if (parts.length === 3 && parts[0] === 'spec' && parts[1] === 'sources') {
    const removed = removeSource(repoId, parts[2]!);
    return removed ? json(removed) : missing(parts[2]!);
  }
  return missing(rest);
}

/** The WORKSPACE source: the Knowledge corpus, read the way the repo one is. */
export function createWorkspaceSpecSource(): SpecSource {
  let state: SpecCorpusResponse = knowledgeCorpusResponse();
  const ack = () => ({ manualIncludes: state.manualIncludes ?? [], manualExcludes: state.manualExcludes ?? [] });
  return {
    supportsScan: false,
    async getCorpus() {
      return state;
    },
    async getDoc(ref) {
      const doc = knowledgeDocByRef(ref);
      return { ref, content: doc ? doc.body : `# ${ref}\n\nNo snapshot for this document.` };
    },
    async listSkipped(q) {
      return sliceSkipped(state.corpus.skippedDocs ?? [], q);
    },
    async addInclude(ref) {
      state = { ...state, manualIncludes: [...(state.manualIncludes ?? []), ref] };
      return ack();
    },
    async removeInclude(ref) {
      state = { ...state, manualIncludes: (state.manualIncludes ?? []).filter((r) => r !== ref) };
      return ack();
    },
    async addExclude(ref) {
      state = { ...state, manualExcludes: [...(state.manualExcludes ?? []), ref] };
      return ack();
    },
    async removeExclude(ref) {
      state = { ...state, manualExcludes: (state.manualExcludes ?? []).filter((r) => r !== ref) };
      return ack();
    },
    async postConflictResolution(payload) {
      const resolution = { ...payload, resolvedAt: new Date().toISOString() };
      state = { ...state, conflictResolutions: [...(state.conflictResolutions ?? []), resolution] };
      return { conflictResolutions: state.conflictResolutions ?? [] };
    },
    async deleteConflictResolution(payload) {
      state = {
        ...state,
        conflictResolutions: (state.conflictResolutions ?? []).filter(
          (r) =>
            !(
              ((r.docA === payload.docA && r.docB === payload.docB) || (r.docA === payload.docB && r.docB === payload.docA)) &&
              r.anchorA === payload.anchorA &&
              r.anchorB === payload.anchorB
            ),
        ),
      };
      return { conflictResolutions: state.conflictResolutions ?? [] };
    },
    async scan() {
      // No on-demand scan over fixtures.
    },
  };
}

/** The provenance ledger: identity, deep link, kind, last synced; paged and searched like the real endpoint. */
function knowledgeLedger(params: URLSearchParams): { documents: unknown[]; total: number } {
  const q = (params.get('query') ?? '').trim().toLowerCase();
  const kind = params.get('kind') ?? '';
  const limit = Number(params.get('limit') ?? 50);
  const offset = Number(params.get('offset') ?? 0);
  const all = KNOWLEDGE_DOCS.filter(
    (d) => (!kind || d.sourceKind === kind) && (!q || d.title.toLowerCase().includes(q) || d.ref.toLowerCase().includes(q)),
  ).map((d) => ({ title: d.title, url: d.url, sourceKind: d.sourceKind, externalId: d.ref.split('/').pop() ?? d.ref, lastSyncedAt: d.lastSyncedAt }));
  return { documents: all.slice(offset, offset + limit), total: all.length };
}

const ROUTE = /^\/api\/repos\/([^/]+)\/(.+)$/;

/** The repositories the fixtures describe. Every other id is a REAL, connected
 *  repository, and its reads and writes go to the server untouched. */
const FIXTURE_REPO_IDS = new Set(REPOS.map((r) => r.id));

/**
 * Answer the reads and writes the reused components make; hand everything else
 * on. Installed ONCE when the preview chunk loads (only a preview address loads
 * it) and gated on the address, never on mount: a mount-scoped install loses to
 * StrictMode's rehearsal unmount and to children whose effects fetch before the
 * parent's effect runs.
 */
let installed = false;
export function installPreviewFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!window.location.pathname.startsWith('/preview')) return real(input, init);
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    // The workspace Knowledge ledger (the EE page's Sources tab).
    if (url.pathname.endsWith('/api/ee/knowledge/documents')) return json(knowledgeLedger(url.searchParams));
    const match = ROUTE.exec(url.pathname);
    if (!match) return real(input, init);
    const repoId = decodeURIComponent(match[1]!);
    const rest = match[2]!;
    // A connected repository is real all the way down: its corpus, its guard
    // state and its runs are the server's, and no fixture stands in for any of
    // it. Only the repositories the fixtures describe are answered here.
    if (!FIXTURE_REPO_IDS.has(repoId)) return real(input, init);
    // The agent-sessions store is REAL for every repository: the shell follows
    // the real repos' runs through it, and a real repository's Activity tab is
    // the real view. There are no session fixtures to answer with, so these go
    // to the server — and a repository the server does not know simply 404s,
    // which is what the callers already expect.
    if (rest === 'sessions' || rest.startsWith('sessions/')) return real(input, init);
    // So is starting a run: a connected repository's Activity starts a real one
    // through the server, and no fixture could stand in for the answer — it is
    // where "this workspace has no provider" is found out.
    if (rest === 'spec/corpus/scan' || rest === 'guard/setup' || rest === 'guard/generate') {
      return real(input, init);
    }
    // So is the INTERFACE CATALOG of a connected repository: it is derived from
    // that repository's own tree, and no fixture could stand in for it. A
    // repository with guard fixtures is one of the mock ones and keeps them.
    if (
      !guardForRepo(repoId) &&
      (rest === 'guard/interfaces' || rest === 'guard/interface/raw' || rest === 'guard/map')
    ) {
      return real(input, init);
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    if (method === 'POST') return answerPost(repoId, rest, body);
    if (method === 'PUT') return answerPut(repoId, rest, body);
    if (method === 'DELETE') return answerDelete(repoId, rest);
    return answerGet(repoId, rest, url.searchParams);
  };
}
