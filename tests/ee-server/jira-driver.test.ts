/**
 * The Jira context source driver, over a mocked `fetch`.
 *
 * What is pinned: the search it makes (the enhanced endpoint, 100 at a time,
 * paged on `nextPageToken`), the documents it builds (the frontmatter block
 * byte for byte, the H1, the ADF description), the identity it gives them (the
 * immutable numeric id, the KEY as the path), the changelog it re-fetches only
 * when the inline copy was short, the rate limiting it survives, the reconcile
 * it hands back against a ledger, and the fact that a refusal says what is
 * wrong without carrying the token, the path, the JQL or raw JSON.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createJiraDriver,
  jiraConfig,
  probeJira,
  type AtlassianConnection,
} from '../../ee/packages/server/src/connections/index';

const CONNECTION: AtlassianConnection = {
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

/** The driver under test: this connection, and retries that never really wait. */
function driver(over: Partial<AtlassianConnection> = {}) {
  return createJiraDriver({
    connection: async () => ({ ...CONNECTION, ...over }),
    sleepMs: async () => {},
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  });
}

interface Reply {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

function stub(routes: (url: string) => Reply) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const { status = 200, body, headers } = routes(String(input));
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }),
  );
}

/** The refusal a call made, or a failure saying it did not refuse at all. */
async function refusalOf(run: () => Promise<unknown>): Promise<Error & { status?: number }> {
  try {
    await run();
  } catch (e) {
    return e as Error & { status?: number };
  }
  throw new Error('expected a refusal, and the call resolved');
}

/** The URLs the driver asked for, in order. */
function called(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
}

/** Decode the `jql` query parameter of the Nth request. */
function jqlOf(index = 0): string {
  const match = /[?&]jql=([^&]*)/.exec(called()[index] ?? '');
  return match ? decodeURIComponent(match[1]!) : '';
}

/** A realistic Jira ADF description (a heading, a list, a bold run). */
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
        content: [
          { type: 'text', text: 'Idempotent', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' by design.' },
        ],
      },
    ],
  };
}

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

/** A closed issue carrying every field. `fields` MERGE; everything else replaces. */
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

/** Sync one issue and hand back its body. The changelog endpoint answers whole. */
async function bodyOf(one: unknown): Promise<string> {
  stub((url) =>
    url.includes('/changelog?')
      ? { body: { values: FULL_HISTORY, isLast: true } }
      : { body: { issues: [one] } },
  );
  const result = await driver().sync({ projectKey: 'ENG' }, []);
  return result.documents[0]!.body;
}

/** The frontmatter block of a document, without its fences. */
function frontmatterOf(body: string): string {
  return body.split('---\n')[1] ?? '';
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Jira scope', () => {
  it('needs a project key, and takes it as the project wears it', () => {
    expect(jiraConfig({ projectKey: ' eng ' })).toEqual({ projectKey: 'ENG' });
    // A refusal a route turns into a 400, which is what its name says.
    expect(() => jiraConfig({})).toThrow(/needs the project key/);
    expect(() => jiraConfig({})).toThrow(
      expect.objectContaining({ name: 'ContextConfigError' }) as Error,
    );
    expect(() => jiraConfig({ projectKey: 'two words' })).toThrow(/one word/);
  });

  it('keeps a JQL filter when there is one, and drops a blank one', () => {
    expect(jiraConfig({ projectKey: 'ENG', jql: ' labels = spec ' })).toEqual({
      projectKey: 'ENG',
      jql: 'labels = spec',
    });
    expect(jiraConfig({ projectKey: 'ENG', jql: '   ' })).toEqual({ projectKey: 'ENG' });
  });

  it('names a new source after the site its workspace connected', async () => {
    const scope = await driver().scope!({ projectKey: 'eng' });
    expect(scope).toEqual({
      config: { projectKey: 'ENG' },
      sourceId: 'jira-acme-atlassian-net-eng',
      title: 'ENG (Jira)',
    });
  });

  it('gives two sites reading the same project two ids', async () => {
    const other = await driver({ baseUrl: 'https://other.atlassian.net' }).scope!({
      projectKey: 'ENG',
    });
    expect(other.sourceId).toBe('jira-other-atlassian-net-eng');
  });
});

describe('the Jira search', () => {
  it('scopes the project and excludes sub-tasks when no filter is set', async () => {
    stub(() => ({ body: { issues: [] } }));
    await driver().sync({ projectKey: 'ENG' }, []);
    expect(jqlOf()).toBe(
      'project = "ENG" AND issuetype in standardIssueTypes() ORDER BY created ASC',
    );
    // The enhanced endpoint, 100 at a time — never the removed `/search` + startAt.
    expect(called()[0]).toContain('/rest/api/3/search/jql');
    expect(called()[0]).toContain('maxResults=100');
  });

  it('ANDs a filter in parentheses, dropping the default type clause', async () => {
    stub(() => ({ body: { issues: [] } }));
    await driver().sync({ projectKey: 'ENG', jql: 'labels = spec' }, []);
    expect(jqlOf()).toBe('project = "ENG" AND (labels = spec) ORDER BY created ASC');
    expect(jqlOf()).not.toContain('standardIssueTypes');
  });

  it('pages on nextPageToken, one search per batch of issues', async () => {
    stub((url) =>
      url.includes('nextPageToken=')
        ? { body: { issues: [{ id: '10002', key: 'ENG-2', fields: { summary: 'Refunds' } }] } }
        : {
            body: {
              issues: [{ id: '10001', key: 'ENG-1', fields: { summary: 'Orders' } }],
              nextPageToken: 'CURSOR-2',
            },
          },
    );
    const result = await driver().sync({ projectKey: 'ENG' }, []);
    expect(result.documents.map((doc) => doc.docId)).toEqual(['10001', '10002']);
    expect(called()).toHaveLength(2);
    expect(called()[1]).toContain('nextPageToken=CURSOR-2');
  });
});

describe('a Jira document', () => {
  it('is the issue: its numeric id, its KEY as the path, its browse URL', async () => {
    stub(() => ({ body: { issues: [issue()] } }));
    const result = await driver().sync({ projectKey: 'ENG' }, []);
    const doc = result.documents[0]!;
    expect(doc.docId).toBe('10001');
    expect(doc.docPath).toBe('ENG-1.md');
    expect(doc.title).toBe('ENG-1: Idempotent order creation');
    expect(doc.url).toBe('https://acme.atlassian.net/browse/ENG-1');
    // The source's own `updated`, normalized: Jira emits a -0700 offset.
    expect(doc.updatedAt).toBe('2026-03-02T17:00:00.000Z');
  });

  it('is frontmatter, then the H1, then the description', async () => {
    const body = await bodyOf(issue());
    expect(body).toBe(
      [
        '---',
        'created: 2026-01-04T15:00:00.000Z',
        'updated: 2026-03-02T17:00:00.000Z',
        'resolved: 2026-03-02T17:00:00.000Z',
        'status: "Done"',
        'status_category: "done"',
        'status_history:',
        '  - "2026-01-05T16:00:00.000Z  To Do -> In Progress"',
        '  - "2026-03-02T17:00:00.000Z  In Progress -> Done"',
        '---',
        '',
        '# ENG-1: Idempotent order creation',
        '',
        '## Endpoints',
        '',
        '- POST /orders',
        '- GET /orders',
        '',
        '**Idempotent** by design.',
      ].join('\n'),
    );
  });

  it('hashes the whole body, so an edit anywhere in it reads as a change', async () => {
    const body = await bodyOf(issue());
    stub(() => ({ body: { issues: [issue()] } }));
    const { documents } = await driver().sync({ projectKey: 'ENG' }, []);
    const { createHash } = await import('node:crypto');
    expect(documents[0]!.contentHash).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('is just the H1 when the description is empty', async () => {
    const body = await bodyOf({
      id: '10009',
      key: 'ENG-9',
      fields: { summary: 'Stub ticket', description: { version: 1, type: 'doc', content: [] } },
    });
    expect(body).toBe('# ENG-9: Stub ticket');
  });

  it('falls back to the changelog when a closed issue has no resolution date', async () => {
    const body = await bodyOf(issue({ fields: { resolutiondate: null } }));
    expect(body).toContain('resolved: 2026-03-02T17:00:00.000Z');
  });

  it('leaves resolved absent on an unfinished issue', async () => {
    const body = await bodyOf(
      issue({
        fields: {
          resolutiondate: null,
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        },
      }),
    );
    expect(body).not.toContain('resolved:');
    expect(body).toContain('status: "In Progress"');
  });

  it('caps the history and says how many it dropped', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      created: `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00.000-0700`,
      items: [STATUS_ITEM(`S${i}`, `S${i + 1}`)],
    }));
    const body = await bodyOf(issue({ changelog: { total: many.length, histories: many } }));
    const entries = frontmatterOf(body)
      .split('\n')
      .filter((line) => line.trim().startsWith('- '));
    // Ten kept, plus the one line naming what was dropped.
    expect(entries).toHaveLength(11);
    expect(body).toContain('15 earlier transitions omitted');
    expect(body).toContain('S24 -> S25');
    expect(body).not.toContain('S0 -> S1');
  });

  it('re-fetches the changelog when the search embedded only part of it', async () => {
    const body = await bodyOf(issue({ changelog: { total: 2, histories: [FULL_HISTORY[1]] } }));
    expect(body).toContain('To Do -> In Progress');
    expect(called().some((url) => url.includes('/changelog?'))).toBe(true);
  });

  it('re-fetches when the search gave no total to verify the copy against', async () => {
    const body = await bodyOf(issue({ changelog: { histories: [FULL_HISTORY[1]] } }));
    expect(body).toContain('To Do -> In Progress');
    expect(called().some((url) => url.includes('/changelog?'))).toBe(true);
  });

  it('does not re-fetch an issue the search carried no changelog for', async () => {
    const body = await bodyOf(issue({ changelog: undefined }));
    expect(body).not.toContain('status_history:');
    expect(called().some((url) => url.includes('/changelog?'))).toBe(false);
  });

  it('states the status category beside the name, and omits it when Jira sent none', async () => {
    const stated = await bodyOf(
      issue({ fields: { status: { name: 'Awaiting Carrier Handoff', statusCategory: { key: 'done' } } } }),
    );
    expect(stated).toContain('status: "Awaiting Carrier Handoff"');
    expect(stated).toContain('status_category: "done"');

    const bare = await bodyOf(issue({ fields: { status: { name: 'Done' } } }));
    expect(bare).toContain('status: "Done"');
    expect(bare).not.toContain('status_category:');
  });

  it('omits the block entirely when an issue carries no metadata', async () => {
    const body = await bodyOf({
      id: '10001',
      key: 'ENG-1',
      fields: { summary: 'Bare', description: description() },
    });
    expect(body.startsWith('# ENG-1: Bare')).toBe(true);
    expect(body).not.toContain('status:');
  });
});

describe('a Jira sync', () => {
  it('reconciles what it read against the ledger it was handed', async () => {
    stub(() => ({
      body: {
        issues: [
          { id: '10001', key: 'ENG-1', fields: { summary: 'Orders' } },
          { id: '10002', key: 'ENG-2', fields: { summary: 'Refunds' } },
        ],
      },
    }));
    const first = await driver().sync({ projectKey: 'ENG' }, []);
    expect(first.added).toEqual(['10001', '10002']);
    expect(first.title).toBe('ENG (Jira)');

    const ledger = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));
    // The second issue was edited, and a third the ledger holds is gone.
    stub(() => ({
      body: {
        issues: [
          { id: '10001', key: 'ENG-1', fields: { summary: 'Orders' } },
          { id: '10002', key: 'ENG-2', fields: { summary: 'Refunds, revised' } },
        ],
      },
    }));
    const second = await driver().sync({ projectKey: 'ENG' }, [
      ...ledger,
      { docId: '10003', docPath: 'ENG-3.md', contentHash: 'gone' },
    ]);
    expect(second).toMatchObject({
      added: [],
      changed: ['10002'],
      unchanged: ['10001'],
      removed: ['10003'],
    });
  });

  it('counts what an add would store, and stores nothing', async () => {
    stub(() => ({
      body: {
        issues: [
          { id: '10001', key: 'ENG-1', fields: { summary: 'Orders' } },
          { id: '10002', key: 'ENG-2', fields: { summary: 'Refunds' } },
        ],
      },
    }));
    const check = await driver().check({ projectKey: 'ENG' });
    expect(check).toEqual({
      title: 'ENG (Jira)',
      count: 2,
      titles: ['ENG-1: Orders', 'ENG-2: Refunds'],
      skipped: [],
    });
    // The same search, without the bodies or the changelog.
    expect(called()[0]).toContain('fields=summary');
    expect(called()[0]).not.toContain('expand=changelog');
  });
});

describe('when Jira refuses', () => {
  it('says authentication failed on a 401, and carries nothing it read', async () => {
    stub(() => ({
      status: 401,
      body: { errorMessages: ['Client must be authenticated'], errors: {} },
    }));
    const err = await refusalOf(() => driver().sync({ projectKey: 'ENG' }, []));
    expect(err.message).toMatch(/authentication failed/i);
    for (const leak of [
      'super-secret-token',
      'standardIssueTypes',
      'ORDER BY',
      'errorMessages',
      '/rest/api/3',
      '{',
    ]) {
      expect(err.message).not.toContain(leak);
    }
  });

  it('uses Jira’s own words for a 403 and a 400, and keeps the status', async () => {
    stub(() => ({
      status: 403,
      body: { errorMessages: ['You do not have permission to view this project.'], errors: {} },
    }));
    await expect(driver().sync({ projectKey: 'ENG' }, [])).rejects.toThrow(/do not have permission/i);

    stub(() => ({
      status: 400,
      body: { errorMessages: ["The value 'NOPE' does not exist for the field 'project'."], errors: {} },
    }));
    const err = await refusalOf(() => driver().sync({ projectKey: 'NOPE' }, []));
    expect(err.status).toBe(400);
    expect(err.message).toBe("The value 'NOPE' does not exist for the field 'project'.");
  });

  it('falls back to a friendly reason when a 403 names none', async () => {
    stub(() => ({ status: 403, body: { errorMessages: [], errors: {} } }));
    await expect(driver().sync({ projectKey: 'ENG' }, [])).rejects.toThrow(/access denied/i);
  });
});

describe('when Jira rate-limits', () => {
  it('retries a 429 honoring Retry-After, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    stub(() => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, body: {}, headers: { 'Retry-After': '2' } };
      }
      return { body: { issues: [{ id: '10001', key: 'ENG-1', fields: { summary: 'Orders' } }] } };
    });
    const jira = createJiraDriver({
      connection: async () => CONNECTION,
      sleepMs: async (ms) => {
        waits.push(ms);
      },
    });
    const result = await jira.sync({ projectKey: 'ENG' }, []);
    expect(result.documents).toHaveLength(1);
    expect(waits).toEqual([2000]);
  });

  it('stops retrying a persistent 429 after a bounded number of attempts', async () => {
    stub(() => ({ status: 429, body: {}, headers: { 'Retry-After': '0' } }));
    const err = await refusalOf(() => driver().sync({ projectKey: 'ENG' }, []));
    expect(err.status).toBe(429);
    // One try, then three bounded retries.
    expect(called()).toHaveLength(4);
  });

  it('retries a 503 only when it says how long to wait', async () => {
    stub(() => ({ status: 503, body: {} }));
    await expect(driver().sync({ projectKey: 'ENG' }, [])).rejects.toThrow();
    expect(called()).toHaveLength(1);
  });
});

describe('the Jira probe behind Test', () => {
  it('is the same search, asking for one issue and no project', async () => {
    stub(() => ({ body: { issues: [] } }));
    await expect(probeJira(CONNECTION)).resolves.toBeUndefined();
    expect(called()[0]).toContain('/rest/api/3/search/jql');
    expect(called()[0]).toContain('maxResults=1');
    expect(jqlOf()).toBe('ORDER BY created ASC');
  });

  it('reports the account’s own refusal', async () => {
    stub(() => ({ status: 401, body: { errorMessages: [], errors: {} } }));
    await expect(probeJira(CONNECTION)).rejects.toThrow(/authentication failed/i);
  });
});
