/**
 * Home, composed. The one answer behind the product owner's dashboard.
 *
 * TWO UNITS, each in its own words. The headline and the trend count FLOWS,
 * because a flow is what the engine proves and what can be proved on its own;
 * sections are folded worst-first, so one blocked scenario erases every proof
 * beside it and a section tally can only ever read zero on a workspace with
 * real gaps. The Areas widget and Recently changed stay on SECTIONS and
 * DOCUMENTS, which is what an area and a document are made of.
 *
 * Three rules run through it:
 *
 *   - A flow wears the ENGINE's five words ({@link guardFlowPlainStatus}'s), so
 *     Home's number is the Flows page's number. A section wears the Documents
 *     view's ({@link CONTEXT_DOCUMENT_STATUS_OF_COVERAGE}, {@link
 *     worstContextStatus}), so an area reads the way its documents do.
 *   - Everything here is PURE: the caller does the store reads (once per
 *     repository, as the Documents view does) and hands the results in.
 *   - Only what is stored is counted. A repository with no run yet contributes
 *     nothing to a point of the trend, a run stored before flows were recorded
 *     contributes nothing to the flow trend, a document nobody reads is off
 *     Home entirely, and no row is invented to fill a widget.
 */

import {
  CONTEXT_DOCUMENT_STATUS_OF_COVERAGE,
  HOME_FLOW_STATUS_ORDER,
  HOME_STATUS_ORDER,
  HOME_STATUS_WORD,
  guardSectionRefDoc,
  runKindWord,
  type ContextDocumentRow,
  type ContextDocumentStatus,
  type GuardCoveragePlainStatus,
  type GuardRunFlowSummary,
  type GuardRunSectionSummary,
  type HomeAreaRow,
  type HomeAttentionRow,
  type HomeChangeRow,
  type HomeFlowStatus,
  type HomeFlowTally,
  type HomePeriod,
  type HomeResponse,
  type HomeStatus,
  type HomeTally,
  type HomeTrendPoint,
} from '@truecourse/shared';
import { worstContextStatus } from '../context/documents.js';

/** One run of a repository's coverage history, as Home reads it. */
export interface HomeHistoryRun {
  runId: string;
  ranAt: string;
  sections: GuardRunSectionSummary;
  /**
   * Every flow of the repository as the word it wore then. Absent on a run
   * stored before flows were recorded, which is simply not a point of the flow
   * trend — never a moment where the workspace had none.
   */
  flows?: GuardRunFlowSummary | null;
}

/** What ONE repository says, today and over time. */
export interface HomeRepoView {
  /** `owner/repo`. */
  repository: string;
  /** Every section this repository reads, as the word it wears today. */
  sections: ReadonlyMap<string, GuardCoveragePlainStatus>;
  /**
   * This repository's flows today, as the words they wear on the Flows page.
   * Statuses only: Home counts them and names none.
   */
  flows: readonly HomeFlowStatus[];
  /** Per document, the reasons its blocked sections give, in document order. */
  blockedReasons?: ReadonlyMap<string, readonly string[]>;
  /** The repository's baseline runs that carry a summary, oldest first. */
  history: readonly HomeHistoryRun[];
}

/** One agent run, as an attention row reads it. */
export interface HomeRunRow {
  runId: string;
  command: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'paused';
  /** `owner/repo`, or null for the workspace's own work (a Document scan). */
  repository: string | null;
  /** When it ended, else when it started. */
  at: string;
  /** Why it ended badly, when the record says. */
  message?: string;
}

/** One open conflict of the workspace corpus. */
export interface HomeConflictRow {
  id: string;
  title: string;
  area: string;
}

/** One source of the workspace, for the rows a failed sync earns. */
export interface HomeSourceRow {
  id: string;
  title: string;
  status: string;
  statusNote: string | null;
  lastSyncAt: string | null;
}

export interface HomeInput {
  /** The moment the answer is composed at. The period counts back from it. */
  now: string;
  period: HomePeriod;
  /** The Documents view's rows, which carry each document's title, area and readers. */
  documents: readonly ContextDocumentRow[];
  repos: readonly HomeRepoView[];
  runs: readonly HomeRunRow[];
  conflicts: readonly HomeConflictRow[];
  sources: readonly HomeSourceRow[];
  /** False when the workspace has no provider a run could use. */
  providerConfigured: boolean;
}

const DAYS: Record<HomePeriod, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

/** The instant a period starts, or null when it reaches back forever. */
function periodStart(now: string, period: HomePeriod): number | null {
  const days = DAYS[period];
  if (days === null) return null;
  const end = Date.parse(now);
  return Number.isNaN(end) ? null : end - days * 86_400_000;
}

function zero(): Record<HomeStatus, number> {
  return Object.fromEntries(HOME_STATUS_ORDER.map((s) => [s, 0])) as Record<HomeStatus, number>;
}

/** A tally over section statuses, in the Documents view's five words. */
function tally(statuses: Iterable<HomeStatus>): HomeTally {
  const byStatus = zero();
  let total = 0;
  for (const status of statuses) {
    byStatus[status]++;
    total++;
  }
  return { total, byStatus };
}

function zeroFlows(): Record<HomeFlowStatus, number> {
  return Object.fromEntries(HOME_FLOW_STATUS_ORDER.map((s) => [s, 0])) as Record<
    HomeFlowStatus,
    number
  >;
}

/**
 * A tally over flow statuses, in the engine's five words. A status this build
 * never learned is dropped rather than counted under a word it does not wear.
 */
function flowTally(statuses: Iterable<HomeFlowStatus>): HomeFlowTally {
  const byStatus = zeroFlows();
  let total = 0;
  for (const status of statuses) {
    if (!(status in byStatus)) continue;
    byStatus[status]++;
    total++;
  }
  return { total, byStatus };
}

/**
 * One status per section, folded WORST FIRST across everything that says
 * something about it, the Documents view's fold applied a level down. The
 * sources are a repository's coverage today, or a repository's latest run at a
 * moment of the trend; they read the same way.
 */
function foldSections(
  sources: Iterable<ReadonlyMap<string, GuardCoveragePlainStatus> | GuardRunSectionSummary>,
  keep: (sectionRef: string) => boolean = () => true,
): Map<string, HomeStatus> {
  const said = new Map<string, ContextDocumentStatus[]>();
  for (const source of sources) {
    const entries =
      source instanceof Map ? source.entries() : Object.entries(source as GuardRunSectionSummary);
    for (const [sectionRef, word] of entries) {
      if (!keep(sectionRef)) continue;
      const status = CONTEXT_DOCUMENT_STATUS_OF_COVERAGE[word as GuardCoveragePlainStatus];
      if (!status) continue;
      said.set(sectionRef, [...(said.get(sectionRef) ?? []), status]);
    }
  }
  const folded = new Map<string, HomeStatus>();
  for (const [sectionRef, statuses] of said) {
    const worst = worstContextStatus(statuses);
    // Not linked is the one word a section can never wear: a section is only
    // counted because a repository that reads it said something about it.
    if (worst && worst !== 'not-linked') folded.set(sectionRef, worst);
  }
  return folded;
}

/** The worst of a document's sections, which is the status the document wears. */
function foldDocuments(sections: ReadonlyMap<string, HomeStatus>): Map<string, HomeStatus> {
  const byDoc = new Map<string, ContextDocumentStatus[]>();
  for (const [sectionRef, status] of sections) {
    const doc = guardSectionRefDoc(sectionRef);
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), status]);
  }
  const folded = new Map<string, HomeStatus>();
  for (const [doc, statuses] of byDoc) {
    const worst = worstContextStatus(statuses);
    if (worst && worst !== 'not-linked') folded.set(doc, worst);
  }
  return folded;
}

/** One document, by its corpus ref. */
export function homeDocHref(ref: string): string {
  return `/context/doc/${encodeURIComponent(ref)}`;
}

/** The file name of a ref, the honest last resort for a title. */
function fileNameOf(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

/**
 * Today: the workspace's FLOWS as the headline, and the areas its SECTIONS fall
 * in. Only the documents at least one repository reads are counted into an
 * area: an unlinked document is nobody's promise. The sections come back too,
 * because the attention rows are made of them.
 */
export function composeHomeToday(input: Pick<HomeInput, 'documents' | 'repos'>): {
  today: HomeFlowTally;
  areas: HomeAreaRow[];
  sections: Map<string, HomeStatus>;
} {
  const linked = new Set(
    input.documents.filter((doc) => doc.repositories.length > 0).map((doc) => doc.ref),
  );
  const areaOf = new Map(input.documents.map((doc) => [doc.ref, doc.area]));

  const sections = foldSections(
    input.repos.map((repo) => repo.sections),
    (sectionRef) => linked.has(guardSectionRefDoc(sectionRef)),
  );

  const byArea = new Map<string, HomeStatus[]>();
  for (const [sectionRef, status] of sections) {
    const area = areaOf.get(guardSectionRefDoc(sectionRef)) ?? '';
    byArea.set(area, [...(byArea.get(area) ?? []), status]);
  }

  const areas: HomeAreaRow[] = [...byArea.entries()]
    .map(([area, statuses]) => ({ area, ...tally(statuses) }))
    .sort((a, b) => {
      const bad = (row: HomeAreaRow) =>
        row.total === 0 ? 0 : (row.byStatus.failed + row.byStatus.blocked) / row.total;
      return (
        bad(b) - bad(a) ||
        b.byStatus.failed - a.byStatus.failed ||
        b.total - a.total ||
        a.area.localeCompare(b.area)
      );
    });

  return {
    today: flowTally(input.repos.flatMap((repo) => [...repo.flows])),
    areas,
    sections,
  };
}

/**
 * The trend and the changes, from the repositories' stored runs.
 *
 * One point per baseline run of any repository, its value the FLOWS of every
 * repository's LATEST run at that moment, so a repository that had not run yet
 * contributes nothing, and a repository whose last run is older keeps saying
 * what it said. A run stored before flows were recorded updates nothing, and a
 * moment where no repository has yet said anything about flows is not a point
 * at all — a trend that draws zero for a workspace whose flows were simply not
 * recorded would be a lie. The points are cut to the period; the FOLD is not,
 * because what a repository said before the window is still what it says
 * inside it.
 *
 * A change is a DOCUMENT whose folded status differs from the moment before,
 * and the first moment a document is covered at all reads First read. Changes
 * are detected over the whole history and then cut to the period, so a document
 * that has been proved for months does not read as new on every window.
 */
export function composeHomeTrend(
  input: Pick<HomeInput, 'now' | 'period' | 'documents' | 'repos'>,
): { trend: HomeTrendPoint[]; changed: HomeChangeRow[] } {
  const moments = input.repos
    .flatMap((repo) => repo.history.map((run) => ({ repository: repo.repository, run })))
    .sort(
      (a, b) => a.run.ranAt.localeCompare(b.run.ranAt) || a.run.runId.localeCompare(b.run.runId),
    );
  if (moments.length === 0) return { trend: [], changed: [] };

  const start = periodStart(input.now, input.period);
  const titleOf = new Map(input.documents.map((doc) => [doc.ref, doc.title]));

  const trend: HomeTrendPoint[] = [];
  const changed: HomeChangeRow[] = [];
  const currentSections = new Map<string, GuardRunSectionSummary>();
  const currentFlows = new Map<string, GuardRunFlowSummary>();
  let previousDocs = new Map<string, HomeStatus>();

  for (const moment of moments) {
    currentSections.set(moment.repository, moment.run.sections);
    if (moment.run.flows) currentFlows.set(moment.repository, moment.run.flows);
    const sections = foldSections(currentSections.values());
    const inPeriod = start === null || Date.parse(moment.run.ranAt) >= start;
    if (inPeriod && currentFlows.size > 0) {
      const flows = [...currentFlows.values()].flatMap(
        (summary) => Object.values(summary) as HomeFlowStatus[],
      );
      trend.push({ at: moment.run.ranAt, byStatus: flowTally(flows).byStatus });
    }

    const docs = foldDocuments(sections);
    for (const [ref, status] of docs) {
      const before = previousDocs.get(ref);
      if (before === status) continue;
      if (!inPeriod) continue;
      changed.push({
        ref,
        title: titleOf.get(ref) ?? fileNameOf(ref),
        event: before === undefined ? 'First read' : HOME_STATUS_WORD[status],
        at: moment.run.ranAt,
        href: homeDocHref(ref),
      });
    }
    previousDocs = docs;
  }

  changed.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));
  return { trend, changed };
}

/**
 * What is waiting on a person, newest first. Five kinds, each a door: a
 * conversation that ended badly and was the LATEST of its kind on its
 * repository (a later success clears it), an open conflict, a document nothing
 * can prove until someone acts, a source whose last sync failed, and the one
 * row a workspace with no usable provider earns.
 */
export function composeHomeAttention(
  input: Pick<
    HomeInput,
    'documents' | 'repos' | 'runs' | 'conflicts' | 'sources' | 'providerConfigured'
  >,
  sections: ReadonlyMap<string, HomeStatus>,
): HomeAttentionRow[] {
  const rows: HomeAttentionRow[] = [];

  // The latest run of each (repository, kind); only that one may be a row.
  const latest = new Map<string, HomeRunRow>();
  for (const run of input.runs) {
    const key = `${run.repository ?? ''}\0${run.command}`;
    const held = latest.get(key);
    if (!held || held.at < run.at) latest.set(key, run);
  }
  for (const run of latest.values()) {
    if (run.status !== 'failed' && run.status !== 'interrupted') continue;
    rows.push({
      id: `conversation:${run.runId}`,
      kind: 'conversation',
      title: runKindWord(run.command),
      status: run.status === 'failed' ? 'Failed' : 'Interrupted',
      fact: [run.repository, run.message].filter(Boolean).join(', '),
      at: run.at,
      href: `/agent/${encodeURIComponent(run.runId)}`,
    });
  }

  for (const conflict of input.conflicts) {
    rows.push({
      id: `conflict:${conflict.id}`,
      kind: 'conflict',
      title: conflict.title,
      status: 'Conflict',
      fact: conflict.area,
      at: null,
      href: `/context/conflicts/${encodeURIComponent(conflict.id)}`,
    });
  }

  // A document nothing can prove: how many of its sections are blocked, and the
  // first reason any repository gave for one of them.
  const blockedByDoc = new Map<string, number>();
  for (const [sectionRef, status] of sections) {
    if (status !== 'blocked') continue;
    const doc = guardSectionRefDoc(sectionRef);
    blockedByDoc.set(doc, (blockedByDoc.get(doc) ?? 0) + 1);
  }
  for (const doc of input.documents) {
    const count = blockedByDoc.get(doc.ref) ?? 0;
    if (doc.status !== 'blocked' || count === 0) continue;
    const reason = input.repos
      .map((repo) => repo.blockedReasons?.get(doc.ref)?.[0])
      .find((text): text is string => Boolean(text));
    const blocked = `${count} section${count === 1 ? '' : 's'} blocked`;
    rows.push({
      id: `document:${doc.ref}`,
      kind: 'blocked-document',
      title: doc.title,
      status: 'Blocked',
      fact: reason ? `${blocked}, ${reason}` : blocked,
      at: doc.updatedAt,
      href: homeDocHref(doc.ref),
    });
  }

  for (const source of input.sources) {
    if (source.status !== 'failed') continue;
    rows.push({
      id: `source:${source.id}`,
      kind: 'source',
      title: source.title,
      status: 'Sync failed',
      fact: source.statusNote ?? '',
      at: source.lastSyncAt,
      href: `/context/sources/${encodeURIComponent(source.id)}`,
    });
  }

  if (!input.providerConfigured) {
    rows.push({
      id: 'provider',
      kind: 'provider',
      title: 'No model provider',
      status: 'Needs setup',
      fact: 'Nothing can run until this workspace names a provider',
      at: null,
      href: '/settings/models',
    });
  }

  // Newest first; the rows time says nothing about sit at the end, in the order
  // the kinds are listed.
  return rows.sort((a, b) => {
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}

/** The whole page, in one answer. */
export function composeHome(input: HomeInput): HomeResponse {
  const { today, areas, sections } = composeHomeToday(input);
  const { trend, changed } = composeHomeTrend(input);
  return {
    period: input.period,
    today,
    trend,
    areas,
    attention: composeHomeAttention(input, sections),
    changed,
  };
}
