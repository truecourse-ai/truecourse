/**
 * The network half of the web-sources engine: read a site's llms.txt, then read
 * every page it lists as markdown.
 *
 * Everything here is deliberately I/O-only and prompt-free — no LLM call happens
 * during `add`/`refresh`, which is what keeps `spec scan` offline and
 * deterministic (it only ever reads the snapshot on disk).
 *
 * Page resolution, in order:
 *   1. the link already ends in `.md` — fetch it as-is;
 *   2. otherwise probe `<url>.md` — accepted unless the site answered with HTML
 *      (a soft 404: 200 + an app shell), in which case we fall through;
 *   3. otherwise fetch the link itself and accept only a markdown/plain body.
 * A page that resolves to none of these is SKIPPED with a reason, never
 * converted from HTML — v1 supports llms.txt-enabled sites only.
 */

import pLimit from 'p-limit';
import { LlmsTxtFetchError, InvalidSourceUrlError } from './errors.js';
import { flattenLinks, normalizeSourceUrl, parseLlmsTxt, type LlmsTxtDoc, type LlmsTxtLink } from './llms-txt.js';
import type { SourceSkip } from './types.js';

export const USER_AGENT = 'truecourse';

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1000;
const MAX_RETRY_WAIT_S = 60;

/** Content types whose body is taken as markdown when a plain URL is fetched. */
const MARKDOWN_CONTENT_TYPES = new Set(['text/markdown', 'text/plain']);
/** Content types that mean "this is a rendered page, not a document". */
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface FetchProgress {
  done: number;
  total: number;
}

export interface FetchOptions {
  /** Parallel page requests. Default 6. */
  concurrency?: number;
  /** Per-request timeout. Default 10s. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  retries?: number;
  /** Backoff unit when no `Retry-After` header is given. Default 1s. */
  retryBaseMs?: number;
  /**
   * Called once per settled page. A plain callback, not a tracker: this package
   * must not depend on `@truecourse/core`, so the command layer adapts it.
   */
  onProgress?: (progress: FetchProgress) => void;
}

interface ResolvedOptions {
  concurrency: number;
  timeoutMs: number;
  retries: number;
  retryBaseMs: number;
  onProgress?: (progress: FetchProgress) => void;
}

function resolveOptions(opts: FetchOptions): ResolvedOptions {
  return {
    concurrency: opts.concurrency ?? DEFAULT_CONCURRENCY,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: opts.retries ?? DEFAULT_RETRIES,
    retryBaseMs: opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    onProgress: opts.onProgress,
  };
}

/** A page that resolved to markdown. */
export interface FetchedPage {
  /** The normalized link URL — the doc's identity, not necessarily what was GET'd. */
  url: string;
  title: string;
  content: string;
}

export interface FetchPagesResult {
  pages: FetchedPage[];
  skipped: SourceSkip[];
}

export interface SourcePreview {
  /** The llms.txt URL, normalized. */
  llmsTxtUrl: string;
  title: string;
  /** Every link the llms.txt lists. */
  totalLinks: number;
  /** Those on the llms.txt's own origin — the ones an `add` would fetch. */
  fetchableLinks: number;
  /** The off-origin links, already excluded. */
  skipped: SourceSkip[];
}

class RequestFailure extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RequestFailure';
  }
}

/**
 * Validate + normalize a source URL. Auto-discovery is deliberately absent: the
 * user names the llms.txt, so a site with several docs deployments is added once
 * per deployment instead of guessing which one is canonical.
 */
export function assertLlmsTxtUrl(raw: string): string {
  const normalized = normalizeSourceUrl(raw, 'https://invalid.localhost/');
  if (!normalized) throw new InvalidSourceUrlError(raw);
  const url = new URL(normalized);
  if (!/\/llms\.txt$/i.test(url.pathname)) throw new InvalidSourceUrlError(raw);
  return normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Milliseconds to wait before a retry, honoring `Retry-After` (seconds). */
function retryDelayMs(res: Response | null, attempt: number, opts: ResolvedOptions): number {
  const header = res?.headers.get('retry-after');
  const secs = header != null ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, MAX_RETRY_WAIT_S) * 1000;
  return Math.min(2 ** attempt, 30) * opts.retryBaseMs;
}

function transportMessage(err: unknown): string {
  if (err instanceof Error) {
    // AbortSignal.timeout rejects with a bare "The operation was aborted".
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'request timed out';
    return err.message;
  }
  return String(err);
}

/** Release a response body we are not going to read, so the socket is reusable. */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* already consumed or errored */
  }
}

/**
 * One GET with bounded retries. Retries transport failures and the statuses a
 * docs host uses for backpressure (429 / 5xx); a 404 fails immediately so the
 * speculative `<url>.md` probe stays cheap.
 */
async function get(url: string, opts: ResolvedOptions): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1',
        },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (attempt < opts.retries) {
        await sleep(retryDelayMs(null, attempt, opts));
        continue;
      }
      throw new RequestFailure(transportMessage(err));
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < opts.retries) {
      const wait = retryDelayMs(res, attempt, opts);
      await discard(res);
      await sleep(wait);
      continue;
    }
    await discard(res);
    throw new RequestFailure(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, res.status);
  }
}

function contentType(res: Response): string {
  return (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

/** Fetch + parse a site's llms.txt. Also reports the URL it finally resolved to. */
export async function fetchLlmsTxt(
  llmsTxtUrl: string,
  opts: FetchOptions = {},
): Promise<{ doc: LlmsTxtDoc; url: string }> {
  const resolved = resolveOptions(opts);
  let res: Response;
  try {
    res = await get(llmsTxtUrl, resolved);
  } catch (err) {
    throw new LlmsTxtFetchError(llmsTxtUrl, transportMessage(err));
  }
  // Redirects (http→https, apex→www) move the origin the same-origin filter and
  // relative links must resolve against, so the FINAL url is the base.
  const finalUrl = res.url || llmsTxtUrl;
  const text = await res.text();
  const doc = parseLlmsTxt(text, finalUrl);
  if (!doc.title && flattenLinks(doc).length === 0) {
    throw new LlmsTxtFetchError(llmsTxtUrl, 'no llms.txt content found (no title, no links)');
  }
  return { doc, url: finalUrl };
}

/** Split links into the ones we may fetch and the off-origin ones we never do. */
export function partitionByOrigin(
  links: LlmsTxtLink[],
  origin: string,
): { sameOrigin: LlmsTxtLink[]; external: LlmsTxtLink[] } {
  const sameOrigin: LlmsTxtLink[] = [];
  const external: LlmsTxtLink[] = [];
  for (const link of links) {
    (new URL(link.url).origin === origin ? sameOrigin : external).push(link);
  }
  return { sameOrigin, external };
}

function pageTitle(link: LlmsTxtLink): string {
  if (link.title) return link.title;
  const segments = new URL(link.url).pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? link.url;
}

/** `https://x/a` → `https://x/a.md` (the speculative markdown twin of a page URL). */
function markdownTwin(url: string): string {
  const twin = new URL(url);
  twin.pathname = `${twin.pathname.replace(/\/+$/, '')}.md`;
  return twin.toString();
}

type PageOutcome = { page: FetchedPage } | { skip: SourceSkip };

async function fetchPage(link: LlmsTxtLink, opts: ResolvedOptions): Promise<PageOutcome> {
  const title = pageTitle(link);
  const isMarkdownUrl = /\.md$/i.test(new URL(link.url).pathname);

  if (isMarkdownUrl) {
    try {
      const res = await get(link.url, opts);
      return { page: { url: link.url, title, content: await res.text() } };
    } catch (err) {
      return { skip: { url: link.url, reason: 'fetch-failed', detail: transportMessage(err) } };
    }
  }

  try {
    const res = await get(markdownTwin(link.url), opts);
    if (!HTML_CONTENT_TYPES.has(contentType(res))) {
      return { page: { url: link.url, title, content: await res.text() } };
    }
    await discard(res);
  } catch {
    /* no markdown twin — fall through to the page itself */
  }

  try {
    const res = await get(link.url, opts);
    const type = contentType(res);
    if (!MARKDOWN_CONTENT_TYPES.has(type)) {
      await discard(res);
      return {
        skip: {
          url: link.url,
          reason: 'not-markdown',
          detail: type ? `content-type: ${type}` : 'no content-type',
        },
      };
    }
    return { page: { url: link.url, title, content: await res.text() } };
  } catch (err) {
    return { skip: { url: link.url, reason: 'fetch-failed', detail: transportMessage(err) } };
  }
}

/**
 * Fetch every same-origin page, `concurrency` at a time. Off-origin links are
 * reported as skipped rather than dropped — the count the user confirmed and the
 * count they end up with must reconcile.
 *
 * Results keep llms.txt order so snapshot paths are assigned deterministically.
 */
export async function fetchPages(
  links: LlmsTxtLink[],
  origin: string,
  opts: FetchOptions = {},
): Promise<FetchPagesResult> {
  const resolved = resolveOptions(opts);
  const { sameOrigin, external } = partitionByOrigin(links, origin);
  const skipped: SourceSkip[] = external.map((link) => ({
    url: link.url,
    reason: 'external-origin' as const,
  }));

  const limit = pLimit(resolved.concurrency);
  const total = sameOrigin.length;
  let done = 0;
  resolved.onProgress?.({ done, total });

  const outcomes = await Promise.all(
    sameOrigin.map((link) =>
      limit(async () => {
        const outcome = await fetchPage(link, resolved);
        done += 1;
        resolved.onProgress?.({ done, total });
        return outcome;
      }),
    ),
  );

  const pages: FetchedPage[] = [];
  for (const outcome of outcomes) {
    if ('page' in outcome) pages.push(outcome.page);
    else skipped.push(outcome.skip);
  }
  return { pages, skipped };
}

/**
 * What an `add` would do, without doing it: the site's title and how many of its
 * pages are actually fetchable. Costs exactly one request.
 */
export async function previewSource(llmsTxtUrl: string, opts: FetchOptions = {}): Promise<SourcePreview> {
  const url = assertLlmsTxtUrl(llmsTxtUrl);
  const { doc, url: finalUrl } = await fetchLlmsTxt(url, opts);
  const links = flattenLinks(doc);
  const { sameOrigin, external } = partitionByOrigin(links, new URL(finalUrl).origin);
  return {
    llmsTxtUrl: url,
    title: doc.title || new URL(url).host,
    totalLinks: links.length,
    fetchableLinks: sameOrigin.length,
    skipped: external.map((link) => ({ url: link.url, reason: 'external-origin' as const })),
  };
}
