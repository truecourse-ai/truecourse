/**
 * Jira Cloud as a context source: one project's issues, one document per issue.
 *
 * Enumeration is the enhanced search endpoint (`/rest/api/3/search/jql`) with
 * `nextPageToken` pagination — the removed `startAt`/`/search` path is never
 * used — asking for 100 issues at a time WITH the fields and the changelog the
 * document needs, so a project is a handful of requests rather than an N+1
 * sweep. The rate limiting Atlassian is aggressive about is the shared HTTP
 * layer's business (`atlassian-http.ts`).
 *
 * A document is the issue: YAML frontmatter carrying what the consolidator
 * reads back (`created` / `updated` / `resolved` / `status` / `status_category`,
 * and the last transitions as `status_history`), then `# KEY: summary`, then the
 * description rendered from ADF. Its identity is the issue's immutable numeric
 * id, because a key can change when an issue moves project; its path is the KEY,
 * which is what a reader recognizes.
 *
 * The connection is looked up at CALL time, not held: a workspace can connect,
 * re-key or remove its Jira account while the server runs, and the next sync
 * simply reads what is there.
 */

import { createHash } from 'node:crypto';
import type {
  ContextSkip,
  ContextSourceCheck,
  ContextSourceConfig,
  JiraSourceConfig,
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
import { adfToMarkdown } from './adf-to-markdown.js';
import {
  atlassianSourceId,
  getJson,
  isoOrUndefined,
  yamlValue,
  type AtlassianCredentials,
} from './atlassian-http.js';
import type { AtlassianConnection } from './store.js';

/** Issues per search page. */
const PAGE_LIMIT = 100;

/** How many titles a check hands back — enough to recognize the project. */
const CHECK_TITLE_SAMPLE = 10;

/**
 * Transitions kept in the header. The block sits ahead of the description, and
 * the relevance classifier only reads the doc's first 60 lines — an uncapped
 * history on a long-lived issue fills that window with a transition list and the
 * issue reads as status tracking, so its requirements never reach extraction.
 * The most recent are kept: they carry where the issue settled.
 */
const HISTORY_LIMIT = 10;

/**
 * The fields a document needs: its text, plus the metadata the frontmatter
 * carries. `resolutiondate` is nullable even on a closed issue, so the resolved
 * date falls back to the changelog.
 */
const ISSUE_FIELDS = 'summary,description,created,updated,resolutiondate,status';

/** One field change inside a changelog entry (only `status` is read). */
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
   * `total` may exceed `histories.length` on a long history — see
   * {@link inlineChangelog}.
   */
  changelog?: { total?: number; histories?: JiraChangelogEntry[] };
}

interface JiraSearchResult {
  issues?: JiraIssue[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextPageToken?: string;
}

/** One page of the per-issue changelog endpoint (`values`, not `histories`). */
interface JiraChangelogPage {
  values?: JiraChangelogEntry[];
  isLast?: boolean;
  total?: number;
}

/** One status transition, flattened out of the changelog. */
interface StatusChange {
  at: string;
  from: string;
  to: string;
}

export interface JiraDriverDeps {
  /** The workspace's Jira account, read afresh for every call. */
  connection: () => Promise<AtlassianConnection>;
  /** How a retry waits; a test pins it to nothing. */
  sleepMs?: (ms: number) => Promise<void>;
  /** The clock a document with no `updated` falls back to. */
  now?: () => Date;
}

/** A JQL string literal (double-quoted, backslashes + quotes escaped). */
function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The project-scoped query, stably ordered for pagination. A blank filter means
 * every issue type except sub-tasks (`standardIssueTypes()`); a set one is ANDed
 * in parentheses, so a stray `ORDER BY` inside it is a loud parse error rather
 * than a silent misparse.
 */
function baseJql(config: JiraSourceConfig): string {
  const project = `project = ${jqlString(config.projectKey)}`;
  const filter = config.jql?.trim();
  const where = filter
    ? `${project} AND (${filter})`
    : `${project} AND issuetype in standardIssueTypes()`;
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
      messages = parsed.errorMessages.filter(
        (message): message is string => typeof message === 'string' && message.trim() !== '',
      );
    }
  } catch {
    /* non-JSON body */
  }
  if (status === 401) return 'Authentication failed — check the account email and API token.';
  if (status === 403) return messages[0] || 'Access denied — this account may not have Jira access.';
  if (status === 400) return messages.join(' ') || `Request failed (${status} ${statusText}).`;
  return messages[0] ? `${statusText}: ${messages[0]}` : `Request failed (${status} ${statusText}).`;
}

/** The status transitions in a changelog, oldest first. Other changes are ignored. */
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
  // `total` is what proves the inline copy is whole. Without it a complete
  // history cannot be told from a clipped one, and the missing entries would be
  // the EARLIEST — the ones the resolved-date fallback reads. Unverified means
  // re-fetch: the call is bounded and only fires when Jira omits the count.
  return { entries, truncated: changelog.total === undefined || changelog.total > entries.length };
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
    if (changes[i]!.to === current) return changes[i]!.at;
  }
  return undefined;
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
  // The bucket Jira files that name under. Stated beside the name, not instead
  // of it: the reader prefers the name and falls back here, which is what keeps
  // a workflow state we have never seen from classifying as nothing.
  const statusCategory = issue.fields?.status?.statusCategory?.key;
  if (created) lines.push(`created: ${created}`);
  if (updated) lines.push(`updated: ${updated}`);
  if (resolved) lines.push(`resolved: ${resolved}`);
  if (status) lines.push(`status: ${yamlValue(status)}`);
  if (statusCategory) lines.push(`status_category: ${yamlValue(statusCategory)}`);
  if (lines.length === 0) return '';

  if (changes.length > 0) {
    lines.push('status_history:');
    const kept = changes.slice(-HISTORY_LIMIT);
    const dropped = changes.length - kept.length;
    // Say what was dropped rather than truncating silently — a short list would
    // otherwise read as the issue's whole history.
    if (dropped > 0) lines.push(`  - ${yamlValue(`… ${dropped} earlier transitions omitted`)}`);
    for (const change of kept) {
      lines.push(`  - ${yamlValue(`${change.at}  ${change.from || '(none)'} -> ${change.to}`)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---`;
}

/** The scope of a Jira source: the project, and the filter within it. */
export function jiraConfig(config: ContextSourceConfig): JiraSourceConfig {
  const raw = (config ?? {}) as Partial<JiraSourceConfig>;
  // Jira project keys are uppercase, so one is stored as the project wears it —
  // which also keeps two spellings of one project from becoming two sources.
  const projectKey = (typeof raw.projectKey === 'string' ? raw.projectKey.trim() : '').toUpperCase();
  if (!projectKey) throw new ContextConfigError('A Jira source needs the project key it reads.');
  if (/\s/.test(projectKey)) {
    throw new ContextConfigError('A Jira project key is one word, e.g. ENG.');
  }
  const jql = typeof raw.jql === 'string' ? raw.jql.trim() : '';
  return { projectKey, ...(jql ? { jql } : {}) };
}

/**
 * The credentials probe behind Settings › Connections' Test: the same search
 * the sync's first page makes, asking for ONE issue and no project scope — so
 * it proves the account, the token and Jira access, which is everything a sync
 * needs of a connection. A refusal is the driver's own user-facing reason.
 */
export async function probeJira(
  connection: AtlassianConnection,
  sleepMs?: (ms: number) => Promise<void>,
): Promise<void> {
  const jql = encodeURIComponent('ORDER BY created ASC');
  await getJson<unknown>({
    credentials: connection,
    url: `${connection.baseUrl}/rest/api/3/search/jql?jql=${jql}&maxResults=1&fields=summary`,
    describe: describeError,
    ...(sleepMs ? { sleepMs } : {}),
  });
}

export function createJiraDriver(deps: JiraDriverDeps): ContextSourceDriver {
  const now = deps.now ?? (() => new Date());

  function read<T>(
    connection: AtlassianCredentials,
    path: string,
    opts: ContextDriverOptions | undefined,
  ): Promise<T> {
    return getJson<T>({
      credentials: connection,
      url: `${connection.baseUrl}/rest/api/3${path}`,
      describe: describeError,
      ...(deps.sleepMs ? { sleepMs: deps.sleepMs } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  }

  /** `/search/jql` query string for one page of a JQL sweep. */
  function searchPath(
    jql: string,
    fields: string,
    opts: { pageToken?: string; expand?: string } = {},
  ): string {
    const token = opts.pageToken ? `&nextPageToken=${encodeURIComponent(opts.pageToken)}` : '';
    const expand = opts.expand ? `&expand=${encodeURIComponent(opts.expand)}` : '';
    return `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE_LIMIT}&fields=${fields}${token}${expand}`;
  }

  /** Every changelog entry for one issue. Only called when the inline copy was short. */
  async function fetchChangelog(
    connection: AtlassianCredentials,
    id: string,
    opts: ContextDriverOptions | undefined,
  ): Promise<JiraChangelogEntry[]> {
    const entries: JiraChangelogEntry[] = [];
    for (let startAt = 0; ; ) {
      const page = await read<JiraChangelogPage>(
        connection,
        `/issue/${encodeURIComponent(id)}/changelog?startAt=${startAt}&maxResults=${PAGE_LIMIT}`,
        opts,
      );
      const values = page.values ?? [];
      entries.push(...values);
      if (page.isLast || values.length === 0) break;
      startAt += values.length;
    }
    return entries;
  }

  /** An issue's status history, re-fetching only when the inline copy was short. */
  async function resolveStatusChanges(
    connection: AtlassianCredentials,
    issue: JiraIssue,
    opts: ContextDriverOptions | undefined,
  ): Promise<StatusChange[]> {
    const { entries, truncated } = inlineChangelog(issue);
    if (!truncated) return statusChanges(entries);
    return statusChanges(await fetchChangelog(connection, String(issue.id), opts));
  }

  /** Walk every page of a JQL sweep, handing each page to `onPage`. */
  async function sweep(
    connection: AtlassianCredentials,
    jql: string,
    fields: string,
    expand: string | undefined,
    opts: ContextDriverOptions | undefined,
    onPage: (issues: JiraIssue[]) => Promise<void>,
  ): Promise<void> {
    let pageToken: string | undefined;
    for (;;) {
      opts?.signal?.throwIfAborted();
      const result = await read<JiraSearchResult>(
        connection,
        searchPath(jql, fields, {
          ...(pageToken ? { pageToken } : {}),
          ...(expand ? { expand } : {}),
        }),
        opts,
      );
      const issues = result.issues ?? [];
      await onPage(issues);
      // Stop when there is no next cursor (or, defensively, an empty page).
      if (!result.nextPageToken || issues.length === 0) break;
      pageToken = result.nextPageToken;
    }
  }

  /** One issue's document: frontmatter, the `# KEY: summary` H1, the description. */
  function documentOf(
    issue: JiraIssue,
    changes: StatusChange[],
    baseUrl: string,
    stamp: string,
  ): ContextDriverDocument {
    const key = issue.key ?? String(issue.id);
    const title = `${key}: ${issue.fields?.summary ?? ''}`;
    // The H1 anchors the slicer, so a heading-less description still has one.
    const body = [frontmatter(issue, changes), `# ${title}`, adfToMarkdown(issue.fields?.description)]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    return {
      // The numeric id, not the key: an issue moved to another project keeps
      // its id and takes a new key, and a document must not read as deleted.
      docId: String(issue.id),
      docPath: `${key}.md`,
      title,
      url: `${baseUrl}/browse/${key}`,
      contentHash: createHash('sha256').update(body).digest('hex'),
      body,
      updatedAt: isoOrUndefined(issue.fields?.updated) ?? stamp,
    };
  }

  return {
    kind: 'jira',

    async scope(config): Promise<ContextSourceScope> {
      const scope = jiraConfig(config);
      const { baseUrl } = await deps.connection();
      return {
        config: scope,
        sourceId: atlassianSourceId('jira', baseUrl, scope.projectKey),
        title: `${scope.projectKey} (Jira)`,
      };
    },

    async check(config, opts): Promise<ContextSourceCheck> {
      const scope = jiraConfig(config);
      const connection = await deps.connection();
      const titles: string[] = [];
      let count = 0;
      // The same sweep the sync makes, without the bodies: what it counts is
      // exactly what an add would store.
      await sweep(connection, baseJql(scope), 'summary', undefined, opts, async (issues) => {
        for (const issue of issues) {
          count += 1;
          if (titles.length < CHECK_TITLE_SAMPLE) {
            titles.push(`${issue.key ?? String(issue.id)}: ${issue.fields?.summary ?? ''}`);
          }
        }
      });
      const skipped: ContextSkip[] = [];
      return { title: `${scope.projectKey} (Jira)`, count, titles, skipped };
    },

    async sync(config, ledger, opts): Promise<ContextSyncResult> {
      const scope = jiraConfig(config);
      const connection = await deps.connection();
      const stamp = now().toISOString();
      const documents: ContextDriverDocument[] = [];
      await sweep(
        connection,
        baseJql(scope),
        ISSUE_FIELDS,
        'changelog',
        opts,
        async (issues) => {
          for (const issue of issues) {
            // Sequential on purpose: the await only does I/O for the rare issue
            // whose inline changelog was truncated; every other issue resolves
            // in memory.
            const changes = await resolveStatusChanges(connection, issue, opts);
            documents.push(documentOf(issue, changes, connection.baseUrl, stamp));
          }
          opts?.onProgress?.(documents.length, documents.length);
        },
      );
      return {
        title: `${scope.projectKey} (Jira)`,
        documents,
        ...diffAgainstLedger(documents, ledger),
        skipped: [],
      };
    },
  };
}
