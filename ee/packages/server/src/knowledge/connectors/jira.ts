/**
 * Jira Cloud connector. Lists a project's issues and fetches each issue's
 * summary + description (Atlassian Document Format), converting the description
 * to markdown. Uses the global `fetch` (Node 18+) with Basic auth
 * (`accountEmail:apiToken`). The connector only returns bodies; the sync engine
 * persists them (content-addressed) at Sync time.
 *
 * Enumeration uses the enhanced search endpoint (`/rest/api/3/search/jql`) with
 * `nextPageToken` pagination — the removed `startAt`/`/search` path is never
 * used. Issues are batch-fetched (`fetchMany`, one search call per 100 ids) so a
 * large project is a handful of requests rather than an N+1 sweep. The HTTP
 * helper retries 429 (and 503 with a `Retry-After`) so Jira's aggressive rate
 * limiting doesn't fail a sync.
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
import { adfToMarkdown } from './adf-to-markdown.js';

export interface JiraConfig extends ConnectorConfig {
  /** Site base, e.g. `https://your-site.atlassian.net`. */
  baseUrl: string;
  projectKey: string;
  accountEmail: string;
  apiToken: string;
  // `jql` is an optional filter — absent from the stored config when left blank,
  // so it rides the `ConnectorConfig` string index rather than a declared field.
}

/** One field change inside a changelog entry (we only read `status`). */
interface JiraChangelogItem {
  field?: string;
  fromString?: string | null;
  toString?: string | null;
}
/** One changelog entry — a timestamp plus the fields that changed with it. */
interface JiraChangelogEntry {
  created?: string;
  items?: JiraChangelogItem[];
}

interface JiraIssue {
  id: string | number;
  key?: string;
  fields?: {
    summary?: string;
    updated?: string;
    created?: string;
    /** Null when the closing transition set `status` without `resolution`. */
    resolutiondate?: string | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    /** Rich text as an ADF node tree (Jira Cloud v3). */
    description?: unknown;
  };
  /**
   * Present only when the request asked for `expand=changelog`. The enhanced
   * search endpoint returns it inline, so status history costs no extra call.
   * `total` may exceed `histories.length` on a long history — see the truncation
   * check at the read site.
   */
  changelog?: { total?: number; histories?: JiraChangelogEntry[] };
}
interface JiraSearchResult {
  issues?: JiraIssue[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextPageToken?: string;
}

/** Issues per search page / fetchMany batch. */
const PAGE_LIMIT = 100;
/**
 * The fields a body fetch needs: the document text plus the metadata the doc
 * header carries. `resolutiondate` is nullable even on a closed issue, so the
 * header derives its resolved date from the changelog when it is absent.
 */
const ISSUE_FIELDS = 'summary,description,created,updated,resolutiondate,status';
/** Retry a rate-limited request at most this many times before surfacing it. */
const RETRY_LIMIT = 3;

function siteBase(cfg: JiraConfig): string {
  return cfg.baseUrl.replace(/\/+$/, '');
}
function apiBase(cfg: JiraConfig): string {
  return `${siteBase(cfg)}/rest/api/3`;
}
function authHeader(cfg: JiraConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.accountEmail}:${cfg.apiToken}`).toString('base64');
}

/** A JQL string literal (double-quoted, backslashes + quotes escaped). */
function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The project-scoped base query, stably ordered for pagination. Blank `jql` ⇒
 * every issue type except sub-tasks (`standardIssueTypes()`); a set `jql` is
 * ANDed in parentheses so a stray `ORDER BY` in it is a loud parse error, not a
 * silent misparse.
 */
function baseJql(cfg: JiraConfig): string {
  const project = `project = ${jqlString(cfg.projectKey)}`;
  const filter = cfg.jql?.trim();
  const where = filter ? `${project} AND (${filter})` : `${project} AND issuetype in standardIssueTypes()`;
  return `${where} ORDER BY created ASC`;
}

/** A short, user-facing reason from a non-OK Jira response. */
function describeError(status: number, statusText: string, body: string): string {
  // Jira returns `{ errorMessages: string[], errors: {} }` (not Confluence's
  // `{ message }`). A bad project key or bad JQL surfaces as a 400 errorMessage
  // like "The value 'X' does not exist for the field 'project'".
  let messages: string[] = [];
  try {
    const parsed = JSON.parse(body) as { errorMessages?: unknown };
    if (Array.isArray(parsed.errorMessages)) {
      messages = parsed.errorMessages.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    }
  } catch {
    /* non-JSON body */
  }
  if (status === 401) return 'Authentication failed — check the account email and API token.';
  if (status === 403) return messages[0] || 'Access denied — this account may not have Jira access.';
  if (status === 400) return messages.join(' ') || `Request failed (${status} ${statusText}).`;
  return messages[0] ? `${statusText}: ${messages[0]}` : `Request failed (${status} ${statusText}).`;
}

/** Milliseconds to wait before a retry, honoring `Retry-After` (seconds). */
function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const secs = header != null ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 60) * 1000;
  // No usable header — a short exponential backoff instead.
  return Math.min(2 ** attempt, 30) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson<T>(cfg: JiraConfig, path: string): Promise<T> {
  const url = `${apiBase(cfg)}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
    });
    if (res.ok) return res.json() as Promise<T>;
    // Jira rate-limits aggressively; retry 429 (and 503 that carries a
    // Retry-After) a bounded number of times, honoring the header.
    const retryable = res.status === 429 || (res.status === 503 && res.headers.has('retry-after'));
    if (retryable && attempt < RETRY_LIMIT) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    // Clean, user-facing reason (never the raw JSON/path/JQL/token). The numeric
    // status rides on the error so the route can tag it for error tracking.
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* no body */
    }
    throw new UpstreamHttpError(describeError(res.status, res.statusText, body), res.status, res.statusText);
  }
}

/** One status transition, flattened out of the changelog. */
interface StatusChange {
  at: string;
  from: string;
  to: string;
}

/**
 * Normalize a Jira timestamp to real ISO-8601. Jira emits a `-0700` offset,
 * which `parseDocDate`'s value pattern tolerates but `Date` does not reliably
 * accept — so the header always carries a `Z` form the consolidator can parse.
 */
function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The status transitions in a changelog, oldest first. Other field changes are ignored. */
function statusChanges(entries: JiraChangelogEntry[]): StatusChange[] {
  const out: StatusChange[] = [];
  for (const entry of entries) {
    const at = isoOrUndefined(entry.created);
    if (!at) continue;
    for (const item of entry.items ?? []) {
      if (item.field !== 'status') continue;
      out.push({ at, from: item.fromString ?? '', to: item.toString ?? '' });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * The changelog a search response embedded, and whether it was cut short. The
 * enhanced search endpoint paginates the inline changelog, so an issue with a
 * long history arrives partial — and its EARLIEST transitions are the ones
 * missing, which is exactly the part the header needs.
 */
function inlineChangelog(issue: JiraIssue): { entries: JiraChangelogEntry[]; truncated: boolean } {
  const changelog = issue.changelog;
  const entries = changelog?.histories ?? [];
  // An issue the search never carried a changelog for has nothing to be short of.
  if (!changelog) return { entries, truncated: false };
  // `total` is what proves the inline copy is whole. Without it we cannot tell a
  // complete history from a clipped one, and the missing entries would be the
  // EARLIEST — the ones the resolved-date fallback reads. Unverified means
  // re-fetch: the call is bounded and only fires when Jira omits the count.
  return { entries, truncated: changelog.total === undefined || changelog.total > entries.length };
}

/** One page of the per-issue changelog endpoint (`values`, not `histories`). */
interface JiraChangelogPage {
  values?: JiraChangelogEntry[];
  isLast?: boolean;
  total?: number;
}

/** Every changelog entry for one issue. Only called when the inline copy was truncated. */
async function fetchChangelog(cfg: JiraConfig, id: string): Promise<JiraChangelogEntry[]> {
  const entries: JiraChangelogEntry[] = [];
  for (let startAt = 0; ; ) {
    const page = await getJson<JiraChangelogPage>(
      cfg,
      `/issue/${encodeURIComponent(id)}/changelog?startAt=${startAt}&maxResults=${PAGE_LIMIT}`,
    );
    const values = page.values ?? [];
    entries.push(...values);
    if (page.isLast || values.length === 0) break;
    startAt += values.length;
  }
  return entries;
}

/** An issue's status history, re-fetching the changelog only when the inline copy was short. */
async function resolveStatusChanges(cfg: JiraConfig, issue: JiraIssue): Promise<StatusChange[]> {
  const { entries, truncated } = inlineChangelog(issue);
  if (!truncated) return statusChanges(entries);
  return statusChanges(await fetchChangelog(cfg, String(issue.id)));
}

/**
 * When the issue settled. `resolutiondate` is authoritative but nullable — a
 * transition can set `status` without `resolution` — so an issue whose CURRENT
 * status is in the done category falls back to when it last entered that status.
 */
function resolvedAt(issue: JiraIssue, changes: StatusChange[]): string | undefined {
  const explicit = isoOrUndefined(issue.fields?.resolutiondate);
  if (explicit) return explicit;
  if (issue.fields?.status?.statusCategory?.key !== 'done') return undefined;
  const current = issue.fields?.status?.name;
  if (!current) return undefined;
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i].to === current) return changes[i].at;
  }
  return undefined;
}

/**
 * Transitions kept in the header. The block sits ahead of the description, and
 * the relevance classifier only reads the doc's first 60 lines — an uncapped
 * history on a long-lived issue fills that window with a transition list and the
 * issue reads as status tracking, so its requirements never reach extraction.
 * The most recent are kept: they carry where the issue settled.
 */
const HISTORY_LIMIT = 10;

/** YAML-quote a value that could otherwise parse as something else. */
function yamlValue(raw: string): string {
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The metadata the consolidator reads back out of the doc, as YAML frontmatter.
 *
 * Frontmatter rather than visible body text for two reasons: a reader opening
 * the doc wants the ticket, not our bookkeeping, and every markdown renderer
 * already hides it. The consolidator's readers are unaffected — they scan the
 * first 40 lines for `name: value`, which is exactly frontmatter's shape.
 *
 * Key names are the ones those readers know (`created`/`updated`/`resolved`/
 * `status`). `status_history` deliberately is not one of them, and its entries
 * open with a timestamp: an entry beginning with a date-field NAME would be read
 * as the doc's own date, and the first occurrence of a field wins.
 */
function frontmatter(issue: JiraIssue, changes: StatusChange[]): string {
  const lines: string[] = [];
  const created = isoOrUndefined(issue.fields?.created);
  const updated = isoOrUndefined(issue.fields?.updated);
  const resolved = resolvedAt(issue, changes);
  const status = issue.fields?.status?.name;
  if (created) lines.push(`created: ${created}`);
  if (updated) lines.push(`updated: ${updated}`);
  if (resolved) lines.push(`resolved: ${resolved}`);
  if (status) lines.push(`status: ${yamlValue(status)}`);
  if (lines.length === 0) return '';

  if (changes.length > 0) {
    lines.push('status_history:');
    const kept = changes.slice(-HISTORY_LIMIT);
    const dropped = changes.length - kept.length;
    // Say what was dropped rather than truncating silently — a short list would
    // otherwise read as the issue's whole history.
    if (dropped > 0) lines.push(`  - ${yamlValue(`… ${dropped} earlier transitions omitted`)}`);
    for (const c of kept) {
      lines.push(`  - ${yamlValue(`${c.at}  ${c.from || '(none)'} -> ${c.to}`)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---`;
}

/** Build one issue's document: frontmatter, the `# KEY: summary` H1, the description. */
function toDocContent(issue: JiraIssue, changes: StatusChange[] = []): DocContent {
  const key = issue.key ?? String(issue.id);
  const title = `${key}: ${issue.fields?.summary ?? ''}`;
  const body = adfToMarkdown(issue.fields?.description);
  // The H1 anchors the slicer, so a heading-less description still has one.
  return {
    title,
    markdown: [frontmatter(issue, changes), `# ${title}`, body].filter(Boolean).join('\n\n').trim(),
  };
}

/** `/search/jql` query string for a JQL sweep (paginates on nextPageToken). */
function searchPath(
  jql: string,
  fields: string,
  opts: { maxResults?: number; pageToken?: string; expand?: string } = {},
): string {
  const max = opts.maxResults ?? PAGE_LIMIT;
  const token = opts.pageToken ? `&nextPageToken=${encodeURIComponent(opts.pageToken)}` : '';
  const expand = opts.expand ? `&expand=${encodeURIComponent(opts.expand)}` : '';
  return `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=${fields}${token}${expand}`;
}

export const jiraConnector: KnowledgeConnector<JiraConfig> = {
  kind: 'jira',
  name: 'Jira',
  description: 'Sync a Jira Cloud project’s issues as workspace Knowledge.',
  fields: [
    { key: 'baseUrl', label: 'Site base URL', type: 'text', placeholder: 'https://your-site.atlassian.net' },
    { key: 'projectKey', label: 'Project key', type: 'text', placeholder: 'ENG' },
    { key: 'jql', label: 'JQL filter', type: 'text', placeholder: 'issuetype in standardIssueTypes()', optional: true },
    { key: 'accountEmail', label: 'Account email', type: 'email', placeholder: 'you@company.com' },
    { key: 'apiToken', label: 'API token', type: 'password', placeholder: 'Paste a Jira API token', secret: true },
  ],
  fetchBatchLimit: PAGE_LIMIT,

  async test(cfg) {
    // Probe with the SAME search the sync uses, limit 1, so a passing Test means
    // Sync will work. 401/403 = bad creds/scope; a bad project key surfaces as a 400.
    await getJson<unknown>(cfg, searchPath(baseJql(cfg), 'summary', { maxResults: 1 }));
  },

  async list(cfg) {
    const refs: DocRef[] = [];
    const base = siteBase(cfg);
    const jql = baseJql(cfg);
    let pageToken: string | undefined;
    for (;;) {
      const result = await getJson<JiraSearchResult>(
        cfg,
        searchPath(jql, 'summary,updated,created', { pageToken }),
      );
      const issues = result.issues ?? [];
      for (const issue of issues) {
        const key = issue.key ?? String(issue.id);
        // Jira has no version counter — `updated` bumps on every edit, so it
        // serves as both the version marker and the newest-wins timestamp.
        const updated = issue.fields?.updated;
        refs.push({
          id: String(issue.id),
          title: `${key}: ${issue.fields?.summary ?? ''}`,
          url: `${base}/browse/${key}`,
          version: updated,
          updatedAt: updated,
          createdAt: issue.fields?.created,
        });
      }
      // Stop when there's no next cursor (or, defensively, an empty page).
      if (!result.nextPageToken || issues.length === 0) break;
      pageToken = result.nextPageToken;
    }
    return refs;
  },

  async fetch(cfg, id): Promise<DocContent> {
    const issue = await getJson<JiraIssue>(
      cfg,
      `/issue/${encodeURIComponent(id)}?fields=${ISSUE_FIELDS}&expand=changelog`,
    );
    return toDocContent(issue, await resolveStatusChanges(cfg, issue));
  },

  async fetchMany(cfg, ids) {
    const out = new Map<string, DocContent>();
    if (ids.length === 0) return out;
    // One search usually resolves the whole chunk (the engine caps it at
    // fetchBatchLimit = maxResults), but the API may clamp a page BELOW
    // maxResults — follow the cursor, or the clamped-off issues would read as
    // deleted upstream and get their ledger rows (and derived claims) pruned.
    // An id genuinely missing from the results is simply absent.
    const jql = `id in (${ids.join(', ')}) ORDER BY created ASC`;
    let pageToken: string | undefined;
    for (;;) {
      const result = await getJson<JiraSearchResult>(
        cfg,
        searchPath(jql, ISSUE_FIELDS, { pageToken, expand: 'changelog' }),
      );
      const issues = result.issues ?? [];
      for (const issue of issues) {
        // Sequential on purpose: the await only does I/O for the rare issue whose
        // inline changelog was truncated; every other issue resolves in memory.
        out.set(String(issue.id), toDocContent(issue, await resolveStatusChanges(cfg, issue)));
      }
      if (!result.nextPageToken || issues.length === 0) break;
      pageToken = result.nextPageToken;
    }
    return out;
  },
};
