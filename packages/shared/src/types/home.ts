/**
 * Home, the one read behind the product owner's dashboard.
 *
 * Home counts SECTIONS, not documents: a section is the unit the engine proves,
 * and a document is a bag of them. The five words are the Documents view's
 * five (its sixth, Not linked, cannot occur here: an unlinked document is
 * nobody's promise and is off Home), so a section means the same thing on both
 * pages and in a run's stored history.
 *
 * Every address a row opens is computed by the server, so the page holds no
 * routing knowledge of its own.
 */

import type { ContextDocumentStatus } from './context.js';

/** The five words Home counts in, the Documents view's minus Not linked. */
export type HomeStatus = Exclude<ContextDocumentStatus, 'not-linked'>;

/**
 * The order the words are LISTED in, everywhere: the chart's legend and the
 * readout, an area's dot counts, the filter values. It is not the severity
 * order the folds use ({@link CONTEXT_DOCUMENT_STATUS_ORDER}). A reader starts
 * from what is proven.
 */
export const HOME_STATUS_ORDER = [
  'proved',
  'failed',
  'blocked',
  'not-testable',
  'not-run',
] as const satisfies readonly HomeStatus[];

/** The ONE word per status. Nothing else may name a section's state on Home. */
export const HOME_STATUS_WORD: Record<HomeStatus, string> = {
  proved: 'Proved',
  failed: 'Failed',
  blocked: 'Blocked',
  'not-testable': 'Not testable',
  'not-run': 'Not run',
};

/** How far back the chart and the changes reach. */
export const HOME_PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

/** Sections counted under the five words. */
export interface HomeTally {
  total: number;
  byStatus: Record<HomeStatus, number>;
}

/** The composition at ONE moment: a baseline run of any repository. */
export interface HomeTrendPoint {
  /** When the run that moved it ran. */
  at: string;
  byStatus: Record<HomeStatus, number>;
}

/** One area's composition, over the sections of its documents. */
export interface HomeAreaRow extends HomeTally {
  /** The corpus's area tag; '' for the documents carrying none. */
  area: string;
}

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
  /** Today's sections, over the documents at least one repository reads. */
  today: HomeTally;
  /** One point per baseline run in the period, oldest first. */
  trend: HomeTrendPoint[];
  /** Worst share first: Failed plus Blocked over the area's sections. */
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
