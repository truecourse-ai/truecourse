/**
 * Confluence Cloud as a context source: one space's current pages, one document
 * per page.
 *
 * The listing is `/wiki/rest/api/content` paged 100 at a time, EXPANDED with the
 * page's storage body, its version and its history — so a space is one request
 * per hundred pages rather than a listing plus a fetch each. Check asks for the
 * same listing without the bodies.
 *
 * A document is the page: YAML frontmatter (`created` / `updated` / `version`),
 * then `# <title>`, then the storage XHTML rendered to markdown. Its identity is
 * the page's numeric id, because a page can be renamed; its path is that id,
 * because a title is not a path.
 */

import { createHash } from 'node:crypto';
import type {
  ConfluenceSourceConfig,
  ContextSourceCheck,
  ContextSourceConfig,
} from '@truecourse/shared';
import {
  ContextConfigError,
  diffAgainstLedger,
  type ContextDriverDocument,
  type ContextDriverOptions,
  type ContextSourceDriver,
  type ContextSourceScope,
  type ContextSyncResult,
} from '@truecourse/core/services/context';
import { storageXhtmlToMarkdown } from './html-to-markdown.js';
import {
  atlassianSourceId,
  getJson,
  isoOrUndefined,
  type AtlassianCredentials,
} from './atlassian-http.js';
import type { AtlassianConnection } from './store.js';

/** Pages per listing request. */
const PAGE_LIMIT = 100;

/** How many titles a check hands back — enough to recognize the space. */
const CHECK_TITLE_SAMPLE = 10;

interface ConfluencePage {
  id: string | number;
  title?: string;
  version?: { number?: number; when?: string };
  /** Present only when the request asked for `expand=history`. */
  history?: { createdDate?: string };
  /** Present only when the request asked for `expand=space`. */
  space?: { key?: string; name?: string };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

interface ConfluenceList {
  results?: ConfluencePage[];
  _links?: { base?: string; next?: string };
}

export interface ConfluenceDriverDeps {
  /** The workspace's Confluence account, read afresh for every call. */
  connection: () => Promise<AtlassianConnection>;
  /** How a retry waits; a test pins it to nothing. */
  sleepMs?: (ms: number) => Promise<void>;
  /** The clock a page with no version stamp falls back to. */
  now?: () => Date;
}

/** A short, user-facing reason from a non-OK Confluence response. */
function describeError(status: number, statusText: string, body: string): string {
  // Atlassian's human `message`, with any leading Java exception class stripped
  // (e.g. "com.atlassian.…NotFoundException: No space with key : MFS").
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') {
      message = parsed.message.replace(/^[\w.$]+?(?:Exception|Error):\s*/i, '').trim();
    }
  } catch {
    /* non-JSON body */
  }
  if (status === 401) return 'Authentication failed — check the account email and API token.';
  if (status === 403) {
    return message || 'Access denied — this account may not have a Confluence license.';
  }
  if (status === 404) return message || 'Not found — check the space key.';
  return message ? `${statusText}: ${message}` : `Request failed (${status} ${statusText}).`;
}

/**
 * A page carries dates and an edit counter, and nothing else: it has no
 * lifecycle status, so there is no `resolved` and no history to keep.
 */
function frontmatter(page: ConfluencePage): string {
  const lines: string[] = [];
  const created = isoOrUndefined(page.history?.createdDate);
  const updated = isoOrUndefined(page.version?.when);
  if (created) lines.push(`created: ${created}`);
  if (updated) lines.push(`updated: ${updated}`);
  if (page.version?.number != null) lines.push(`version: ${page.version.number}`);
  return lines.length > 0 ? `---\n${lines.join('\n')}\n---` : '';
}

/** The scope of a Confluence source: the one space it reads. */
export function confluenceConfig(config: ContextSourceConfig): ConfluenceSourceConfig {
  const raw = (config ?? {}) as Partial<ConfluenceSourceConfig>;
  const spaceKey = typeof raw.spaceKey === 'string' ? raw.spaceKey.trim() : '';
  if (!spaceKey) throw new ContextConfigError('A Confluence source needs the space key it reads.');
  if (/\s/.test(spaceKey)) {
    throw new ContextConfigError('A Confluence space key is one word, e.g. ENG.');
  }
  return { spaceKey };
}

/**
 * The credentials probe behind Settings › Connections' Test: the same content
 * listing the sync's first page makes, asking for ONE page and no space — so it
 * proves the account, the token and the Confluence licence, which is everything
 * a sync needs of a connection.
 */
export async function probeConfluence(
  connection: AtlassianConnection,
  sleepMs?: (ms: number) => Promise<void>,
): Promise<void> {
  await getJson<unknown>({
    credentials: connection,
    url: `${connection.baseUrl}/wiki/rest/api/content?type=page&status=current&limit=1`,
    describe: describeError,
    ...(sleepMs ? { sleepMs } : {}),
  });
}

export function createConfluenceDriver(deps: ConfluenceDriverDeps): ContextSourceDriver {
  const now = deps.now ?? (() => new Date());

  function read<T>(
    connection: AtlassianCredentials,
    path: string,
    opts: ContextDriverOptions | undefined,
  ): Promise<T> {
    return getJson<T>({
      credentials: connection,
      url: `${connection.baseUrl}/wiki/rest/api${path}`,
      describe: describeError,
      ...(deps.sleepMs ? { sleepMs: deps.sleepMs } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  }

  /** Walk every page of the space's listing, handing each batch to `onPage`. */
  async function sweep(
    connection: AtlassianCredentials,
    spaceKey: string,
    expand: string,
    opts: ContextDriverOptions | undefined,
    onPage: (pages: ConfluencePage[], base: string) => void,
  ): Promise<void> {
    const space = encodeURIComponent(spaceKey);
    for (let start = 0; ; ) {
      opts?.signal?.throwIfAborted();
      const list = await read<ConfluenceList>(
        connection,
        `/content?spaceKey=${space}&type=page&status=current&expand=${encodeURIComponent(expand)}` +
          `&limit=${PAGE_LIMIT}&start=${start}`,
        opts,
      );
      const results = list.results ?? [];
      onPage(results, list._links?.base ?? connection.baseUrl);
      if (!list._links?.next || results.length === 0) break;
      start += results.length;
    }
  }

  /** The page's deep link: the one the API gives, else the one its key implies. */
  function pageUrl(connection: AtlassianCredentials, base: string, page: ConfluencePage, spaceKey: string): string {
    if (page._links?.webui) return `${base}${page._links.webui}`;
    return `${connection.baseUrl}/wiki/spaces/${spaceKey}/pages/${page.id}`;
  }

  function documentOf(
    page: ConfluencePage,
    connection: AtlassianCredentials,
    base: string,
    spaceKey: string,
    stamp: string,
  ): ContextDriverDocument {
    const title = page.title ?? `(untitled ${page.id})`;
    // The H1 anchors the slicer, so a heading-less page still has one.
    const body = [
      frontmatter(page),
      `# ${title}`,
      storageXhtmlToMarkdown(page.body?.storage?.value ?? ''),
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    return {
      // The numeric id, not the title: a renamed page is the same document.
      docId: String(page.id),
      docPath: `${page.id}.md`,
      title,
      url: pageUrl(connection, base, page, spaceKey),
      contentHash: createHash('sha256').update(body).digest('hex'),
      body,
      updatedAt: isoOrUndefined(page.version?.when) ?? stamp,
    };
  }

  return {
    kind: 'confluence',

    async scope(config): Promise<ContextSourceScope> {
      const scope = confluenceConfig(config);
      const { baseUrl } = await deps.connection();
      return {
        config: scope,
        sourceId: atlassianSourceId('confluence', baseUrl, scope.spaceKey),
        // The space's NAME is what the first listing reveals; until then the key
        // is what the workspace typed and what it will recognize.
        title: scope.spaceKey,
      };
    },

    async check(config, opts): Promise<ContextSourceCheck> {
      const scope = confluenceConfig(config);
      const connection = await deps.connection();
      const titles: string[] = [];
      let count = 0;
      let name = '';
      await sweep(connection, scope.spaceKey, 'space', opts, (pages) => {
        for (const page of pages) {
          count += 1;
          if (!name && page.space?.name) name = page.space.name;
          if (titles.length < CHECK_TITLE_SAMPLE) {
            titles.push(page.title ?? `(untitled ${page.id})`);
          }
        }
      });
      return { title: name || scope.spaceKey, count, titles, skipped: [] };
    },

    async sync(config, ledger, opts): Promise<ContextSyncResult> {
      const scope = confluenceConfig(config);
      const connection = await deps.connection();
      const stamp = now().toISOString();
      const documents: ContextDriverDocument[] = [];
      let name = '';
      await sweep(connection, scope.spaceKey, 'body.storage,version,history,space', opts, (pages, base) => {
        for (const page of pages) {
          if (!name && page.space?.name) name = page.space.name;
          documents.push(documentOf(page, connection, base, scope.spaceKey, stamp));
        }
        opts?.onProgress?.(documents.length, documents.length);
      });
      return {
        // A space renamed in Confluence renames its source here, exactly as a
        // site's llms.txt H1 does.
        title: name || scope.spaceKey,
        documents,
        ...diffAgainstLedger(documents, ledger),
        skipped: [],
      };
    },
  };
}
