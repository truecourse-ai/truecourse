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
