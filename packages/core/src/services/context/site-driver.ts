/**
 * The `site` driver — an llms.txt documentation site as a workspace source.
 *
 * The engine is the one that already exists (`@truecourse/spec-consolidator`'s
 * `sources/`): `assertLlmsTxtUrl` + `fetchLlmsTxt` read and parse the index,
 * `partitionByOrigin` keeps the site to its own origin, `fetchPages` resolves
 * every link to markdown (the `.md` / `.mdx` twin probe, the retries, the
 * public-only network guard), `mapUrlsToPaths` assigns stable snapshot paths
 * and `hashContent` is the diff key. None of that is re-implemented here.
 *
 * What is NOT here is the per-repository half: no `sources.json` registry, no
 * files written under `.truecourse/specs/sources/`, no repo root at all. A
 * workspace source's pages come back to the caller with their bodies and are
 * stored content-addressed under the workspace; `sources/store.ts` stays for
 * the CLI, which still owns a tree.
 */

import {
  fetchLlmsTxt,
  fetchPages,
  flattenLinks,
  hashContent,
  mapUrlsToPaths,
  partitionByOrigin,
  type LlmsTxtLink,
} from '@truecourse/spec-consolidator';
import type { ContextSkip, ContextSourceCheck, ContextSourceConfig } from '@truecourse/shared';
import { siteConfig } from './config.js';
import { diffAgainstLedger } from './diff.js';
import type {
  ContextDriverDocument,
  ContextDriverOptions,
  ContextSourceDriver,
  ContextSyncResult,
} from './types.js';

/** How many titles a check hands back — enough to recognize the site, not a listing. */
const CHECK_TITLE_SAMPLE = 10;

export interface SiteDriverDeps {
  /**
   * Refuse non-public destinations (and every redirect to one). True on a
   * hosted server, which must never be talked into fetching its own network.
   */
  publicOnly?: boolean;
  /** The clock, so a test can pin the stamp a fetched page takes. */
  now?: () => Date;
}

/** The title an llms.txt link carries, falling back to its last path segment. */
function linkTitle(link: LlmsTxtLink): string {
  if (link.title) return link.title;
  const segments = new URL(link.url).pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? link.url;
}

interface SiteIndex {
  title: string;
  origin: string;
  links: LlmsTxtLink[];
  skipped: ContextSkip[];
}

export function createSiteDriver(deps: SiteDriverDeps = {}): ContextSourceDriver {
  const publicOnly = deps.publicOnly ?? false;
  const now = deps.now ?? (() => new Date());

  /** Read + parse the llms.txt, and split its links by origin. One request. */
  async function readIndex(
    config: ContextSourceConfig,
    opts: ContextDriverOptions | undefined,
  ): Promise<SiteIndex> {
    const { llmsTxtUrl } = siteConfig(config);
    opts?.signal?.throwIfAborted();
    // Redirects (http→https, apex→www) move the origin the same-origin filter
    // must resolve against, so the FINAL url is the base.
    const { doc, url: finalUrl } = await fetchLlmsTxt(llmsTxtUrl, { publicOnly });
    const origin = new URL(finalUrl).origin;
    const { sameOrigin, external } = partitionByOrigin(flattenLinks(doc), origin);
    return {
      title: doc.title || new URL(finalUrl).host,
      origin,
      links: sameOrigin,
      skipped: external.map((link) => ({ ref: link.url, reason: 'external-origin' })),
    };
  }

  return {
    kind: 'site',

    async check(config, opts): Promise<ContextSourceCheck> {
      const index = await readIndex(config, opts);
      return {
        title: index.title,
        count: index.links.length,
        titles: index.links.slice(0, CHECK_TITLE_SAMPLE).map(linkTitle),
        skipped: index.skipped,
      };
    },

    async sync(config, ledger, opts): Promise<ContextSyncResult> {
      const index = await readIndex(config, opts);
      opts?.signal?.throwIfAborted();
      const fetched = await fetchPages(index.links, index.origin, {
        publicOnly,
        onProgress: ({ done, total }) => opts?.onProgress?.(done, total),
      });
      opts?.signal?.throwIfAborted();

      // A page that did not change must keep its snapshot path: the scan's
      // per-doc caches key on `path :: contentHash`, so a doc must not move
      // because a neighbour was added or removed.
      const priorPaths = new Map(ledger.map((entry) => [entry.docId, entry.docPath]));
      const paths = mapUrlsToPaths(
        fetched.pages.map((page) => page.url),
        priorPaths,
      );
      const stamp = now().toISOString();
      const documents: ContextDriverDocument[] = fetched.pages.map((page) => ({
        docId: page.url,
        docPath: paths.get(page.url)!,
        title: page.title,
        url: page.url,
        contentHash: hashContent(page.content),
        body: page.content,
        updatedAt: stamp,
      }));

      return {
        title: index.title,
        documents,
        ...diffAgainstLedger(documents, ledger),
        skipped: [
          ...index.skipped,
          ...fetched.skipped.map((skip) => ({
            ref: skip.url,
            reason: skip.reason,
            ...(skip.detail ? { detail: skip.detail } : {}),
          })),
        ],
      };
    },
  };
}
