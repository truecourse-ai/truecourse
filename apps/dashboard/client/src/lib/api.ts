import type {
  GuardEvidenceVisual,
  CapabilitiesResponse,
  GuardArtifactSource,
  GuardClaimIdentity,
  GuardClaimsView,
  GuardDecisions,
  GuardDocCoverage,
  GuardFlowDetail,
  GuardFlowsView,
  GuardGenerateReport,
  GuardHistory,
  GuardInterfacesView,
  GuardLatestResponse,
  GuardLatestWithRunFlows,
  GuardScenarioInventory,
  GuardScenarioSource,
  GuardSetupReport,
  GuardStaleness,
  GuardStatusSummary,
} from '@truecourse/shared';
import type { GuardDependenciesView, GuardDependencyPatch } from '@/types/guard-dependencies';
import type {
  ContextBindingsResponse,
  ContextDocumentsViewResponse,
  ContextSource,
  ContextSourceCheck,
  ContextSourceDetailResponse,
  ContextSourcesResponse,
  ContextSourceUpdateResponse,
  ContextSourceView,
  HomePeriod,
  HomeResponse,
  JobsResponse,
  NotificationsResponse,
  WorkspaceInvitation,
  WorkspaceMembersResponse,
} from '@truecourse/shared';
import type { RunRecord, SessionCommand, SessionEvent } from '@truecourse/agent-loop';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';
import { getServerUrl } from './server-url';

const BASE_URL = getServerUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The client's one transport: JSON in, JSON out, `ApiError` on any non-2xx. */
export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    // Send the enterprise session cookie (no-op in community). Required
    // because the dashboard API sits behind the auth gate in enterprise.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = 'Unknown error';
    try {
      const body = await res.json();
      message = body.error || JSON.stringify(body);
    } catch {
      message = await res.text().catch(() => 'Unknown error');
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Verbs a repo card shows for its most-recent lifecycle event. */
export type LatestEventKind = 'scanned' | 'generated' | 'guarded';

export type RepoResponse = {
  id: string;
  name: string;
  path: string;
  /** The provider it was connected through (`github`, `local`). */
  provider?: string | null;
  /** Where the provider serves it: a remote URL, or a folder's path on this machine. */
  remoteUrl?: string | null;
  /** Most recent lifecycle event across features (home-page card), or null. */
  latestEvent?: { kind: LatestEventKind; at: string } | null;
  branches?: string[];
  defaultBranch?: string;
  isGitRepo?: boolean;
};

// Capabilities — fetched once at app boot by AppProvider so any component can
// ask `useCapability('sso')` or `useServerMode()`.
export function getCapabilities(): Promise<CapabilitiesResponse> {
  return fetchApi<CapabilitiesResponse>('/api/capabilities');
}

// Repos
export function getRepos(): Promise<RepoResponse[]> {
  return fetchApi<RepoResponse[]>('/api/repos');
}

export function getRepo(id: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>(`/api/repos/${id}`);
}

export function deleteRepo(id: string): Promise<void> {
  return fetchApi<void>(`/api/repos/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Spec Consolidation (Module 1)
// ---------------------------------------------------------------------------

export type SpecStalenessResponse = {
  /** Recorded include/exclude/conflict decisions are newer than the corpus — a Scan applies them. */
  decisionsPending: boolean;
  /** A kept doc changed on disk since the last scan (edited in the dashboard or outside it). */
  docsChanged: boolean;
  hasCorpus: boolean;
};

export function getSpecStaleness(repoId: string): Promise<SpecStalenessResponse> {
  return fetchApi<SpecStalenessResponse>(`/api/repos/${repoId}/spec/staleness`);
}

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — the curated doc corpus. Areas group docs;
// an overlap is two same-area docs that may disagree, resolved by a
// section-scoped verdict (pick-a-side / dismissal) or a force-exclude.
// ---------------------------------------------------------------------------

export interface SpecOverlapSection {
  doc: string;
  /** Heading of the conflicting section, or null when it lives in the doc's preamble. */
  heading: string | null;
  /** The verbatim disputed sentence, when the detector captured one — carried into a
   *  pick-a-side verdict so the loser's claim is suppressed at guard generate. */
  quote?: string;
}

/** A section-scoped conflict verdict — pick-a-side ('a'/'b') or dismissal.
 *  Identity is the unordered doc pair + each side's section anchor (+ optional quote). */
export interface SpecConflictResolution {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  verdict: 'a' | 'b' | 'dismissed';
  resolvedAt?: string;
  note?: string;
  /** `auto` = the scan applied a high-confidence recommendation itself; absent/`user` = a human verdict. */
  resolvedBy?: 'user' | 'auto';
}

/**
 * The verify judge's resolution brief for a confirmed conflict — advisory only.
 * `explanation` is a human-readable account of the disagreement; `recommendation`
 * is a suggested action the user may apply. Absent on unverified/legacy flags.
 */
export interface SpecOverlapReview {
  explanation: string;
  recommendation: {
    /** 'pick-a' backs the overlap's first doc, 'pick-b' the second. */
    action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss';
    rationale: string;
    /** For `fix-doc`: the suggested doc edit the user applies themselves. */
    fix?: string;
    /** The judge's grade; `high` actionable recommendations are auto-applied at scan. */
    confidence?: 'low' | 'medium' | 'high';
  };
}

export interface SpecOverlap {
  docs: [string, string];
  note: string;
  /** The verify judge's resolution brief, when this flag was reviewed. */
  review?: SpecOverlapReview;
  /** Conflicting sections per doc (markdown headings), when known. */
  sections?: SpecOverlapSection[];
  /**
   * Every area this (possibly cross-area-merged) dispute spans. Detection runs
   * per area, so one disagreement on a pair sharing several areas is flagged in
   * each and merged to one record; a resolution scoped to any spanned area (or an
   * unscoped one) clears it everywhere. Empty on older corpora.
   */
  areas?: string[];
}

export interface SpecCorpusDoc {
  ref: string;
  kind: string;
  status?: string;
  lastTouched: string;
  areaTags: string[];
  /** Hosted only: `'workspace'` when this doc is inherited from the workspace
   *  Knowledge corpus (folded into the repo scan before curate). Absent on
   *  repo-local docs and in OSS — the UI shows no workspace badge then. */
  layer?: 'workspace';
  /** Workspace only: the ledger's human title for this ref (synthetic docPath).
   *  Absent on repo corpora — the UI falls back to the ref. */
  title?: string;
  /** Workspace only: deep link to the source doc, when the ledger has one.
   *  A WEB-SOURCE doc carries the original page URL here (same meaning). */
  url?: string | null;
  /** `'web'` when this doc is a page snapshotted from a registered llms.txt site
   *  (`.truecourse/specs/sources/…`). Absent on repo-local + workspace docs. */
  origin?: 'web';
  /** Web only: the source's registry id (the ref's own path segment). */
  sourceId?: string;
  /** Web only: the source's human title, when it is still registered. */
  sourceTitle?: string;
}

export interface SpecCorpusArea {
  id: string;
  product: string;
  concern: string;
  docRefs: string[];
  overlaps: SpecOverlap[];
}

export interface SpecSkippedDoc {
  ref: string;
  reason: string;
  /** Workspace only: the ledger's human title for this ref. Absent on repo corpora. */
  title?: string;
  /** Workspace only: deep link to the source doc, when the ledger has one.
   *  A WEB-SOURCE doc carries the original page URL here (same meaning). */
  url?: string | null;
  /** `'web'` when this doc is a page snapshotted from a registered llms.txt site. */
  origin?: 'web';
  sourceId?: string;
  sourceTitle?: string;
}

/**
 * A skipped-docs SUMMARY (counts only), returned by the workspace corpus GET in
 * place of the full `skippedDocs` array — a source with thousands of dropped docs
 * must not ship every row into the corpus payload (the individual rows load lazily
 * via the paged skipped listing). Absent on the repo corpus, which carries the
 * full array inline.
 */
export interface SpecSkippedSummary {
  total: number;
  byReason: { reason: string; count: number }[];
}

export interface SpecCorpus {
  version: number;
  generatedAt: string;
  docs: SpecCorpusDoc[];
  areas: SpecCorpusArea[];
  /** Docs the relevance filter dropped (path + reason). */
  skippedDocs?: SpecSkippedDoc[];
}

/** The coverage version a corpus read is, and what it changed against its parent. */
export interface SpecCorpusVersionInfo {
  id: string;
  label: string;
  parentId: string | null;
  ref: string;
  sha: string;
  pullRequest?: number;
  generated: boolean;
  docChanges: Record<string, { change: 'added' | 'edited' | 'removed'; sections?: string[] }>;
  conflictChanges: Record<string, 'opened' | 'resolved'>;
}

export interface SpecCorpusResponse {
  corpus: SpecCorpus;
  /** The version this corpus is, when the store is versioned. */
  version?: SpecCorpusVersionInfo;
  /** Doc refs the user force-included (bypass the relevance filter). */
  manualIncludes?: string[];
  /** Doc refs the user force-excluded (dropped from the corpus). */
  manualExcludes?: string[];
  /** Section-scoped conflict verdicts — the client derives resolved/dismissed/orphaned state from these. */
  conflictResolutions?: SpecConflictResolution[];
  /**
   * Workspace corpus only: a skipped-docs summary in place of `corpus.skippedDocs`
   * (which the workspace payload omits for scale). The individual rows load lazily
   * via the paged skipped listing (the data-source seam's `listSkipped`).
   */
  skipped?: SpecSkippedSummary;
  /** Set by the scan endpoint: true when the rescan found no doc changes (0 LLM calls). */
  noChanges?: boolean;
  /**
   * EE PR view: the commit whose corpus was actually returned. When it differs
   * from the requested `ref`, the server fell back to the baseline corpus (e.g.
   * a code-only PR whose head was never spec-scanned).
   */
  corpusCommit?: string;
}

/**
 * OSS include/exclude ack: the persisted decision lists only. The corpus is
 * unchanged by an OSS decision (no re-curate), so no corpus is returned — the
 * client keeps its optimistic row move until the next Scan. PR scope (EE) returns
 * the full re-curated `SpecCorpusResponse` instead.
 */
export interface SpecDecisionAck {
  manualIncludes: string[];
  manualExcludes: string[];
}

/**
 * OSS conflict-verdict ack: the persisted verdicts only (no corpus — a verdict
 * doesn't re-curate). The client re-derives resolved/dismissed state from these.
 * PR scope (EE) returns the full re-curated `SpecCorpusResponse` instead.
 */
export interface SpecConflictAck {
  conflictResolutions: SpecConflictResolution[];
}

/**
 * EE PR scope for the spec decision routes: `?pr=<n>&ref=<headSha>` (both
 * required together). Empty outside a PR view, so OSS URLs are unchanged.
 */
function prScopeQuery(opts?: { pr?: number; ref?: string }): string {
  return opts?.pr != null && opts.ref ? `?pr=${opts.pr}&ref=${encodeURIComponent(opts.ref)}` : '';
}

/** Read the persisted corpus, or null on 404 (no scan yet). */
export async function getSpecCorpus(
  repoId: string,
  ref?: string,
  pr?: number,
): Promise<SpecCorpusResponse | null> {
  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  if (pr != null) params.set('pr', String(pr));
  const q = params.size > 0 ? `?${params.toString()}` : '';
  try {
    return await fetchApi<SpecCorpusResponse>(`/api/repos/${repoId}/spec/corpus${q}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Enqueue the workspace Document scan. Documentation belongs to the workspace,
 * so there is ONE scan and it is started at the workspace address — a
 * repository never starts one of its own. It runs as a background job, so this
 * resolves as soon as the job is QUEUED (202): progress arrives over
 * `spec:progress` and the corpus is refetched when `spec:complete
 * { kind: 'scan' }` lands.
 */
export function startContextScan(): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>('/api/context/scan', { method: 'POST' });
}

/** A source doc's markdown (for the prose Spec tab). `commit` reads it at a PR head (EE). */
export function getSpecDoc(repoId: string, ref: string, commit?: string): Promise<{ ref: string; content: string }> {
  const c = commit ? `&commit=${encodeURIComponent(commit)}` : '';
  return fetchApi<{ ref: string; content: string }>(
    `/api/repos/${repoId}/spec/doc?ref=${encodeURIComponent(ref)}${c}`,
  );
}

// ---------------------------------------------------------------------------
// Guard — spec-section scenario coverage (read-only, diff-free).
// ---------------------------------------------------------------------------

/** Append `?ref=`/`&ref=` when a PR head is being viewed (EE); a no-op otherwise. */
function withRef(base: string, ref?: string): string {
  if (!ref) return base;
  return `${base}${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`;
}

/** The two amber-dot signals for the Guard tab (generate / run staleness). `ref`
 *  scopes to a PR head (EE). */
export function getGuardStaleness(repoId: string, ref?: string): Promise<GuardStaleness> {
  return fetchApi<GuardStaleness>(withRef(`/api/repos/${repoId}/guard/staleness`, ref));
}

/**
 * The guard run for the view. No `ref` → the repo baseline (or null when never
 * run). With `ref` (a PR head, EE) → the run stored at that commit, else an
 * explicit pending/empty envelope — never the baseline under a PR header. Always
 * resolves to a `{ latest, pending }` envelope so callers handle both uniformly.
 */
export async function getGuardLatest(repoId: string, ref?: string): Promise<GuardLatestResponse> {
  try {
    const body = await fetchApi<GuardLatestWithRunFlows | GuardLatestResponse>(
      withRef(`/api/repos/${repoId}/guard/latest`, ref),
    );
    // With a ref the server returns the envelope; without one, a raw run.
    return ref ? (body as GuardLatestResponse) : { latest: body as GuardLatestWithRunFlows, pending: null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { latest: null, pending: null };
    throw e;
  }
}

/** The append-only run-summary history (empty `{ runs: [] }` until a run exists).
 *  With `pr` (EE), the PR's own run timeline — one run per pushed head. */
export function getGuardHistory(
  repoId: string,
  pr?: number,
  opts: { all?: boolean } = {},
): Promise<GuardHistory> {
  // `all`: every stored run of the repository, pull-request heads included.
  const qs = pr !== undefined ? `?pr=${pr}` : opts.all ? '?all=1' : '';
  return fetchApi<GuardHistory>(`/api/repos/${repoId}/guard/history${qs}`);
}

/** One past run's materialized state by id; null on 404 (unknown run). */
export async function getGuardRun(repoId: string, runId: string): Promise<GuardLatestWithRunFlows | null> {
  try {
    return await fetchApi<GuardLatestWithRunFlows>(`/api/repos/${repoId}/guard/runs/${encodeURIComponent(runId)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The Flows-tab payload — flow inventory + recipe card. Always 200. `ref` scopes to a PR head (EE). */
export function getGuardFlows(repoId: string, ref?: string): Promise<GuardFlowsView> {
  return fetchApi<GuardFlowsView>(withRef(`/api/repos/${repoId}/guard/flows`, ref));
}

/** One flow's detail; null on 404 (the id is gone — the client re-lists). */
export async function getGuardFlow(repoId: string, flowId: string, ref?: string): Promise<GuardFlowDetail | null> {
  try {
    return await fetchApi<GuardFlowDetail>(
      // Manual pseudo-flow ids carry a `manual:` prefix — always path-encoded.
      withRef(`/api/repos/${repoId}/guard/flows/${encodeURIComponent(flowId)}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * The extracted claim corpus with the trace from claim to flow to scenario, plus
 * the statements extraction refused. Always 200 — an unextracted repo answers an
 * `extracted: false` view, never an error.
 */
export function getGuardClaims(repoId: string, ref?: string): Promise<GuardClaimsView> {
  return fetchApi<GuardClaimsView>(withRef(`/api/repos/${repoId}/guard/claims`, ref));
}

/** The code-derived interface catalog + its reverse index onto the flows. Always 200. */
export function getGuardInterfaces(repoId: string, ref?: string): Promise<GuardInterfacesView> {
  return fetchApi<GuardInterfacesView>(withRef(`/api/repos/${repoId}/guard/interfaces`, ref));
}

/** The compact status summary (coverage + last run + last generate). Always 200. */
export function getGuardStatus(repoId: string, ref?: string): Promise<GuardStatusSummary> {
  return fetchApi<GuardStatusSummary>(withRef(`/api/repos/${repoId}/guard/status`, ref));
}

/**
 * The dependencies view: every class of starting state the committed catalog
 * declares, joined with the instances THIS workspace registered, the flows each
 * one blocks, and the external-service half where the row is one.
 */
export function getGuardDependencies(repoId: string): Promise<GuardDependenciesView> {
  return fetchApi<GuardDependenciesView>(`/api/repos/${repoId}/guard/dependencies`);
}

/**
 * Register ONE dependency's instance. The response IS the fresh view, so the page
 * swaps state from it, and it carries resolution, never a stored value. A refused
 * write (an undeclared variable, a class with nothing to register, a broken
 * overlay) comes back as a 422 ApiError whose message is safe to show verbatim.
 */
export function saveGuardDependency(
  repoId: string,
  name: string,
  patch: GuardDependencyPatch,
): Promise<GuardDependenciesView> {
  return fetchApi<GuardDependenciesView>(`/api/repos/${repoId}/guard/dependencies`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...patch }),
  });
}

/** The last `guard setup` record; null on 404 (setup has never run here). */
export async function getGuardSetup(repoId: string): Promise<GuardSetupReport | null> {
  try {
    const { report } = await fetchApi<{ report: GuardSetupReport }>(`/api/repos/${repoId}/guard/setup`);
    return report;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Which artifact-backed entity a raw read addresses — the route's own segment. */
export type GuardArtifactKind = 'interface' | 'flow' | 'claim' | 'dependency' | 'recipe';

/**
 * The stored artifact behind one entity — its own pretty-printed slice of the
 * stored document, for the detail's raw mode. `null` on 404 (nothing stored yet,
 * or no entry with that id).
 */
export async function getGuardArtifactRaw(
  repoId: string,
  kind: GuardArtifactKind,
  id: string,
  ref?: string,
): Promise<GuardArtifactSource | null> {
  try {
    const query = id ? `?id=${encodeURIComponent(id)}` : '';
    return await fetchApi<GuardArtifactSource>(
      withRef(`/api/repos/${repoId}/guard/${kind}/raw${query}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The last `guard generate` report; null on 404 (never generated). `ref` scopes to a PR head (EE). */
export async function getGuardReport(repoId: string, ref?: string): Promise<GuardGenerateReport | null> {
  try {
    return await fetchApi<GuardGenerateReport>(withRef(`/api/repos/${repoId}/guard/report`, ref));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Per-section coverage over a live spec doc; null on 404 (doc gone / no store). `ref` scopes to a PR head (EE). */
export async function getGuardCoverage(repoId: string, doc: string, ref?: string): Promise<GuardDocCoverage | null> {
  try {
    return await fetchApi<GuardDocCoverage>(
      withRef(`/api/repos/${repoId}/guard/coverage?doc=${encodeURIComponent(doc)}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The committed-scenario inventory + recipe card for the Scenarios tab. `ref` scopes to a PR head (EE). */
export function getGuardScenarios(repoId: string, ref?: string): Promise<GuardScenarioInventory> {
  return fetchApi<GuardScenarioInventory>(withRef(`/api/repos/${repoId}/guard/scenarios`, ref));
}

/** A scenario's raw YAML source; null on 404 (unknown id). `ref` scopes to a PR head (EE). */
export async function getGuardScenarioSource(
  repoId: string,
  id: string,
  ref?: string,
  /** Where the test ran, when known: the steps then carry what each one actually did there. */
  evidence?: { runId?: string; evidencePath?: string },
): Promise<GuardScenarioSource | null> {
  const where = evidence?.runId
    ? `&runId=${encodeURIComponent(evidence.runId)}`
    : evidence?.evidencePath
      ? `&evidencePath=${encodeURIComponent(evidence.evidencePath)}`
      : '';
  try {
    return await fetchApi<GuardScenarioSource>(
      withRef(`/api/repos/${repoId}/guard/scenario?id=${encodeURIComponent(id)}${where}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * A failed scenario's evidence transcript (text/plain). `fetchApi` is JSON-only,
 * so this reads the raw body itself. Throws `ApiError` on a non-OK response
 * (e.g. 404 when no transcript was captured).
 */
export async function getGuardEvidence(
  repoId: string,
  runId: string,
  scenarioId: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ runId, scenarioId });
  if (file) params.set('file', file);
  const res = await fetch(`${BASE_URL}/api/repos/${repoId}/guard/evidence?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => 'Evidence not found.'));
  return res.text();
}

/**
 * WHERE a scenario's evidence bundle is, as the visual reads address it: the run it
 * ran in, or the directory a birth finding stored. The same pair the transcript
 * reads already split across two functions — one bundle, so one handle.
 */
export type GuardEvidenceWhere = { runId: string; scenarioId: string } | { evidencePath: string };

function evidenceWhereParams(where: GuardEvidenceWhere): URLSearchParams {
  return new URLSearchParams(
    'runId' in where ? { runId: where.runId, scenarioId: where.scenarioId } : { evidencePath: where.evidencePath },
  );
}

/**
 * The VISUAL evidence of one scenario — the per-step screenshots and the session
 * video a browser run left, in reading order. Always 200; a run that recorded none
 * (every cli/api run, and every run written before the web driver existed) answers
 * with an empty list.
 */
export async function getGuardEvidenceVisuals(
  repoId: string,
  where: GuardEvidenceWhere,
): Promise<GuardEvidenceVisual[]> {
  const body = await fetchApi<{ visuals?: GuardEvidenceVisual[] }>(
    `/api/repos/${repoId}/guard/evidence/visuals?${evidenceWhereParams(where).toString()}`,
  );
  return body.visuals ?? [];
}

/**
 * The URL one visual's BYTES are served from — an `<img>`/`<video>` source, not a
 * fetch: the browser loads it itself, with the media type the route sets.
 */
export function guardEvidenceVisualUrl(
  repoId: string,
  where: GuardEvidenceWhere,
  file: string,
): string {
  const params = evidenceWhereParams(where);
  params.set('file', file);
  return `${BASE_URL}/api/repos/${repoId}/guard/evidence/visual?${params.toString()}`;
}

/**
 * A birth finding's evidence transcript, addressed by its stored `evidencePath`
 * (the finding carries the whole pointer, not a run id + scenario id). text/plain;
 * throws `ApiError` on a non-OK response (404 when no transcript was written).
 */
export async function getGuardFindingEvidence(
  repoId: string,
  evidencePath: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ path: evidencePath });
  if (file) params.set('file', file);
  const res = await fetch(`${BASE_URL}/api/repos/${repoId}/guard/finding-evidence?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => 'Evidence not found.'));
  return res.text();
}

/** EE PR scope for the guard decisions routes: `?pr=<n>` (no ref — decisions are
 *  keyed by PR alone). Empty outside a PR view, so OSS URLs are unchanged. */
function guardPrQuery(pr?: number): string {
  return pr !== undefined ? `?pr=${pr}` : '';
}

/** The committable guard decisions (dismissed claims) — always 200 (empty until
 *  the user dismisses anything). */
export function getGuardDecisions(repoId: string, pr?: number): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/decisions${guardPrQuery(pr)}`);
}

/** The identity a dismissal keys on: doc + section anchor + the extracted claim's
 *  stable text (a finding's `claim`). Re-exported for the guard components. */
export type { GuardClaimIdentity };

/** Dismiss a finding's claim — writes `scenarios/decisions.json`; returns the
 *  updated decisions so the caller re-derives dismissed state without a GET. With
 *  `pr` the write targets that PR's overlay and the response is the merged effective
 *  view (EE) — mirrors {@link getGuardDecisions}. */
export function dismissGuardClaim(
  repoId: string,
  claim: GuardClaimIdentity & { note?: string },
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/dismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify(claim),
  });
}

/** Reverse a dismissal by its identity; returns the updated decisions. With `pr`
 *  the write targets that PR's overlay and the response is the merged effective view. */
export function undismissGuardClaim(
  repoId: string,
  claim: GuardClaimIdentity,
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/undismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify(claim),
  });
}

/** Dismiss a whole FLOW — the manual dismissal unit (a generated test's id moves
 *  on regenerate, so a test is never one). `title` is display copy carried into the
 *  decisions file. Returns the updated decisions; `pr` scopes it like the claim pair. */
export function dismissGuardFlow(
  repoId: string,
  flow: { flowId: string; title: string; note?: string },
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/flows/dismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify(flow),
  });
}

/** Reverse a flow dismissal by its id; returns the updated decisions. */
export function undismissGuardFlow(
  repoId: string,
  flowId: string,
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/flows/undismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify({ flowId }),
  });
}

// Guard actions — trigger `guard generate` / `guard run` from the dashboard.
// Progress streams over `spec:progress` and completes with `spec:complete`
// (`kind: guard-generate | guard-run`).

/** Enqueue `guard generate`. Answers 202 with the job id; 409 while the
 *  repository is already working (or the workspace has no provider — the body's
 *  `error` code tells them apart), 422 while the corpus carries open conflicts. */
export function triggerGuardGenerate(repoId: string): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/repos/${repoId}/guard/generate`, { method: 'POST' });
}

/**
 * Trigger `guard run` — deterministic, LLM-free, no estimate. The route
 * ENQUEUES: a 202 means the run is on the queue, and the result lands over the
 * socket (`spec:complete`, `kind: guard-run`). 409 when the repo is already
 * working.
 */
export function triggerGuardRun(repoId: string): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/repos/${repoId}/guard/run`, { method: 'POST' });
}

// The optional `scope` on every spec decision mutation is the EE PR view
// (`?pr=&ref=`); in PR scope the server re-curates the PR head and returns the
// fresh corpus. Repo scope is unchanged — no query.
type SpecMutationScope = { pr?: number; ref?: string };

// OSS records the decision and returns a `SpecDecisionAck` (no re-curate); PR scope
// (EE) re-curates and returns the full `SpecCorpusResponse`.

/** Force-include a relevance-dropped doc. */
export function addSpecInclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/includes${prScopeQuery(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

/** Remove a force-include override. */
export function removeSpecInclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/includes${prScopeQuery(scope)}`, {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

/** Force-exclude an otherwise-kept doc (drops it + its conflicts on the next Scan). */
export function addSpecExclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/excludes${prScopeQuery(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

/** Remove a force-exclude override (restore the doc). */
export function removeSpecExclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/excludes${prScopeQuery(scope)}`, {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

/**
 * Record a section-scoped conflict verdict (pick-a-side / dismissal). OSS returns
 * a `SpecConflictAck` (no re-curate); PR scope (EE) returns the full re-curated corpus.
 */
export function postSpecConflictResolution(
  repoId: string,
  payload: {
    docA: string;
    anchorA: string | null;
    quoteA?: string;
    docB: string;
    anchorB: string | null;
    quoteB?: string;
    verdict: 'a' | 'b' | 'dismissed';
    note?: string;
  },
  scope?: SpecMutationScope,
): Promise<SpecConflictAck | SpecCorpusResponse> {
  return fetchApi<SpecConflictAck | SpecCorpusResponse>(
    `/api/repos/${repoId}/spec/conflict-resolution${prScopeQuery(scope)}`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Remove a conflict verdict by dispute identity. Repo scope returns the ack; PR the corpus. */
export function deleteSpecConflictResolution(
  repoId: string,
  payload: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
  scope?: SpecMutationScope,
): Promise<SpecConflictAck | SpecCorpusResponse> {
  return fetchApi<SpecConflictAck | SpecCorpusResponse>(
    `/api/repos/${repoId}/spec/conflict-resolution${prScopeQuery(scope)}`,
    { method: 'DELETE', body: JSON.stringify(payload) },
  );
}


// ---------------------------------------------------------------------------
// Agent sessions (the Activity tab) — the sessions-store read surface.
// ---------------------------------------------------------------------------

/** A run record as the server serializes it: `endpoint` (token) + `pid` stripped. */
export type PublicSessionRun = Omit<RunRecord, 'endpoint' | 'pid'>;

/** Every agent-sessions run of the repo, newest first (all five commands). */
export function listSessionRuns(repoId: string): Promise<{ runs: PublicSessionRun[] }> {
  return fetchApi<{ runs: PublicSessionRun[] }>(`/api/repos/${repoId}/sessions/runs`);
}

/** One run's current record + session index. */
export function getSessionRun(
  repoId: string,
  command: SessionCommand,
  runId: string,
): Promise<{ run: PublicSessionRun }> {
  return fetchApi<{ run: PublicSessionRun }>(
    `/api/repos/${repoId}/sessions/runs/${command}/${encodeURIComponent(runId)}`,
  );
}

/** One session's transcript; `since` returns only events past that seq cursor. */
export function getSessionTranscript(
  repoId: string,
  command: SessionCommand,
  runId: string,
  sessionId: string,
  since?: number,
): Promise<{ events: SessionEvent[] }> {
  const query = since !== undefined ? `?since=${since}` : '';
  return fetchApi<{ events: SessionEvent[] }>(
    `/api/repos/${repoId}/sessions/runs/${command}/${encodeURIComponent(runId)}/transcript/${encodeURIComponent(sessionId)}${query}`,
  );
}

// ---------------------------------------------------------------------------
// The workspace's agent runs (the Agent page) — every connected repository at once.
// ---------------------------------------------------------------------------

/**
 * A run of the workspace, tagged with the repository it ran for — or with
 * NOBODY: a Document scan is the workspace's own work over its sources, so it
 * names no repository and its `repo` is null.
 */
export type WorkspaceRun = PublicSessionRun & { repo: { id: string; fullName: string } | null };

/**
 * Every run of the workspace, newest first, narrowed by the server. `before` is
 * the cursor a previous page returned; `nextCursor` is absent on the last page.
 */
export function listWorkspaceRuns(query: {
  repo?: string;
  kind?: string;
  status?: string;
  limit?: number;
  before?: string;
} = {}): Promise<{ runs: WorkspaceRun[]; nextCursor?: string }> {
  const params = new URLSearchParams();
  if (query.repo) params.set('repo', query.repo);
  if (query.kind) params.set('kind', query.kind);
  if (query.status) params.set('status', query.status);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.before) params.set('before', query.before);
  const search = params.toString();
  return fetchApi<{ runs: WorkspaceRun[]; nextCursor?: string }>(
    `/api/sessions/runs${search ? `?${search}` : ''}`,
  );
}

/** One run by id, from whichever repository of the workspace owns it. */
export function getWorkspaceRun(runId: string): Promise<{ run: WorkspaceRun }> {
  return fetchApi<{ run: WorkspaceRun }>(`/api/sessions/runs/${encodeURIComponent(runId)}`);
}

/**
 * One page of a run's activity journal, in cursor order. `after` is the cursor
 * the previous page ended on (`-1` from the start); `done` says the journal has
 * no more history, which is where the live tail takes over.
 */
export function readRunActivity(
  repoId: string,
  command: SessionCommand,
  runId: string,
  after: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ events: ActivityEvent[]; nextCursor: number; done: boolean }> {
  return fetchApi<{ events: ActivityEvent[]; nextCursor: number; done: boolean }>(
    `/api/repos/${repoId}/sessions/runs/${command}/${encodeURIComponent(runId)}/activity?after=${after}&limit=${limit}&compact=1`,
    { signal },
  );
}

/**
 * One page of a WORKSPACE run's activity journal — the same journal, addressed
 * by run id alone. A Document scan belongs to no repository, so its
 * conversation is read here rather than under `/api/repos/:id`.
 */
export function readWorkspaceRunActivity(
  runId: string,
  after: number,
  limit: number,
): Promise<{ events: ActivityEvent[]; nextCursor: number; done: boolean }> {
  return fetchApi<{ events: ActivityEvent[]; nextCursor: number; done: boolean }>(
    `/api/sessions/runs/${encodeURIComponent(runId)}/activity?after=${after}&limit=${limit}`,
  );
}

/** One piece of a workspace run's work, verbatim. */
export function getWorkspaceRunTranscript(
  runId: string,
  sessionId: string,
  since?: number,
): Promise<{ events: SessionEvent[] }> {
  const query = since !== undefined ? `?since=${since}` : '';
  return fetchApi<{ events: SessionEvent[] }>(
    `/api/sessions/runs/${encodeURIComponent(runId)}/transcript/${encodeURIComponent(sessionId)}${query}`,
  );
}

// ---------------------------------------------------------------------------
// Context — the WORKSPACE's documentation sources, the documents they yield,
// and the one corpus the Document scan curates from them. Everything here is
// workspace-scoped: no repository id appears, because a source belongs to the
// workspace and a repository only LINKS the ones it reads.
// ---------------------------------------------------------------------------

export function listContextSources(): Promise<ContextSourcesResponse> {
  return fetchApi<ContextSourcesResponse>('/api/context/sources');
}

/** The rows of the Documents view, composed and folded on the server. */
export function listContextDocuments(query: {
  area?: string[];
  status?: string[];
  source?: string[];
  repo?: string[];
  inclusion?: string[];
} = {}): Promise<ContextDocumentsViewResponse> {
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(query)) {
    for (const value of values ?? []) params.append(key, value);
  }
  const search = params.toString();
  return fetchApi<ContextDocumentsViewResponse>(
    `/api/context/documents${search ? `?${search}` : ''}`,
  );
}

/** One document's body, by the ref the corpus names it with. */
export function getContextDoc(ref: string): Promise<{ ref: string; content: string }> {
  return fetchApi<{ ref: string; content: string }>(
    `/api/context/doc?ref=${encodeURIComponent(ref)}`,
  );
}

/** The workspace corpus + its decisions, or null before the first scan. */
export async function getContextCorpus(): Promise<SpecCorpusResponse | null> {
  try {
    return await fetchApi<SpecCorpusResponse>('/api/context/corpus');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Has the workspace's Context moved since the corpus was built? */
export function getContextStaleness(): Promise<{
  changedAt: string | null;
  corpusAt: string | null;
  stale: boolean;
}> {
  return fetchApi<{ changedAt: string | null; corpusAt: string | null; stale: boolean }>(
    '/api/context/staleness',
  );
}

/** What a scope WOULD yield, before anything is stored. */
export function previewContextSource(body: {
  kind: string;
  config: Record<string, unknown>;
  /** The GitHub installation a repository scope is read through. */
  installationId?: number;
}): Promise<ContextSourceCheck> {
  return fetchApi<ContextSourceCheck>('/api/context/sources/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Add a source, link the repositories named, and sync it. */
export function addContextSource(body: {
  kind: string;
  config: Record<string, unknown>;
  repoIds: string[];
  /** The GitHub installation a repository source syncs through. */
  installationId?: number;
}): Promise<{ source: ContextSourceView; jobId?: string }> {
  return fetchApi<{ source: ContextSourceView; jobId?: string }>('/api/context/sources', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** One source and its syncs — what the source's own page reads. */
export function getContextSource(sourceId: string): Promise<ContextSourceDetailResponse> {
  return fetchApi<ContextSourceDetailResponse>(
    `/api/context/sources/${encodeURIComponent(sourceId)}`,
  );
}

/** Replace a source's scope; the answer says which sync it started, or why none. */
export function updateContextSourceConfig(
  sourceId: string,
  config: Record<string, unknown>,
): Promise<ContextSourceUpdateResponse> {
  return fetchApi<ContextSourceUpdateResponse>(
    `/api/context/sources/${encodeURIComponent(sourceId)}`,
    { method: 'PATCH', body: JSON.stringify({ config }) },
  );
}

export function syncContextSource(sourceId: string): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(
    `/api/context/sources/${encodeURIComponent(sourceId)}/sync`,
    { method: 'POST' },
  );
}

export function pauseContextSource(
  sourceId: string,
  paused: boolean,
): Promise<{ source: ContextSourceView }> {
  return fetchApi<{ source: ContextSourceView }>(
    `/api/context/sources/${encodeURIComponent(sourceId)}/pause`,
    { method: 'POST', body: JSON.stringify({ paused }) },
  );
}

/** Drop a source; the answer names the repositories that just stopped reading it. */
export function removeContextSource(
  sourceId: string,
): Promise<{ removed: ContextSource; repositories: string[]; jobId?: string }> {
  return fetchApi<{ removed: ContextSource; repositories: string[]; jobId?: string }>(
    `/api/context/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE' },
  );
}

/** Which workspace sources one repository reads. */
export function getRepoContextBindings(repoId: string): Promise<ContextBindingsResponse> {
  return fetchApi<ContextBindingsResponse>(`/api/repos/${repoId}/context/bindings`);
}

/** Replace the set a repository reads — the toggles are one state, saved whole. */
export function putRepoContextBindings(
  repoId: string,
  sourceIds: string[],
): Promise<ContextBindingsResponse> {
  return fetchApi<ContextBindingsResponse>(
    `/api/repos/${repoId}/context/bindings`,
    { method: 'PUT', body: JSON.stringify({ sourceIds }) },
  );
}

// The workspace's own decisions: a force-include, a force-exclude and a
// conflict verdict are settled ONCE for the workspace, not per repository.

export function addContextInclude(ref: string): Promise<SpecDecisionAck> {
  return fetchApi<SpecDecisionAck>('/api/context/includes', {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

export function removeContextInclude(ref: string): Promise<SpecDecisionAck> {
  return fetchApi<SpecDecisionAck>('/api/context/includes', {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

export function addContextExclude(ref: string): Promise<SpecDecisionAck> {
  return fetchApi<SpecDecisionAck>('/api/context/excludes', {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

export function removeContextExclude(ref: string): Promise<SpecDecisionAck> {
  return fetchApi<SpecDecisionAck>('/api/context/excludes', {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

export function postContextConflictResolution(payload: {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  verdict: 'a' | 'b' | 'dismissed';
  note?: string;
}): Promise<SpecConflictAck> {
  return fetchApi<SpecConflictAck>('/api/context/conflict-resolution', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteContextConflictResolution(payload: {
  docA: string;
  anchorA: string | null;
  docB: string;
  anchorB: string | null;
}): Promise<SpecConflictAck> {
  return fetchApi<SpecConflictAck>('/api/context/conflict-resolution', {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Members: the workspace's people. Its WorkOS organization's memberships and
// the invitations standing against it, read live on every request.
// ---------------------------------------------------------------------------

export function listWorkspaceMembers(): Promise<WorkspaceMembersResponse> {
  return fetchApi<WorkspaceMembersResponse>('/api/workspace/members');
}

/** Invite one person. WorkOS mails the invitation; the row comes back. */
export function inviteWorkspaceMember(
  email: string,
): Promise<{ invitation: WorkspaceInvitation }> {
  return fetchApi<{ invitation: WorkspaceInvitation }>('/api/workspace/invitations', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function revokeWorkspaceInvitation(id: string): Promise<void> {
  return fetchApi<void>(`/api/workspace/invitations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function removeWorkspaceMember(id: string): Promise<void> {
  return fetchApi<void>(`/api/workspace/members/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Jobs: the background work of the workspace. A job is tracked from the moment
// it is enqueued, which is where work waiting its turn in the queue is read.
// ---------------------------------------------------------------------------

/** Every job the workspace has in flight: the `queued` ones and the running. */
export function listActiveJobs(): Promise<JobsResponse> {
  return fetchApi<JobsResponse>('/api/jobs?active=1');
}

// ---------------------------------------------------------------------------
// Notifications: the workspace's durable feed. Every job posts into it when it
// settles; the page reads it back and marks rows read.
// ---------------------------------------------------------------------------

export function listNotifications(): Promise<NotificationsResponse> {
  return fetchApi<NotificationsResponse>('/api/notifications');
}

/** Mark the named rows read, or every unread row. Answers with the new count. */
export function markNotificationsRead(
  what: { ids: string[] } | { all: true },
): Promise<{ unreadCount: number }> {
  return fetchApi<{ unreadCount: number }>('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify(what),
  });
}

// ---------------------------------------------------------------------------
// Home: the whole dashboard in one read, today's sections, the trend, the
// areas, what waits on a person and what changed.
// ---------------------------------------------------------------------------

export function fetchHome(period: HomePeriod): Promise<HomeResponse> {
  return fetchApi<HomeResponse>(`/api/home?period=${encodeURIComponent(period)}`);
}

export interface SessionTranscriptPage {
  events: SessionEvent[];
  hasMore: boolean;
  progress?: import('@truecourse/agent-loop').SessionProgress | null;
}

function transcriptPageQuery(options: { before?: number; since?: number }): URLSearchParams {
  const query = new URLSearchParams({ limit: '100' });
  if (options.before !== undefined) query.set('before', String(options.before));
  if (options.since !== undefined) query.set('since', String(options.since));
  return query;
}

export function getSessionTranscriptPage(repoId: string, command: SessionCommand, runId: string, sessionId: string,
  options: { before?: number; since?: number }, signal?: AbortSignal): Promise<SessionTranscriptPage> {
  const query = transcriptPageQuery(options);
  return fetchApi(`/api/repos/${encodeURIComponent(repoId)}/sessions/runs/${command}/${encodeURIComponent(runId)}/transcript/${encodeURIComponent(sessionId)}?${query}`, { signal });
}

/** The same page for a WORKSPACE run, addressed by run id alone. */
export function getWorkspaceSessionTranscriptPage(runId: string, sessionId: string,
  options: { before?: number; since?: number }, signal?: AbortSignal): Promise<SessionTranscriptPage> {
  const query = transcriptPageQuery(options);
  return fetchApi(`/api/sessions/runs/${encodeURIComponent(runId)}/transcript/${encodeURIComponent(sessionId)}?${query}`, { signal });
}
