/**
 * The web-sources store: the `sources.json` registry, the URL→file mapping, and
 * the snapshot lifecycle (`add` / `refresh` / `remove`).
 *
 * Fetched pages become REAL FILES under `.truecourse/specs/sources/<id>/`
 * because every downstream consumer (discovery, the pre-flight estimate, guard
 * generate's doc index, the dashboard's doc viewer) re-reads doc content from
 * disk by repo-relative path. Materializing means none of them need a seam.
 *
 * The registry OWNS the snapshot tree: a refresh only ever deletes files it
 * lists, so a stray file a user dropped in the directory is never destroyed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile, atomicWriteJson } from '../atomic-write.js';
import { SourceExistsError, SourceNotFoundError, SourcePathError, SourcesFileError } from './errors.js';
import {
  assertLlmsTxtUrl,
  fetchLlmsTxt,
  fetchPages,
  type FetchOptions,
  type FetchedPage,
} from './fetcher.js';
import { flattenLinks } from './llms-txt.js';
import {
  SourcesFileSchema,
  type SourceDoc,
  type SourceSkip,
  type SourcesFile,
  type SpecSource,
} from './types.js';

const SOURCES_FILE = 'sources.json';
const SOURCES_DIR = 'sources';

/** Repo-relative prefix every source doc's ref starts with (forward slashes). */
export const SOURCES_REF_PREFIX = '.truecourse/specs/sources';

export function sourcesFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', SOURCES_FILE);
}

export function sourcesDirPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', SOURCES_DIR);
}

export function sourceDirPath(repoRoot: string, sourceId: string): string {
  return path.join(sourcesDirPath(repoRoot), sourceId);
}

/** The repo-relative ref a snapshot file is known by downstream (discovery, corpus). */
export function sourceDocRef(sourceId: string, docPath: string): string {
  return `${SOURCES_REF_PREFIX}/${sourceId}/${docPath}`;
}

/**
 * Read the registry. Missing ⇒ empty; unparseable ⇒ throws, because writing over
 * a corrupt registry would orphan every snapshot file it still names.
 */
export function readSourcesFile(repoRoot: string): SourcesFile {
  const file = sourcesFilePath(repoRoot);
  if (!fs.existsSync(file)) return { version: 1, sources: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new SourcesFileError(file, err instanceof Error ? err.message : String(err));
  }
  const parsed = SourcesFileSchema.safeParse(raw);
  if (!parsed.success) throw new SourcesFileError(file, parsed.error.issues[0]?.message ?? 'schema mismatch');
  return parsed.data;
}

export function writeSourcesFile(repoRoot: string, file: SourcesFile): void {
  atomicWriteJson(sourcesFilePath(repoRoot), file);
}

export function listSources(repoRoot: string): SpecSource[] {
  return readSourcesFile(repoRoot).sources;
}

// ---------------------------------------------------------------------------
// URL to snapshot path
// ---------------------------------------------------------------------------

/** Characters no Windows path segment may contain (`/` also splits segments). */
const UNSAFE_SEGMENT_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
/** Below this code point a character is a control char — never a file name. */
const FIRST_PRINTABLE = 0x20;
/** Windows device names — unusable as a file name even with an extension. */
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Leaves room for the collision suffix under the 255-byte limit every FS has. */
const MAX_SEGMENT_CHARS = 120;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sanitizeSegment(segment: string): string {
  if (segment === '.' || segment === '..') return '';
  let out = [...segment]
    .map((ch) => (UNSAFE_SEGMENT_CHARS.has(ch) || ch.codePointAt(0)! < FIRST_PRINTABLE ? '-' : ch))
    .join('')
    .replace(/\s+/g, '-');
  // Windows silently drops trailing dots, which would make the file on disk
  // differ from the path recorded in the registry.
  out = out.replace(/\.+$/, '');
  const dot = out.indexOf('.');
  if (RESERVED_SEGMENT.test(dot === -1 ? out : out.slice(0, dot))) {
    out = dot === -1 ? `${out}_` : `${out.slice(0, dot)}_${out.slice(dot)}`;
  }
  if (out.length > MAX_SEGMENT_CHARS) {
    const digest = createHash('sha256').update(segment).digest('hex').slice(0, 8);
    out = `${out.slice(0, MAX_SEGMENT_CHARS - 9)}-${digest}`;
  }
  return out;
}

/**
 * Map a normalized page URL to its snapshot path, relative to `sources/<id>/`.
 * The origin is dropped (one source per origin), the path is decoded and made
 * filesystem-safe, and the result always ends in `.md` so discovery picks it up.
 */
export function urlToSnapshotPath(url: string): string {
  const segments = new URL(url).pathname
    .split('/')
    .map(decodeSegment)
    .map(sanitizeSegment)
    .filter((segment) => segment !== '');
  if (segments.length === 0) return 'index.md';
  const last = segments[segments.length - 1];
  segments[segments.length - 1] = /\.md$/i.test(last) ? last : `${last}.md`;
  const normalized = path.posix.normalize(segments.join('/'));
  if (escapesDir(normalized, '/') || path.posix.isAbsolute(normalized)) throw new SourcePathError(url);
  return normalized;
}

/** True when a relative path climbs out of its base. A leading `..` in a NAME
 *  (`..-..-etc`, from a decoded `%2f`) is not a climb — only a `..` segment is. */
function escapesDir(relative: string, separator: string): boolean {
  return relative.split(separator).includes('..');
}

function withSuffix(snapshotPath: string, n: number): string {
  const dot = snapshotPath.lastIndexOf('.');
  const slash = snapshotPath.lastIndexOf('/');
  return dot > slash
    ? `${snapshotPath.slice(0, dot)}-${n}${snapshotPath.slice(dot)}`
    : `${snapshotPath}-${n}`;
}

/**
 * Assign a snapshot path to every URL, in order, resolving collisions (`/guides`
 * and `/guides.md` both want `guides.md`) with a numeric suffix.
 *
 * `existing` pins the paths of URLs that already have one: relevance and
 * area-tag caches are keyed on `path :: contentHash`, so a doc that didn't
 * change must not move just because a neighbour was added or removed.
 */
export function mapUrlsToPaths(urls: string[], existing?: ReadonlyMap<string, string>): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  if (existing) {
    for (const url of urls) {
      const prior = existing.get(url);
      if (!prior || used.has(prior)) continue;
      assigned.set(url, prior);
      used.add(prior);
    }
  }
  for (const url of urls) {
    if (assigned.has(url)) continue;
    const base = urlToSnapshotPath(url);
    let candidate = base;
    let n = 1;
    while (used.has(candidate)) candidate = withSuffix(base, ++n);
    assigned.set(url, candidate);
    used.add(candidate);
  }
  return assigned;
}

/** sha256 hex — the same convention `discoverDocs()` stamps on a repo doc. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function resolveWithin(dir: string, snapshotPath: string, url: string): string {
  const abs = path.resolve(dir, snapshotPath);
  const rel = path.relative(dir, abs);
  if (!rel || escapesDir(rel, path.sep) || path.isAbsolute(rel)) throw new SourcePathError(url);
  return abs;
}

/** Derive an id slug from an llms.txt URL: host, plus path when it isn't at the root. */
export function sourceIdFromUrl(llmsTxtUrl: string): string {
  const url = new URL(llmsTxtUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  segments.pop();
  return slugifyId([url.host, ...segments].join('-'));
}

export function slugifyId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface AddSourceOptions extends FetchOptions {
  /** Override the derived id (must be unused). */
  id?: string;
}

export interface AddSourceResult {
  source: SpecSource;
  /** Snapshot files written. */
  written: number;
  skipped: SourceSkip[];
}

/**
 * Register a docs site and snapshot every markdown page its llms.txt lists.
 * Refuses a URL already registered rather than silently re-fetching it — the
 * caller wanted `refresh`.
 */
export async function addSource(
  repoRoot: string,
  llmsTxtUrl: string,
  opts: AddSourceOptions = {},
): Promise<AddSourceResult> {
  const url = assertLlmsTxtUrl(llmsTxtUrl);
  const registry = readSourcesFile(repoRoot);
  const id = opts.id ? slugifyId(opts.id) : sourceIdFromUrl(url);
  if (registry.sources.some((source) => source.llmsTxtUrl === url)) {
    throw new SourceExistsError(id, `${url} is already registered — run refresh to update it`);
  }
  if (registry.sources.some((source) => source.id === id)) {
    throw new SourceExistsError(id, `a source with id "${id}" is already registered`);
  }

  const { doc, url: finalUrl } = await fetchLlmsTxt(url, opts);
  const links = flattenLinks(doc);
  const { pages, skipped } = await fetchPages(links, new URL(finalUrl).origin, opts);

  // A directory left behind by a source that is no longer registered is not ours
  // to keep — the registry is the owner of this tree.
  const dir = sourceDirPath(repoRoot, id);
  fs.rmSync(dir, { recursive: true, force: true });

  const paths = mapUrlsToPaths(pages.map((page) => page.url));
  const docs = pages.map((page) => writePage(dir, page, paths.get(page.url)!));

  const source: SpecSource = {
    id,
    llmsTxtUrl: url,
    title: doc.title || new URL(url).host,
    fetchedAt: new Date().toISOString(),
    docs,
    skipped,
  };
  writeSourcesFile(repoRoot, { version: 1, sources: [...registry.sources, source] });
  return { source, written: docs.length, skipped };
}

function writePage(dir: string, page: FetchedPage, snapshotPath: string): SourceDoc {
  atomicWriteFile(resolveWithin(dir, snapshotPath, page.url), page.content);
  return {
    url: page.url,
    path: snapshotPath,
    title: page.title,
    contentHash: hashContent(page.content),
  };
}

export interface RefreshSourceResult {
  source: SpecSource;
  /** Snapshot paths, relative to `sources/<id>/`. */
  added: string[];
  changed: string[];
  /** Deleted from disk — pages the llms.txt no longer lists. */
  removed: string[];
  unchanged: string[];
  skipped: SourceSkip[];
}

/**
 * Refetch a registered source and reconcile the snapshot with it.
 *
 * Only a page the llms.txt STOPPED listing is deleted. A page that is still
 * listed but failed to fetch (or stopped serving markdown) keeps its last good
 * snapshot and shows up in `skipped` — a transient 500 must never wipe committed
 * content.
 */
export async function refreshSource(
  repoRoot: string,
  sourceId: string,
  opts: FetchOptions = {},
): Promise<RefreshSourceResult> {
  const registry = readSourcesFile(repoRoot);
  const previous = registry.sources.find((source) => source.id === sourceId);
  if (!previous) throw new SourceNotFoundError(sourceId);

  const { doc, url: finalUrl } = await fetchLlmsTxt(previous.llmsTxtUrl, opts);
  const links = flattenLinks(doc);
  const { pages, skipped } = await fetchPages(links, new URL(finalUrl).origin, opts);

  const dir = sourceDirPath(repoRoot, sourceId);
  const previousByUrl = new Map(previous.docs.map((entry) => [entry.url, entry]));
  const pageByUrl = new Map(pages.map((page) => [page.url, page]));
  const listedUrls = new Set(links.map((link) => link.url));
  // Kept, not refetched: still listed, but unreadable this run.
  const carriedUrls = previous.docs
    .filter((entry) => listedUrls.has(entry.url) && !pageByUrl.has(entry.url))
    .map((entry) => entry.url);

  const paths = mapUrlsToPaths(
    [...pages.map((page) => page.url), ...carriedUrls],
    new Map(previous.docs.map((entry) => [entry.url, entry.path])),
  );

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const docs: SourceDoc[] = [];

  for (const link of links) {
    const page = pageByUrl.get(link.url);
    const before = previousByUrl.get(link.url);
    if (!page) {
      if (before) docs.push(before);
      continue;
    }
    const snapshotPath = paths.get(page.url)!;
    const hash = hashContent(page.content);
    const upToDate =
      before?.contentHash === hash &&
      before.path === snapshotPath &&
      fs.existsSync(resolveWithin(dir, snapshotPath, page.url));
    if (upToDate) {
      unchanged.push(snapshotPath);
      docs.push(before);
      continue;
    }
    if (before && before.path !== snapshotPath) deleteSnapshot(dir, before.path);
    docs.push(writePage(dir, page, snapshotPath));
    (before ? changed : added).push(snapshotPath);
  }

  const removed: string[] = [];
  for (const entry of previous.docs) {
    if (listedUrls.has(entry.url)) continue;
    deleteSnapshot(dir, entry.path);
    removed.push(entry.path);
  }

  const source: SpecSource = {
    ...previous,
    title: doc.title || previous.title,
    fetchedAt: new Date().toISOString(),
    docs,
    skipped,
  };
  writeSourcesFile(repoRoot, {
    version: 1,
    sources: registry.sources.map((entry) => (entry.id === sourceId ? source : entry)),
  });
  return { source, added, changed, removed, unchanged, skipped };
}

function deleteSnapshot(dir: string, snapshotPath: string): void {
  const abs = path.resolve(dir, snapshotPath);
  if (escapesDir(path.relative(dir, abs), path.sep)) return;
  fs.rmSync(abs, { force: true });
}

/** Drop a source: its snapshot directory and its registry entry. */
export function removeSource(repoRoot: string, sourceId: string): SpecSource {
  const registry = readSourcesFile(repoRoot);
  const removed = registry.sources.find((source) => source.id === sourceId);
  if (!removed) throw new SourceNotFoundError(sourceId);
  fs.rmSync(sourceDirPath(repoRoot, sourceId), { recursive: true, force: true });
  writeSourcesFile(repoRoot, {
    version: 1,
    sources: registry.sources.filter((source) => source.id !== sourceId),
  });
  return removed;
}
