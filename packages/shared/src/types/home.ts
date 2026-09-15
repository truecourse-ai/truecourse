/**
 * Home, the one read behind the product owner's dashboard.
 *
 * Home's headline counts FLOWS: a flow is what the engine proves, and it is the
 * unit that can be proved on its own. Sections were the headline once, and the
 * fold made them useless as a total — a section is worth the worst thing in it,
 * so one blocked scenario erased every proof beside it and a workspace with
 * dozens of passing flows read zero. The strip and the trend therefore count
 * flows, in the Flows page's five words, so the same flow wears the same word
 * and rides the same number on both pages.
 *
 * Sections are still counted, and still in the product owner's words: the Areas
 * widget composes an area out of its documents' sections, and Recently changed
 * lists the documents a run moved. The rule is that the VOCABULARY FOLLOWS THE
 * UNIT — a flow reads Succeeded because that is what a flow reads on the Flows
 * page, and a section reads Proved because that is what it reads on Documents.
 *
 * Every address a row opens is computed by the server, so the page holds no
 * routing knowledge of its own.
 */

import { GUARD_COVERAGE_STATUS_WORD, type GuardCoveragePlainStatus } from '../guard/dashboard.js';
import type { ContextDocumentStatus } from './context.js';

// --- Flows: what the strip and the trend count -------------------------------

/** The five words a FLOW wears on Home, which are the engine's own five. */
export type HomeFlowStatus = GuardCoveragePlainStatus;

/**
 * The order flows are LISTED in: the strip's cells, the chart's legend, the
 * readout. It is not the severity order the folds use
 * (`GUARD_COVERAGE_PLAIN_ORDER`). A reader starts from what is proven.
 */
export const HOME_FLOW_STATUS_ORDER = [
  'succeeded',
  'failed',
  'blocked',
  'not-testable',
  'never-run',
] as const satisfies readonly HomeFlowStatus[];

/** The ONE word per flow status — the Flows page's, never a second name. */
export const HOME_FLOW_STATUS_WORD: Record<HomeFlowStatus, string> = GUARD_COVERAGE_STATUS_WORD;

/** Flows counted under the five words. */
export interface HomeFlowTally {
  total: number;
  byStatus: Record<HomeFlowStatus, number>;
}

/** The composition at ONE moment: a baseline run of any repository. */
export interface HomeTrendPoint {
  /** When the run that moved it ran. */
  at: string;
  byStatus: Record<HomeFlowStatus, number>;
}

// --- Sections: what the areas are composed of --------------------------------

/**
 * The five words a SECTION wears on Home, the Documents view's five. Its sixth,
 * Not linked, cannot occur here: an unlinked document is nobody's promise and
 * is off Home entirely.
 */
export type HomeStatus = Exclude<ContextDocumentStatus, 'not-linked'>;

/** The order sections are listed in, for the same reason as the flows'. */
export const HOME_STATUS_ORDER = [
  'proved',
  'failed',
  'blocked',
  'not-testable',
  'not-run',
] as const satisfies readonly HomeStatus[];

/** The ONE word per section status — the Documents page's. */
export const HOME_STATUS_WORD: Record<HomeStatus, string> = {
  proved: 'Proved',
  failed: 'Failed',
  blocked: 'Blocked',
  'not-testable': 'Not testable',
  'not-run': 'Not run',
};

/** Sections counted under the five words. */
export interface HomeTally {
  total: number;
  byStatus: Record<HomeStatus, number>;
}

/** One area's composition, over the sections of its documents. */
export interface HomeAreaRow extends HomeTally {
  /** The corpus's area tag; '' for the documents carrying none. */
  area: string;
}

// --- The rest of the page ----------------------------------------------------

/** How far back the chart and the changes reach. */
export const HOME_PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

/**
 * What a Needs attention row IS. Five kinds and no more: an invented row is
 * worse than an empty widget.
 */
export type HomeAttentionKind =
  | 'conversation'
  | 'conflict'
  | 'blocked-document'
  | 'source'
  | 'provider';

/** One Needs attention row, four corners: title, status, fact, time. */
export interface HomeAttentionRow {
  id: string;
  kind: HomeAttentionKind;
  title: string;
  /** The status WORD the row wears, already in the product's words. */
  status: string;
  fact: string;
  /** When it happened; null for the rows time says nothing about. */
  at: string | null;
  /** Where the row opens, as the client routes it. */
  href: string;
}

/** One Recently changed row: a document whose folded status moved at a run. */
export interface HomeChangeRow {
  /** `context/<sourceId>/<docPath>`, the document's address everywhere. */
  ref: string;
  title: string;
  /** The new status's word, or `First read` the first time a run covered it. */
  event: string;
  at: string;
  href: string;
}

/** `GET /api/home?period=`, the whole page in one answer. */
export interface HomeResponse {
  period: HomePeriod;
  /** Today's FLOWS, over every repository the caller can see. */
  today: HomeFlowTally;
  /** One point per baseline run in the period, oldest first; flows. */
  trend: HomeTrendPoint[];
  /** Worst share first: Failed plus Blocked over the area's SECTIONS. */
  areas: HomeAreaRow[];
  attention: HomeAttentionRow[];
  /** Newest first. */
  changed: HomeChangeRow[];
}

/**
 * What each kind of run is called, in the product's words rather than the
 * store's ids. Home names a conversation with it, and so does the Agent index.
 */
export const RUN_KIND_WORD: Record<string, string> = {
  'spec-scan': 'Document scan',
  'guard-setup': 'Flow setup',
  'guard-generate': 'Flow generation',
  'guard-run': 'Flow run',
  'guard-interfaces': 'Interface authoring',
  'guard-adjudicate': 'Failure adjudication',
};

/** `spec-scan` reads `Document scan`; a kind with no word of its own reads as its id, spaced. */
export function runKindWord(command: string): string {
  return RUN_KIND_WORD[command] ?? command.replace(/-/g, ' ');
}
