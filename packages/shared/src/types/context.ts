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
