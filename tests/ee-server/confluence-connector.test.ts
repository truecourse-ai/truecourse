import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storageXhtmlToMarkdown } from '../../ee/packages/server/src/knowledge/connectors/html-to-markdown';
import {
  confluenceConnector,
  type ConfluenceConfig,
} from '../../ee/packages/server/src/knowledge/connectors/confluence';

const CFG: ConfluenceConfig = {
  baseUrl: 'https://acme.atlassian.net',
  spaceKey: 'ENG',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

describe('storageXhtmlToMarkdown', () => {
  const xhtml =
    '<h1>Orders API</h1>' +
    '<p>Create an order. <strong>POST</strong> only.</p>' +
    '<h2>Endpoints</h2>' +
    '<ul><li>POST /orders</li><li>GET /orders</li></ul>' +
    '<ac:structured-macro ac:name="info"><ac:rich-text-body>Note: idempotent.</ac:rich-text-body></ac:structured-macro>' +
    '<h3>Errors</h3>';

  it('preserves heading levels (the block-slicing anchors) and list items', () => {
    const md = storageXhtmlToMarkdown(xhtml);
    expect(md).toContain('# Orders API');
    expect(md).toContain('## Endpoints');
    expect(md).toContain('### Errors');
    expect(md).toContain('- POST /orders');
    expect(md).toContain('- GET /orders');
    expect(md).toContain('**POST**');
    expect(md).toContain('Note: idempotent.'); // macro wrapper dropped, text kept
  });

  it('is deterministic (same XHTML → byte-identical markdown — cache stability)', () => {
    expect(storageXhtmlToMarkdown(xhtml)).toBe(storageXhtmlToMarkdown(xhtml));
  });

  it('decodes entities', () => {
    expect(storageXhtmlToMarkdown('<p>a &amp; b &lt;tag&gt;</p>')).toContain('a & b <tag>');
  });
});

describe('confluenceConnector', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(routes: (url: string) => { status?: number; body: unknown }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const { status = 200, body } = routes(String(input));
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  }

  it('list() paginates across pages and maps version + url', async () => {
    stub((url) => {
      if (url.includes('start=0')) {
        return {
          body: {
            results: [{ id: 101, title: 'Page A', version: { number: 3, when: '2026-01-01T00:00:00Z' }, _links: { webui: '/wiki/spaces/ENG/pages/101' } }],
            _links: { base: 'https://acme.atlassian.net/wiki', next: '/rest/api/content?start=100' },
          },
        };
      }
      // start=100 → last page (no next).
      return {
        body: {
          results: [{ id: 102, title: 'Page B', version: { number: 1, when: '2026-02-02T00:00:00Z' }, _links: { webui: '/wiki/spaces/ENG/pages/102' } }],
          _links: { base: 'https://acme.atlassian.net/wiki' },
        },
      };
    });

    const refs = await confluenceConnector.list(CFG);
    expect(refs.map((r) => r.id)).toEqual(['101', '102']);
    expect(refs[0]).toMatchObject({ title: 'Page A', version: '3', updatedAt: '2026-01-01T00:00:00Z' });
    expect(refs[0].url).toBe('https://acme.atlassian.net/wiki/wiki/spaces/ENG/pages/101');
    expect(fetch).toHaveBeenCalledTimes(2); // pagination loop stopped when next was absent
  });

  it('fetch() converts the storage body to markdown with the title as H1', async () => {
    stub(() => ({
      body: {
        id: 101,
        title: 'Orders API',
        version: { number: 3 },
        body: { storage: { value: '<h2>Endpoints</h2><p>POST /orders</p>' } },
      },
    }));
    const doc = await confluenceConnector.fetch(CFG, '101');
    expect(doc.title).toBe('Orders API');
    expect(doc.markdown.startsWith('# Orders API')).toBe(true);
    expect(doc.markdown).toContain('## Endpoints');
  });

  it('throws a clean, user-facing error WITHOUT leaking the token or raw JSON', async () => {
    stub(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    await expect(confluenceConnector.list(CFG)).rejects.toThrow(/authentication failed/i);
    await expect(confluenceConnector.list(CFG)).rejects.not.toThrow(/super-secret-token/);
    // No request path / JSON wrapper / Java class leaks into the user message.
    await expect(confluenceConnector.list(CFG)).rejects.not.toThrow(/spaceKey=|statusCode|\{/);
  });

  it('test() probes the space content (ok on 200, friendly error on forbidden)', async () => {
    stub((url) => (url.includes('spaceKey=ENG') ? { body: { results: [] } } : { status: 404, body: {} }));
    await expect(confluenceConnector.test(CFG)).resolves.toBeUndefined();
    stub(() => ({ status: 403, body: {} }));
    await expect(confluenceConnector.test(CFG)).rejects.toThrow(/access denied/i);
  });

  it('surfaces Atlassian’s reason on a 404, stripping the Java exception class', async () => {
    stub(() => ({
      status: 404,
      body: {
        statusCode: 404,
        message: 'com.atlassian.confluence.api.service.exceptions.api.NotFoundException: No space with key : ENG',
      },
    }));
    // User sees "No space with key : ENG" — not the class name or JSON wrapper.
    await expect(confluenceConnector.list(CFG)).rejects.toThrow(/^No space with key : ENG$/);
    // ...and the numeric status rides on the error so the route can tag it.
    await expect(confluenceConnector.list(CFG)).rejects.toMatchObject({ status: 404 });
  });

  it('exposes field metadata with exactly one secret (apiToken)', () => {
    const secret = confluenceConnector.fields.filter((f) => f.secret);
    expect(secret).toHaveLength(1);
    expect(secret[0].key).toBe('apiToken');
    expect(confluenceConnector.fields.map((f) => f.key)).toEqual([
      'baseUrl',
      'spaceKey',
      'accountEmail',
      'apiToken',
    ]);
  });
});

/**
 * The mirror of the Jira connector's header contract. This suite exists because
 * the header was first shipped on Jira alone: Confluence fetched `history` and
 * never wrote it into the body, so its docs hashed identically to before and a
 * re-sync reported nothing to process. Assert the CONTRACT the consolidator's
 * date reader imposes, not the string.
 */
describe('confluenceConnector — metadata header contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  const DATE_FIELDS = ['resolved', 'resolutiondate', 'updated', 'lastmodified', 'modified', 'date', 'created'];
  const FIELD_LINE = /^\s*[-*]?\s*\*{0,2}([a-z][a-z _-]*?)\*{0,2}\s*[:=]\s*(.+?)\s*$/i;

  /** The date the consolidator would take from this body, or undefined. */
  function headerDate(body: string): string | undefined {
    const found = new Map<string, string>();
    for (const line of body.split('\n').slice(0, 40)) {
      const m = FIELD_LINE.exec(line);
      if (!m) continue;
      const field = m[1].toLowerCase().replace(/[\s_-]/g, '');
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

  function stubPage(page: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(page), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  }

  const PAGE = {
    id: '123',
    title: 'Order cancellation policy',
    version: { number: 3, when: '2026-08-19T19:09:08.426Z' },
    history: { createdDate: '2026-08-19T19:08:41.489Z' },
    body: { storage: { value: '<p>Users can cancel while Pending.</p>' } },
  };

  it('emits both dates where the consolidator reads them', async () => {
    stubPage(PAGE);
    const { markdown } = await confluenceConnector.fetch(CFG, '123');
    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown.split('\n').slice(0, 40).join('\n')).toContain('created:');
    expect(markdown).toContain('created: 2026-08-19T19:08:41.489Z');
    expect(markdown).toContain('updated: 2026-08-19T19:09:08.426Z');
    // `updated` outranks `created`, so it is the one that orders the doc.
    expect(headerDate(markdown)).toBe('2026-08-19T19:09:08.426Z');
    // The page still reads as itself — the header sits between H1 and body.
    expect(markdown).toContain('\n# Order cancellation policy');
    expect(markdown).toContain('Users can cancel while Pending.');
  });

  it('carries no status — a page has no lifecycle, and version is an edit counter', async () => {
    stubPage(PAGE);
    const { markdown } = await confluenceConnector.fetch(CFG, '123');
    expect(markdown).not.toContain('status:');
    expect(markdown).not.toContain('status_history:');
    // The edit counter must never surface as a date.
    expect(markdown).not.toContain('3');
  });

  it('omits a date the API did not return, and the block when it returned none', async () => {
    stubPage({ ...PAGE, history: undefined });
    const noCreated = await confluenceConnector.fetch(CFG, '123');
    expect(noCreated.markdown).not.toContain('created:');
    expect(headerDate(noCreated.markdown)).toBe('2026-08-19T19:09:08.426Z');

    stubPage({ ...PAGE, history: undefined, version: undefined });
    const noDates = await confluenceConnector.fetch(CFG, '123');
    expect(headerDate(noDates.markdown)).toBeUndefined();
    // No stray blank block between the H1 and the body.
    expect(noDates.markdown).toBe('# Order cancellation policy\n\nUsers can cancel while Pending.');
  });

  it('changes the body, so a re-sync re-processes the doc', async () => {
    stubPage(PAGE);
    const withDates = await confluenceConnector.fetch(CFG, '123');
    stubPage({ ...PAGE, history: undefined, version: undefined });
    const without = await confluenceConnector.fetch(CFG, '123');
    // The regression this suite was written for: identical bodies hash the same,
    // and the sync reports "nothing to process".
    expect(withDates.markdown).not.toBe(without.markdown);
  });
});
