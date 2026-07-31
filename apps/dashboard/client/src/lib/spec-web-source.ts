/**
 * Display mapping for WEB-SOURCE spec docs — pages snapshotted from a registered
 * llms.txt site by `truecourse spec source add`.
 *
 * Their corpus ref is the real repo-relative path of the snapshot file
 * (`.truecourse/specs/sources/<sourceId>/<page>.md`), which is what every
 * downstream consumer reads — but it is unreadable in a list. Everything that
 * shows one to a person renders `<source title> / <page path>` instead, and the
 * ref itself stays the identity (selection, tabs, decisions are unchanged).
 *
 * The source title comes from the corpus payload's enrichment (the server reads
 * `sources.json`); when it is missing — a ref carried by a decision list, or a
 * source that was removed — the id in the ref is used, so a label is always
 * derivable from the ref alone.
 */

/** The repo-relative prefix every snapshot ref starts with (server-side constant). */
export const SPEC_SOURCES_REF_PREFIX = '.truecourse/specs/sources';

export interface WebDocRef {
  /** The source's registry id, from the ref's own path segment. */
  sourceId: string;
  /** The page's path inside the source (`cms/installation.md`). */
  page: string;
}

/** Split a snapshot ref into its source id + page path; null for a repo doc. */
export function parseWebDocRef(ref: string): WebDocRef | null {
  if (!ref.startsWith(`${SPEC_SOURCES_REF_PREFIX}/`)) return null;
  const rest = ref.slice(SPEC_SOURCES_REF_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { sourceId: rest.slice(0, slash), page: rest.slice(slash + 1) };
}

/** True when a ref names a page of a registered web source. */
export function isWebDocRef(ref: string): boolean {
  return parseWebDocRef(ref) !== null;
}

/** `<source title> / <page path>` for a web ref, else null (a repo doc). */
export function webDocLabel(ref: string, sourceTitle?: string): string | null {
  const parsed = parseWebDocRef(ref);
  if (!parsed) return null;
  return `${sourceTitle ?? parsed.sourceId} / ${parsed.page}`;
}

/** The display label of any doc row: its web label, its title, else the ref. */
export function specDocLabel(
  doc: { ref: string; title?: string; sourceTitle?: string },
): string {
  return webDocLabel(doc.ref, doc.sourceTitle) ?? doc.title ?? doc.ref;
}

/** Why a link in a site's llms.txt produced no snapshot page, in plain words. */
export const SKIP_REASON: Record<string, string> = {
  'external-origin': 'links off this site',
  'not-markdown': 'page is not markdown',
  'fetch-failed': 'could not be fetched',
};

/** "1 page" / "214 pages" — one phrasing across the sources UI. */
export function pageCount(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Selection keys — a registered source is a corpus-tree row like a doc or a
// conflict, so it addresses the right pane through the same one-key channel
// (`overlap::…` is the conflict analog). The key travels as `?gsrc=<id>`.
// ---------------------------------------------------------------------------

const SOURCE_KEY_PREFIX = 'source::';

/** The selection key of one registered source. */
export function sourceKey(sourceId: string): string {
  return `${SOURCE_KEY_PREFIX}${sourceId}`;
}

/**
 * The add-a-source view's key. `*` is outside the source-id slug charset
 * (`[a-z0-9._-]`), so it can never collide with a real source, and
 * `URLSearchParams` leaves it unescaped — `?gsrc=*new` stays readable.
 */
export const SOURCE_ADD_KEY = sourceKey('*new');

export type SourceSelection = { kind: 'add' } | { kind: 'source'; id: string };

/** Parse a selection key into the source view it addresses; null for a doc/conflict. */
export function parseSourceKey(key: string | null): SourceSelection | null {
  if (!key || !key.startsWith(SOURCE_KEY_PREFIX)) return null;
  const id = key.slice(SOURCE_KEY_PREFIX.length);
  if (!id) return null;
  return key === SOURCE_ADD_KEY ? { kind: 'add' } : { kind: 'source', id };
}

/** The `?gsrc=` value a source key carries, or null when the key is not one. */
export function sourceKeyParam(key: string): string | null {
  return key.startsWith(SOURCE_KEY_PREFIX) ? key.slice(SOURCE_KEY_PREFIX.length) : null;
}

/** The source key a `?gsrc=` value addresses (the inverse of {@link sourceKeyParam}). */
export function sourceKeyFromParam(value: string | null): string | null {
  return value ? sourceKey(value) : null;
}
