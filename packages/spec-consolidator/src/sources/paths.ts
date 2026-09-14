/**
 * Where a fetched page LANDS, and what a sync diffs it on.
 *
 * A documentation site's pages are addressed by URL and stored by path, so
 * every page needs a filesystem-safe path derived from its URL, stable across
 * refetches (a doc that didn't change must not move just because a neighbour
 * was added), plus a content hash the sync's diff keys on. That mapping is all
 * this module is: no tree is written here and no registry is kept — the site
 * driver hands the pages, their paths and their hashes to its caller.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { SourcePathError } from './errors.js';

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
  // differ from the path the page is recorded under.
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
 * Map a normalized page URL to its path within its source. The origin is
 * dropped (one source per origin), the path is decoded and made
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
  if (escapesDir(normalized) || path.posix.isAbsolute(normalized)) throw new SourcePathError(url);
  return normalized;
}

/** True when a relative path climbs out of its base. A leading `..` in a NAME
 *  (`..-..-etc`, from a decoded `%2f`) is not a climb — only a `..` segment is. */
function escapesDir(relative: string): boolean {
  return relative.split('/').includes('..');
}

function withSuffix(snapshotPath: string, n: number): string {
  const dot = snapshotPath.lastIndexOf('.');
  const slash = snapshotPath.lastIndexOf('/');
  return dot > slash
    ? `${snapshotPath.slice(0, dot)}-${n}${snapshotPath.slice(dot)}`
    : `${snapshotPath}-${n}`;
}

/**
 * Assign a path to every URL, in order, resolving collisions (`/guides`
 * and `/guides.md` both want `guides.md`) with a numeric suffix.
 *
 * `existing` pins the paths of URLs that already have one: the scan's caches
 * are keyed on `path :: contentHash`, so a doc that didn't change must not
 * move just because a neighbour was added or removed.
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
