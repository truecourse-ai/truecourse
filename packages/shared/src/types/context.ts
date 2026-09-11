/**
 * Context — the workspace's SOURCES and the documents they yield.
 *
 * Documentation stops belonging to a repository: a workspace has sources (its
 * repositories' own markdown, public documentation sites; the tool kinds
 * later), each source yields documents, and a repository BINDS the sources it
 * reads. These are the wire shapes the workspace Context routes speak — the
 * storage seam (`@truecourse/core/lib/context-store`), the Postgres store and
 * the client all read them from here so there is one vocabulary.
 *
 * The six tool kinds are listed so the schema and the add dialog share one
 * vocabulary; nothing in this slice creates a source of those kinds.
 */

import type { GuardCoveragePlainStatus } from '../guard/dashboard.js';

/** Every kind a source can be. Only `repository` and `site` have a driver. */
export const CONTEXT_SOURCE_KINDS = [
  'repository',
  'site',
  'jira',
  'confluence',
  'google-drive',
  'onedrive',
  'notion',
  'slack',
] as const;
export type ContextSourceKind = (typeof CONTEXT_SOURCE_KINDS)[number];

/** The kinds that actually sync today. */
export const IMPLEMENTED_CONTEXT_SOURCE_KINDS: readonly ContextSourceKind[] = ['repository', 'site'];

/**
 * Where a source stands with its origin. `never` is a source nothing has synced
 * yet (it is created that way and the first sync moves it on); `paused` is the
 * user's own stop, and every trigger skips it.
 */
export type ContextSourceStatus = 'synced' | 'syncing' | 'failed' | 'paused' | 'never';

/** A repository source's scope: which branch, and which of its files. */
export interface RepositorySourceConfig {
  /** `owner/repo` — the identity every store, clone and link keys by. */
  repoFullName: string;
  /** Gitignore-style globs a file must match to enter the source. */
  include: string[];
  /** Gitignore-style globs that subtract after the include selects. */
  exclude: string[];
  /** The branch the sync reads. Empty means the repository's default branch. */
  branch: string;
}

/** A documentation site's scope: the llms.txt that lists its pages. */
export interface SiteSourceConfig {
  llmsTxtUrl: string;
}

export type ContextSourceConfig = RepositorySourceConfig | SiteSourceConfig | Record<string, unknown>;

/** The default scope a Repository source is created with (plan §3). */
export const DEFAULT_REPOSITORY_INCLUDE: readonly string[] = ['docs/**', '**/*.md'];

/** Changelogs and licenses are documentation of the release, not of the product. */
export const DEFAULT_REPOSITORY_EXCLUDE: readonly string[] = [
  '**/CHANGELOG*',
  '**/changelog*',
  '**/LICENSE*',
  '**/license*',
  '**/LICENCE*',
  '**/licence*',
];

/** One source of the workspace, as every reader sees it. */
export interface ContextSource {
  id: string;
  kind: ContextSourceKind;
  title: string;
  config: ContextSourceConfig;
  status: ContextSourceStatus;
  /** Why the status is what it is — the failure reason, verbatim. */
  statusNote: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One document a source yielded — the ledger row, never the body. */
export interface ContextDocument {
  sourceId: string;
  /** The page URL for a site, the repo-relative path for a repository. */
  docId: string;
  /** The ref's path half: the snapshot path for a site, the file path for a repository. */
  docPath: string;
  title: string;
  /** Where it came from, when that is a URL (a site page). */
  url: string | null;
  /** sha256 hex of the body at the last sync — the diff key and the pool key. */
  contentHash: string;
  /** When the document last CHANGED at its source. */
  updatedAt: string;
  createdAt: string;
}

/** One refresh of a source: when, and what it reconciled. */
export interface ContextSyncRecord {
  sourceId: string;
  at: string;
  /** The sync this one diffed against, or null for the first. */
  parentAt: string | null;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

/** Why a listed document produced nothing. Free-form per driver, rendered verbatim. */
export interface ContextSkip {
  /** The URL or path that was skipped. */
  ref: string;
  reason: string;
  detail?: string;
}

/** What a source's scope WOULD yield, read without storing anything. */
export interface ContextSourceCheck {
  /** The title the source would take. */
  title: string;
  /** How many documents the scope yields. */
  count: number;
  /** The first document titles, in the order the driver listed them. */
  titles: string[];
  /** What the scope listed but would not store. */
  skipped: ContextSkip[];
}

/** A repository reads a source. */
export interface ContextBinding {
  repoFullName: string;
  sourceId: string;
  createdAt: string;
}

// --- Wire shapes ------------------------------------------------------------

/** A source as the Context pages list it: the row plus its derived counts. */
export interface ContextSourceView extends ContextSource {
  docCount: number;
  /** `owner/repo` of every repository that reads it. */
  repositories: string[];
}

export interface ContextSourcesResponse {
  sources: ContextSourceView[];
  /** The latest sync that changed something, or binding change. Null when nothing ever did. */
  changedAt: string | null;
}

export interface ContextDocumentsResponse {
  source: ContextSourceView;
  documents: ContextDocument[];
}

export interface ContextBindingsResponse {
  repoFullName: string;
  sourceIds: string[];
}

// --- The Documents view -----------------------------------------------------

/**
 * What a reader is told about ONE DOCUMENT of the workspace corpus. Five of the
 * six are the coverage vocabulary in the product owner's words (the engine's
 * `succeeded` reads Proved, its `never-run` reads Not run); the sixth is the
 * one state only Context has — a document no repository reads, which nothing
 * has tried to prove because nothing was asked to.
 */
export type ContextDocumentStatus =
  | 'proved'
  | 'failed'
  | 'blocked'
  | 'not-testable'
  | 'not-run'
  | 'not-linked';

/**
 * The six in SEVERITY order — worst first. It is the order a document's
 * repositories are folded in (a failure in one repository outranks a proof in
 * another), the order the rows are sorted in, and the order the Status filter
 * lists them in. `not-linked` is last with `not-testable`: neither is anybody's
 * to-do.
 */
export const CONTEXT_DOCUMENT_STATUS_ORDER = [
  'failed',
  'blocked',
  'not-run',
  'proved',
  'not-testable',
  'not-linked',
] as const satisfies readonly ContextDocumentStatus[];

/** The ONE word per status. Nothing else may name a document's state. */
export const CONTEXT_DOCUMENT_STATUS_WORD: Record<ContextDocumentStatus, string> = {
  proved: 'Proved',
  failed: 'Failed',
  blocked: 'Blocked',
  'not-testable': 'Not testable',
  'not-run': 'Not run',
  'not-linked': 'Not linked',
};

/**
 * The engine's five coverage words in the product owner's five. One map, so a
 * document's row and the coverage page it opens can never disagree about what
 * the same section statuses mean.
 */
export const CONTEXT_DOCUMENT_STATUS_OF_COVERAGE: Record<
  GuardCoveragePlainStatus,
  ContextDocumentStatus
> = {
  succeeded: 'proved',
  failed: 'failed',
  blocked: 'blocked',
  'never-run': 'not-run',
  'not-testable': 'not-testable',
};

/**
 * How ONE repository reads one document. The Documents view folds these into
 * the row's single status; the document page uses them to open on the
 * repository with the most to say — the worst reading, which is the one a
 * reader came for.
 */
export interface ContextDocumentReading {
  /** `owner/repo`. */
  repository: string;
  status: ContextDocumentStatus;
}

/** One row of the Documents view — one document of the workspace corpus. */
export interface ContextDocumentRow {
  /** `context/<sourceId>/<docPath>` — the document's address everywhere. */
  ref: string;
  /** The ledger's title, else the ref's file name. Never composed. */
  title: string;
  /** The corpus's area tag (the first when a document carries several); '' when none. */
  area: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: ContextSourceKind;
  /** `owner/repo` of every repository that reads this document's source, by name. */
  repositories: string[];
  /** The same repositories with what each says about the document, WORST FIRST. */
  readings: ContextDocumentReading[];
  /** Folded worst-first across those repositories; `not-linked` when there are none. */
  status: ContextDocumentStatus;
  /** When the document last changed at its source, or null when the ledger has lost it. */
  updatedAt: string | null;
}

export interface ContextDocumentsViewResponse {
  documents: ContextDocumentRow[];
  /** When the corpus these rows come from was built; null when none has been. */
  corpusAt: string | null;
}
