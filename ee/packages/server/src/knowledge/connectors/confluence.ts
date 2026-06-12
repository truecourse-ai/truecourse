/**
 * Confluence Cloud connector. Lists the pages of a space and fetches each
 * page's storage-format body, converting it to markdown. Uses the global
 * `fetch` (Node 18+) with Basic auth (`accountEmail:apiToken`). Bodies are
 * returned transiently — never stored.
 *
 * Its config keys ARE the UI field keys, so the settings form is fully generic.
 */

import {
  UpstreamHttpError,
  type ConnectorConfig,
  type DocContent,
  type DocRef,
  type KnowledgeConnector,
} from './types.js';
import { storageXhtmlToMarkdown } from './html-to-markdown.js';

export interface ConfluenceConfig extends ConnectorConfig {
  /** Site base, e.g. `https://your-site.atlassian.net`. */
  baseUrl: string;
  spaceKey: string;
  accountEmail: string;
  apiToken: string;
}

interface ConfluencePage {
  id: string | number;
  title?: string;
  version?: { number?: number; when?: string };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}
interface ConfluenceList {
  results?: ConfluencePage[];
  _links?: { base?: string; next?: string };
}

const PAGE_LIMIT = 100;

function siteBase(cfg: ConfluenceConfig): string {
  return cfg.baseUrl.replace(/\/+$/, '');
}
function apiBase(cfg: ConfluenceConfig): string {
  return `${siteBase(cfg)}/wiki/rest/api`;
}
function authHeader(cfg: ConfluenceConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.accountEmail}:${cfg.apiToken}`).toString('base64');
}

/** A short, user-facing reason from a non-OK Confluence response. */
function describeError(status: number, statusText: string, body: string): string {
  // Pull Atlassian's human `message`, stripping any leading Java exception class
  // (e.g. "com.atlassian.…NotFoundException: No space with key : MFS").
  let msg = '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') {
      msg = parsed.message.replace(/^[\w.$]+?(?:Exception|Error):\s*/i, '').trim();
    }
  } catch {
    /* non-JSON body */
  }
  if (status === 401) return 'Authentication failed — check the account email and API token.';
  if (status === 403) return msg || 'Access denied — this account may not have a Confluence license.';
  if (status === 404) return msg || 'Not found — check the space key.';
  return msg ? `${statusText}: ${msg}` : `Request failed (${status} ${statusText}).`;
}

async function getJson<T>(cfg: ConfluenceConfig, path: string): Promise<T> {
  const res = await fetch(`${apiBase(cfg)}${path}`, {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
  });
  if (!res.ok) {
    // Clean, user-facing reason (never the raw JSON/path/token). The numeric
    // status rides on the error so the route can tag it for error tracking.
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* no body */
    }
    throw new UpstreamHttpError(describeError(res.status, res.statusText, body), res.status, res.statusText);
  }
  return res.json() as Promise<T>;
}

function pageUrl(cfg: ConfluenceConfig, base: string, p: ConfluencePage): string {
  if (p._links?.webui) return `${base}${p._links.webui}`;
  return `${siteBase(cfg)}/wiki/spaces/${cfg.spaceKey}/pages/${p.id}`;
}

export const confluenceConnector: KnowledgeConnector<ConfluenceConfig> = {
  kind: 'confluence',
  name: 'Confluence',
  description: 'Sync a Confluence Cloud space as workspace Knowledge.',
  fields: [
    { key: 'baseUrl', label: 'Site base URL', type: 'text', placeholder: 'https://your-site.atlassian.net' },
    { key: 'spaceKey', label: 'Space key', type: 'text', placeholder: 'ENG' },
    { key: 'accountEmail', label: 'Account email', type: 'email', placeholder: 'you@company.com' },
    { key: 'apiToken', label: 'API token', type: 'password', placeholder: 'Paste a Confluence API token', secret: true },
  ],

  async test(cfg) {
    // Probe with the SAME read the sync uses (list content in the space), so a
    // passing Test means Sync will work. 401/403 = bad creds/scope, 404 = wrong
    // space. Limit 1 keeps it cheap.
    const space = encodeURIComponent(cfg.spaceKey);
    await getJson<unknown>(cfg, `/content?spaceKey=${space}&type=page&status=current&limit=1`);
  },

  async list(cfg) {
    const refs: DocRef[] = [];
    let start = 0;
    for (;;) {
      const space = encodeURIComponent(cfg.spaceKey);
      const list = await getJson<ConfluenceList>(
        cfg,
        `/content?spaceKey=${space}&type=page&status=current&expand=version&limit=${PAGE_LIMIT}&start=${start}`,
      );
      const results = list.results ?? [];
      const base = list._links?.base ?? siteBase(cfg);
      for (const p of results) {
        refs.push({
          id: String(p.id),
          title: p.title ?? `(untitled ${p.id})`,
          url: pageUrl(cfg, base, p),
          version: p.version?.number != null ? String(p.version.number) : undefined,
          updatedAt: p.version?.when ?? '1970-01-01T00:00:00.000Z',
        });
      }
      if (!list._links?.next || results.length === 0) break;
      start += PAGE_LIMIT;
    }
    return refs;
  },

  async fetch(cfg, id): Promise<DocContent> {
    const page = await getJson<ConfluencePage>(
      cfg,
      `/content/${encodeURIComponent(id)}?expand=body.storage,version`,
    );
    const title = page.title ?? `(untitled ${id})`;
    const body = storageXhtmlToMarkdown(page.body?.storage?.value ?? '');
    // Prepend the title as an H1 so a heading-less page still has a slice anchor.
    return { title, markdown: `# ${title}\n\n${body}`.trim() };
  },
};
