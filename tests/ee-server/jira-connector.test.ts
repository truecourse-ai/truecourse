import { describe, it, expect, afterEach, vi } from 'vitest';
import { adfToMarkdown } from '../../ee/packages/server/src/knowledge/connectors/adf-to-markdown';
import { jiraConnector, type JiraConfig } from '../../ee/packages/server/src/knowledge/connectors/jira';
import { UpstreamHttpError } from '../../ee/packages/server/src/knowledge/connectors/types';

/** Wrap block nodes in a realistic ADF `doc` envelope (version/type as Jira emits). */
function doc(...content: unknown[]) {
  return { version: 1, type: 'doc', content };
}

describe('adfToMarkdown', () => {
  it('demotes headings by one level and preserves the H6 floor', () => {
    const md = adfToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Overview' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Endpoints' }] },
        { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Edge cases' }] },
      ),
    );
    // The issue title owns the doc's H1, so an in-description H1 demotes to H2.
    expect(md).toContain('## Overview');
    expect(md).toContain('### Endpoints');
    // H6 has nowhere to go — it stays H6.
    expect(md).toContain('###### Edge cases');
    // No line is a level-1 heading — the H1 anchor is owned by the issue title.
    expect(md.split('\n').some((l) => /^# [^#]/.test(l))).toBe(false);
  });

  it('renders bullet/task/decision lists as - / - [ ] / - [x] items', () => {
    const md = adfToMarkdown(
      doc(
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'POST /orders' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'GET /orders' }] }] },
          ],
        },
        {
          type: 'taskList',
          attrs: { localId: 'task-list-1' },
          content: [
            { type: 'taskItem', attrs: { localId: 't1', state: 'TODO' }, content: [{ type: 'text', text: 'Validate email' }] },
            { type: 'taskItem', attrs: { localId: 't2', state: 'DONE' }, content: [{ type: 'text', text: 'Reject duplicates' }] },
          ],
        },
        {
          type: 'decisionList',
          attrs: { localId: 'decision-list-1' },
          content: [
            { type: 'decisionItem', attrs: { localId: 'd1', state: 'DECIDED' }, content: [{ type: 'text', text: 'Use Postgres' }] },
          ],
        },
      ),
    );
    expect(md).toContain('- POST /orders');
    expect(md).toContain('- GET /orders');
    expect(md).toContain('- [ ] Validate email');
    expect(md).toContain('- [x] Reject duplicates');
    expect(md).toContain('- Use Postgres');
  });

  it('flattens nested lists to sibling - items', () => {
    const md = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Fruit' }] },
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Apple' }] }] },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(md).toBe('- Fruit\n- Apple');
  });

  it('renders strong/em/code/link marks and leaves other marks plain', () => {
    const md = adfToMarkdown(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Must be ' },
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'inline', marks: [{ type: 'code' }] },
          { type: 'text', text: ', a ' },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://acme.test/spec' } }] },
          { type: 'text', text: '. Also ' },
          { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] },
          { type: 'text', text: '.' },
        ],
      }),
    );
    expect(md).toContain('**bold**');
    expect(md).toContain('_italic_');
    expect(md).toContain('`inline`');
    expect(md).toContain('[link](https://acme.test/spec)');
    // Unsupported mark (underline) → plain text, no markup.
    expect(md).toContain('underlined');
    expect(md).not.toContain('_underlined_');
    expect(md).not.toContain('**underlined**');
  });

  it('renders fenced code blocks with the language', () => {
    const md = adfToMarkdown(
      doc({
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [{ type: 'text', text: '{\n  "status": "open"\n}' }],
      }),
    );
    expect(md).toContain('```json');
    expect(md).toContain('"status": "open"');
    expect(md.match(/```/g)?.length).toBe(2); // opening + closing fence
  });

  it('renders tables as one line per row with " | " cells', () => {
    const md = adfToMarkdown(
      doc({
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Field' }] }] },
              { type: 'tableHeader', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Required' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'email' }] }] },
              { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'yes' }] }] },
            ],
          },
        ],
      }),
    );
    expect(md).toContain('Field | Required');
    expect(md).toContain('email | yes');
    expect(md).not.toContain('---'); // no header separator row
  });

  it('renders inline atoms from attrs, never locale-rendered', () => {
    const ts = Date.UTC(2026, 0, 15); // 2026-01-15T00:00:00Z
    const md = adfToMarkdown(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Owner ' },
          { type: 'mention', attrs: { id: '557058:abc', text: '@Jane Doe', accessLevel: '' } },
          { type: 'text', text: ' set status ' },
          { type: 'status', attrs: { text: 'In Progress', color: 'yellow', localId: 's1' } },
          { type: 'text', text: ' by ' },
          { type: 'date', attrs: { timestamp: String(ts) } },
          { type: 'text', text: ' ' },
          { type: 'emoji', attrs: { shortName: ':white_check_mark:', id: '2705', text: '✅' } },
          { type: 'text', text: ' see ' },
          { type: 'inlineCard', attrs: { url: 'https://acme.test/rfc-1' } },
        ],
      }),
    );
    expect(md).toContain('@Jane Doe'); // single @, not @@
    expect(md).not.toContain('@@');
    expect(md).toContain('In Progress');
    expect(md).toContain('2026-01-15');
    expect(md).toContain(':white_check_mark:');
    expect(md).toContain('https://acme.test/rfc-1');
  });

  it('keeps wrapper content but drops the wrapper (panel/expand), and drops media', () => {
    const md = adfToMarkdown(
      doc(
        { type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Idempotent by design.' }] }] },
        { type: 'expand', attrs: { title: 'Error cases' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '404 when the order is missing.' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rate limited to 100 rps.' }] }] },
        { type: 'rule' },
        { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: { id: 'x', type: 'file', collection: 'c' } }] },
      ),
    );
    expect(md).toContain('Idempotent by design.');
    expect(md).toContain('**Error cases**');
    expect(md).toContain('404 when the order is missing.');
    expect(md).toContain('> Rate limited to 100 rps.');
    expect(md).toContain('---');
    // Media is dropped from the text-only corpus — no attachment id leaks.
    expect(md).not.toContain('mediaSingle');
    expect(md).not.toContain('collection');
  });

  it('recurses into unknown node types without throwing, keeping inner text', () => {
    const md = adfToMarkdown(
      doc(
        {
          type: 'someFutureBlock',
          attrs: { foo: 'bar' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'still visible' }] }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before ' },
            { type: 'someFutureInline', content: [{ type: 'text', text: 'kept' }] },
            { type: 'text', text: ' after' },
          ],
        },
      ),
    );
    expect(md).toContain('still visible');
    expect(md).toContain('before kept after');
    expect(md).not.toContain('someFutureBlock');
  });

  it('is deterministic (same ADF → byte-identical markdown — cache stability)', () => {
    const adf = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Given a valid ', marks: [] }, { type: 'text', text: 'order', marks: [{ type: 'strong' }] }] }] },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'http' }, content: [{ type: 'text', text: 'POST /orders' }] },
    );
    const first = adfToMarkdown(adf);
    expect(adfToMarkdown(adf)).toBe(first);
    // Structurally identical clone → identical output (no key-order dependence).
    expect(adfToMarkdown(JSON.parse(JSON.stringify(adf)))).toBe(first);
  });

  it('returns an empty string for empty, absent, or malformed input', () => {
    expect(adfToMarkdown({ version: 1, type: 'doc', content: [] })).toBe('');
    expect(adfToMarkdown({ version: 1, type: 'doc' })).toBe(''); // missing content
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown(undefined)).toBe('');
    expect(adfToMarkdown('not adf')).toBe('');
    expect(adfToMarkdown(42)).toBe('');
    expect(adfToMarkdown([])).toBe('');
  });
});

const CFG: JiraConfig = {
  baseUrl: 'https://acme.atlassian.net',
  projectKey: 'ENG',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

/** A realistic Jira ADF description (headings, a list, a table). */
function description(): unknown {
  return {
    version: 1,
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Endpoints' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'POST /orders' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'GET /orders' }] }] },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Idempotent', marks: [{ type: 'strong' }] }, { type: 'text', text: ' by design.' }],
      },
    ],
  };
}

describe('jiraConnector', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stub(routes: (url: string) => { status?: number; body: unknown; headers?: Record<string, string> }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const { status = 200, body, headers } = routes(String(input));
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json', ...headers },
        });
      }),
    );
  }

  /** Decode the `jql` query param of the Nth captured fetch call. */
  function jqlOf(callIndex = 0): string {
    const url = String(vi.mocked(fetch).mock.calls[callIndex][0]);
    const m = /[?&]jql=([^&]*)/.exec(url);
    return m ? decodeURIComponent(m[1]) : '';
  }

  it('list() paginates on nextPageToken and maps DocRefs (numeric id, KEY: summary, /browse/ url)', async () => {
    stub((url) => {
      if (url.includes('nextPageToken=')) {
        // Second (last) page — no cursor back.
        return {
          body: {
            issues: [{ id: '10002', key: 'ENG-102', fields: { summary: 'Refunds', updated: '2026-02-02T12:00:00.000-0800' } }],
          },
        };
      }
      return {
        body: {
          issues: [{ id: '10001', key: 'ENG-101', fields: { summary: 'Orders API', updated: '2026-01-01T09:30:00.000-0800' } }],
          nextPageToken: 'CURSOR-2',
        },
      };
    });

    const refs = await jiraConnector.list(CFG);
    expect(refs.map((r) => r.id)).toEqual(['10001', '10002']); // immutable numeric ids
    expect(refs[0]).toMatchObject({
      title: 'ENG-101: Orders API',
      version: '2026-01-01T09:30:00.000-0800', // `updated` is both version…
      updatedAt: '2026-01-01T09:30:00.000-0800', // …and the newest-wins timestamp
    });
    expect(refs[0].url).toBe('https://acme.atlassian.net/browse/ENG-101');
    expect(fetch).toHaveBeenCalledTimes(2); // stopped when nextPageToken was absent
    // The enhanced search endpoint is used — never the removed `/search` + startAt.
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/rest/api/3/search/jql');
  });

  it('default base JQL scopes the project and excludes sub-tasks via standardIssueTypes()', async () => {
    stub(() => ({ body: { issues: [] } }));
    await jiraConnector.list(CFG);
    expect(jqlOf()).toBe('project = "ENG" AND issuetype in standardIssueTypes() ORDER BY created ASC');
  });

  it('ANDs the optional jql filter in parentheses, dropping the default type clause', async () => {
    stub(() => ({ body: { issues: [] } }));
    await jiraConnector.list({ ...CFG, jql: 'labels = spec' });
    expect(jqlOf()).toBe('project = "ENG" AND (labels = spec) ORDER BY created ASC');
    expect(jqlOf()).not.toContain('standardIssueTypes');
  });

  it('fetchMany() resolves a chunk in one search, keyed by id; a missing id is simply absent', async () => {
    stub(() => ({
      body: {
        // Only two of the three requested issues come back (10003 was deleted upstream).
        issues: [
          { id: '10001', key: 'ENG-101', fields: { summary: 'Orders API', description: description() } },
          { id: '10002', key: 'ENG-102', fields: { summary: 'Refunds', description: null } },
        ],
      },
    }));

    expect(jiraConnector.fetchBatchLimit).toBe(100);
    const map = await jiraConnector.fetchMany!(CFG, ['10001', '10002', '10003']);
    expect(fetch).toHaveBeenCalledTimes(1); // one call for the whole chunk, not N+1
    expect([...map.keys()]).toEqual(['10001', '10002']);
    expect(map.has('10003')).toBe(false); // absent, not an error
    expect(map.get('10001')!.markdown).toContain('## Endpoints'); // ADF flowed through adfToMarkdown
    // The batched query enumerates the ids and stays stably ordered.
    expect(jqlOf()).toBe('id in (10001, 10002, 10003) ORDER BY created ASC');
    // 10002 has no description → just the H1 line.
    expect(map.get('10002')!.markdown).toBe('# ENG-102: Refunds');
  });

  it('fetchMany() follows nextPageToken when the API clamps a page below maxResults', async () => {
    stub((url) => {
      if (url.includes('nextPageToken=')) {
        return { body: { issues: [{ id: '10002', key: 'ENG-102', fields: { summary: 'Refunds' } }] } };
      }
      // Jira clamped the page to one issue despite maxResults=100 — cursor back.
      return {
        body: {
          issues: [{ id: '10001', key: 'ENG-101', fields: { summary: 'Orders API' } }],
          nextPageToken: 'CURSOR-2',
        },
      };
    });

    const map = await jiraConnector.fetchMany!(CFG, ['10001', '10002']);
    // Both issues resolved — the clamped-off one is NOT treated as deleted upstream.
    expect([...map.keys()]).toEqual(['10001', '10002']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetch() builds `# KEY: summary` + the converted ADF description', async () => {
    stub((url) => {
      expect(url).toContain('/rest/api/3/issue/10001?fields=summary,description');
      return { body: { id: '10001', key: 'ENG-101', fields: { summary: 'Orders API', description: description() } } };
    });
    const doc = await jiraConnector.fetch(CFG, '10001');
    expect(doc.title).toBe('ENG-101: Orders API');
    expect(doc.markdown.startsWith('# ENG-101: Orders API')).toBe(true);
    expect(doc.markdown).toContain('## Endpoints'); // in-description H1 demoted to H2
    expect(doc.markdown).toContain('- POST /orders');
    expect(doc.markdown).toContain('**Idempotent** by design.');
  });

  it('fetch() with an empty description yields just the H1 line', async () => {
    stub(() => ({ body: { id: '10009', key: 'ENG-9', fields: { summary: 'Stub ticket', description: { version: 1, type: 'doc', content: [] } } } }));
    const doc = await jiraConnector.fetch(CFG, '10009');
    expect(doc.markdown).toBe('# ENG-9: Stub ticket');
  });

  it('surfaces a clean auth error on 401 without leaking the token, JQL, path, or raw JSON', async () => {
    stub(() => ({ status: 401, body: { errorMessages: ['Client must be authenticated'], errors: {} } }));
    await expect(jiraConnector.list(CFG)).rejects.toThrow(/authentication failed/i);
    await expect(jiraConnector.list(CFG)).rejects.not.toThrow(/super-secret-token/);
    // No JQL, request path, or JSON wrapper bleeds into the user message.
    await expect(jiraConnector.list(CFG)).rejects.not.toThrow(/project = "|standardIssueTypes|ORDER BY|errorMessages|\{/);
  });

  it('uses errorMessages[] for 403, and joins them for 400 (bad project key surfaces here)', async () => {
    stub(() => ({ status: 403, body: { errorMessages: ['You do not have permission to view this project.'], errors: {} } }));
    await expect(jiraConnector.list(CFG)).rejects.toThrow(/do not have permission/i);

    stub(() => ({
      status: 400,
      body: { errorMessages: ["The value 'ENG' does not exist for the field 'project'."], errors: {} },
    }));
    const err = await jiraConnector.list(CFG).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect(err.status).toBe(400); // status preserved for error tracking
    expect(err.message).toBe("The value 'ENG' does not exist for the field 'project'.");
  });

  it('403 with no errorMessages falls back to a friendly access-denied message', async () => {
    stub(() => ({ status: 403, body: { errorMessages: [], errors: {} } }));
    await expect(jiraConnector.list(CFG)).rejects.toThrow(/access denied/i);
  });

  it('retries a 429 honoring Retry-After (seconds), then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    stub(() => {
      calls += 1;
      if (calls === 1) return { status: 429, body: { errorMessages: [], errors: {} }, headers: { 'Retry-After': '2' } };
      return { body: { issues: [{ id: '10001', key: 'ENG-101', fields: { summary: 'Orders API', updated: '2026-01-01T00:00:00.000Z' } }] } };
    });

    const p = jiraConnector.list(CFG);
    await vi.advanceTimersByTimeAsync(1000); // < the 2s Retry-After — still backing off
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // 2s elapsed — the retry fires
    const refs = await p;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refs).toHaveLength(1);
  });

  it('stops retrying a persistent 429 after a bounded number of attempts', async () => {
    vi.useFakeTimers();
    stub(() => ({ status: 429, body: { errorMessages: [], errors: {} }, headers: { 'Retry-After': '0' } }));
    const p = jiraConnector.list(CFG).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect(err.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 bounded retries
  });

  it('test() resolves on 200 and reports a friendly reason on a 400 bad project key', async () => {
    stub((url) => {
      expect(url).toContain('maxResults=1&fields=summary'); // limit 1, not the list page size
      return { body: { issues: [] } };
    });
    await expect(jiraConnector.test(CFG)).resolves.toBeUndefined();

    stub(() => ({
      status: 400,
      body: { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."], errors: {} },
    }));
    await expect(jiraConnector.test({ ...CFG, projectKey: 'NOPE' })).rejects.toThrow(/does not exist for the field 'project'/);
  });

  it('exposes field metadata with exactly one secret (apiToken) and an optional jql', () => {
    const secret = jiraConnector.fields.filter((f) => f.secret);
    expect(secret).toHaveLength(1);
    expect(secret[0].key).toBe('apiToken');
    expect(jiraConnector.fields.find((f) => f.key === 'jql')?.optional).toBe(true);
    expect(jiraConnector.fields.map((f) => f.key)).toEqual([
      'baseUrl',
      'projectKey',
      'jql',
      'accountEmail',
      'apiToken',
    ]);
  });
});

/**
 * The metadata header is a TEXT convention: a malformed one does not throw, it
 * is simply never found, and the doc silently falls back to its file mtime. So
 * these assert the CONTRACT the consolidator's `parseDocDate` / `parseDocStatus`
 * impose, not the header string — a string assertion would pass while the parser
 * rejected the shape.
 *
 * The readers live in `@truecourse/spec-consolidator` but are not on this base
 * yet, so the contract is mirrored below. When they land, delete `headerDate` /
 * `headerStatusLine` and import the real functions — the assertions stay as they
 * are, which is the point of writing them against the contract.
 */

/** The date-field names the consolidator recognizes, MOST authoritative first. */
const DATE_FIELDS = ['resolved', 'resolutiondate', 'updated', 'lastmodified', 'modified', 'date', 'created'];
/** Only the first 40 lines are scanned, and only `Name: value` lines match. */
const FIELD_LINE = /^\s*[-*]?\s*\*{0,2}([a-z][a-z _-]*?)\*{0,2}\s*[:=]\s*(.+?)\s*$/i;

/** The date the consolidator would take from this body, or undefined. */
function headerDate(body: string): string | undefined {
  const found = new Map<string, string>();
  for (const line of body.split('\n').slice(0, 40)) {
    const m = FIELD_LINE.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase().replace(/[\s_-]/g, '');
    // First occurrence of a field wins — a stray line above the header would shadow it.
    if (!DATE_FIELDS.includes(field) || found.has(field)) continue;
    const d = new Date(m[2]);
    if (!Number.isNaN(d.getTime())) found.set(field, d.toISOString());
  }
  for (const field of DATE_FIELDS) {
    const hit = found.get(field);
    if (hit) return hit;
  }
  return undefined;
}

/** The raw value on the body's `Status:` line, or undefined. */
function headerStatusLine(body: string): string | undefined {
  for (const line of body.split('\n').slice(0, 40)) {
    const m = /^\s*[-*]?\s*\*{0,2}status\*{0,2}\s*[:=]\s*(.+?)\s*$/i.exec(line);
    if (m) return m[1];
  }
  return undefined;
}

/** What `relevance-filter` reads of a doc before deciding whether it is a spec. */
const RELEVANCE_PREVIEW_LINES = 60;

describe('jiraConnector — metadata header contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const STATUS_ITEM = (from: string, to: string) => ({
    field: 'status',
    fieldtype: 'jira',
    fromString: from,
    toString: to,
  });

  const FULL_HISTORY = [
    { created: '2026-01-05T09:00:00.000-0700', items: [STATUS_ITEM('To Do', 'In Progress')] },
    { created: '2026-03-02T10:00:00.000-0700', items: [STATUS_ITEM('In Progress', 'Done')] },
  ];

  function stubSearch(issues: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const body = String(input).includes('/changelog?')
          ? { values: FULL_HISTORY, isLast: true }
          : { issues };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  }

  /** A closed issue carrying every field. `fields` overrides MERGE; the rest replace. */
  function issue({ fields, ...rest }: Record<string, unknown> = {}) {
    return {
      id: '10001',
      key: 'ENG-1',
      changelog: { total: 2, histories: FULL_HISTORY },
      ...rest,
      fields: {
        summary: 'Idempotent order creation',
        created: '2026-01-04T08:00:00.000-0700',
        updated: '2026-03-02T10:00:00.000-0700',
        resolutiondate: '2026-03-02T10:00:00.000-0700',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        description: description(),
        ...(fields as object | undefined),
      },
    };
  }

  async function bodyOf(one: unknown): Promise<string> {
    stubSearch([one]);
    const map = await jiraConnector.fetchMany!(CFG, ['10001']);
    return map.get('10001')!.markdown;
  }

  it('emits dates in the scanned window, preferring the resolution date', async () => {
    const md = await bodyOf(issue());
    expect(md.startsWith('---\n')).toBe(true);
    expect(md.split('\n').slice(0, 40).join('\n')).toContain('created:');
    // `resolved` outranks `updated` and `created`.
    expect(headerDate(md)).toBe('2026-03-02T17:00:00.000Z');
    expect(headerStatusLine(md)).toBe('"Done"');
  });

  it('normalizes Jira offsets to a Z form, since `-0700` is not portable', async () => {
    const md = await bodyOf(issue());
    // Jira emits `2026-03-02T10:00:00.000-0700`; the header must not pass it through.
    expect(md).not.toContain('-0700');
    expect(md).toContain('updated: 2026-03-02T17:00:00.000Z');
  });

  it('falls back to the changelog when a closed issue has no resolution date', async () => {
    const md = await bodyOf(issue({ fields: { resolutiondate: null } }));
    // Taken from the last transition INTO the current done-category status.
    expect(md).toContain('resolved: 2026-03-02T17:00:00.000Z');
    expect(headerDate(md)).toBe('2026-03-02T17:00:00.000Z');
  });

  it('leaves Resolved absent on an unfinished issue, so `updated` orders it', async () => {
    const md = await bodyOf(
      issue({
        fields: {
          resolutiondate: null,
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        },
      }),
    );
    expect(md).not.toContain('resolved:');
    expect(headerDate(md)).toBe('2026-03-02T17:00:00.000Z');
    expect(headerStatusLine(md)).toBe('"In Progress"');
  });

  it('renders status history as dated lines the date reader ignores', async () => {
    const md = await bodyOf(issue());
    expect(md).toContain('status_history:');
    expect(md).toContain('- "2026-01-05T16:00:00.000Z  To Do -> In Progress"');
    // A history line opens with the timestamp, so it can never match the
    // field-name group — the January transition must not outrank March.
    expect(headerDate(md)).not.toBe('2026-01-05T16:00:00.000Z');
    // …and the heading must not read as a status line.
    expect(headerStatusLine('status_history:\n  - "2026-01-05T16:00:00.000Z  To Do -> Done"')).toBeUndefined();
  });

  it('re-fetches the changelog when the search embedded only part of it', async () => {
    // `total` exceeds what the search returned, and the MISSING entry is the
    // earliest one — exactly the part the history block needs.
    const md = await bodyOf(issue({ changelog: { total: 2, histories: [FULL_HISTORY[1]] } }));
    expect(md).toContain('To Do -> In Progress');
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/changelog?'))).toBe(true);
  });

it('caps the history and says how many it dropped, rather than truncating silently', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      created: `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00.000-0700`,
      items: [STATUS_ITEM(`S${i}`, `S${i + 1}`)],
    }));
    const md = await bodyOf(issue({ changelog: { total: many.length, histories: many } }));
    // Count inside the frontmatter only — the description carries bullets too.
    const fm = md.split('---\n')[1] ?? '';
    const entries = fm.split('\n').filter((l) => l.trim().startsWith('- '));
    // 10 kept + one line naming what was dropped.
    expect(entries).toHaveLength(11);
    expect(md).toContain('15 earlier transitions omitted');
    // The most recent survive — they carry where the issue settled.
    expect(md).toContain('S24 -> S25');
    expect(md).not.toContain('S0 -> S1');
    // …and the doc still reads as a requirement inside the window the relevance
    // classifier sees. Uncapped, the transition list fills it and the issue
    // classifies as status tracking.
    const window = md.split('\n').slice(0, RELEVANCE_PREVIEW_LINES).join('\n');
    expect(window).toContain('# ENG-1');
    expect(window).toContain('POST /orders');
  });

it('leaves updatedAt absent when the issue states none, rather than inventing one', async () => {
    stubSearch([{ id: '10001', key: 'ENG-1', fields: { summary: 'No dates' } }]);
    const refs = await jiraConnector.list(CFG);
    // A substituted epoch would parse as a real date, persist as one, and lose
    // every ordering contest — a doc nobody dated must simply not be dated.
    expect(refs[0].updatedAt).toBeUndefined();
  });

  it('re-fetches when the search gave no changelog total to verify against', async () => {
    // Jira carried a changelog but omitted `total`: the inline copy cannot be
    // shown whole, and what a clipped copy drops is the EARLIEST transitions.
    const md = await bodyOf(issue({ changelog: { histories: [FULL_HISTORY[1]] } }));
    expect(md).toContain('To Do -> In Progress');
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/changelog?'))).toBe(true);
  });

  it('does not re-fetch an issue the search carried no changelog for', async () => {
    const md = await bodyOf(issue({ changelog: undefined }));
    expect(md).not.toContain('status_history:');
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/changelog?'))).toBe(false);
  });

it('states the status category beside the name, for a workflow we cannot enumerate', async () => {
    const md = await bodyOf(
      issue({ fields: { status: { name: 'Awaiting Carrier Handoff', statusCategory: { key: 'done' } } } }),
    );
    expect(md).toContain('status: "Awaiting Carrier Handoff"');
    expect(md).toContain('status_category: "done"');
  });

  it('omits the category when Jira sent none', async () => {
    const md = await bodyOf(issue({ fields: { status: { name: 'Done' } } }));
    expect(md).toContain('status: "Done"');
    expect(md).not.toContain('status_category:');
  });

  it('omits the block entirely when an issue carries no metadata', async () => {
    stubSearch([{ id: '10001', key: 'ENG-1', fields: { summary: 'Bare', description: description() } }]);
    const map = await jiraConnector.fetchMany!(CFG, ['10001']);
    const md = map.get('10001')!.markdown;
    expect(md).not.toContain('status:');
    expect(md).not.toContain('status_history:');
    expect(headerDate(md)).toBeUndefined();
  });
});
