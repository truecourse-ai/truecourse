/**
 * The Confluence context source driver, over a mocked `fetch`.
 *
 * What is pinned: the listing it makes (the space's current pages, 100 at a
 * time, with the body expanded so a page is never a second request), the
 * documents it builds (the frontmatter block byte for byte, the title as the
 * H1, the storage XHTML converted), the identity it gives them (the page id,
 * because a page can be renamed), the reconcile it hands back against a ledger,
 * and a refusal that carries neither the token nor raw JSON.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  confluenceConfig,
  createConfluenceDriver,
  probeConfluence,
  type AtlassianConnection,
} from '../../ee/packages/server/src/connections/index';

const CONNECTION: AtlassianConnection = {
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

function driver(over: Partial<AtlassianConnection> = {}) {
  return createConfluenceDriver({
    connection: async () => ({ ...CONNECTION, ...over }),
    sleepMs: async () => {},
    now: () => new Date('2026-09-17T00:00:00.000Z'),
  });
}

function stub(routes: (url: string) => { status?: number; body: unknown; headers?: Record<string, string> }) {
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

function called(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
}

/** One page of the space, with everything the expand asks for. */
function page(over: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: 'Orders API',
    version: { number: 3, when: '2026-03-02T10:00:00.000-0700' },
    history: { createdDate: '2026-01-04T08:00:00.000-0700' },
    space: { key: 'ENG', name: 'Engineering' },
    body: { storage: { value: '<h2>Endpoints</h2><p>POST /orders</p>' } },
    _links: { webui: '/spaces/ENG/pages/101' },
    ...over,
  };
}

/** Answer one listing with these pages, and nothing after it. */
function oneListing(pages: unknown[]) {
  stub(() => ({
    body: { results: pages, _links: { base: 'https://acme.atlassian.net/wiki' } },
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Confluence scope', () => {
  it('needs a space key, and takes it as typed', () => {
    expect(confluenceConfig({ spaceKey: ' ENG ' })).toEqual({ spaceKey: 'ENG' });
    expect(() => confluenceConfig({})).toThrow(/needs the space key/);
    expect(() => confluenceConfig({ spaceKey: 'two words' })).toThrow(/one word/);
  });

  it('names a new source after the site its workspace connected', async () => {
    expect(await driver().scope!({ spaceKey: 'ENG' })).toEqual({
      config: { spaceKey: 'ENG' },
      sourceId: 'confluence-acme-atlassian-net-eng',
      title: 'ENG',
    });
  });
});

describe('the Confluence listing', () => {
  it('reads the space’s current pages with their bodies, 100 at a time', async () => {
    oneListing([page()]);
    await driver().sync({ spaceKey: 'ENG' }, []);
    const url = called()[0]!;
    expect(url).toContain('/wiki/rest/api/content?spaceKey=ENG');
    expect(url).toContain('type=page&status=current');
    expect(url).toContain('limit=100');
    expect(decodeURIComponent(url)).toContain('expand=body.storage,version,history,space');
  });

  it('pages until the listing stops offering a next', async () => {
    stub((url) =>
      url.includes('start=0')
        ? {
            body: {
              results: [page()],
              _links: { base: 'https://acme.atlassian.net/wiki', next: '/rest/api/content?start=1' },
            },
          }
        : {
            body: {
              results: [page({ id: 102, title: 'Refunds' })],
              _links: { base: 'https://acme.atlassian.net/wiki' },
            },
          },
    );
    const result = await driver().sync({ spaceKey: 'ENG' }, []);
    expect(result.documents.map((doc) => doc.docId)).toEqual(['101', '102']);
    expect(called()).toHaveLength(2);
  });
});

describe('a Confluence document', () => {
  it('is the page: its id, its id as the path, its deep link', async () => {
    oneListing([page()]);
    const result = await driver().sync({ spaceKey: 'ENG' }, []);
    const doc = result.documents[0]!;
    expect(doc.docId).toBe('101');
    expect(doc.docPath).toBe('101.md');
    expect(doc.title).toBe('Orders API');
    expect(doc.url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/101');
    expect(doc.updatedAt).toBe('2026-03-02T17:00:00.000Z');
  });

  it('is frontmatter, then the H1, then the converted body', async () => {
    oneListing([page()]);
    const result = await driver().sync({ spaceKey: 'ENG' }, []);
    expect(result.documents[0]!.body).toBe(
      [
        '---',
        'created: 2026-01-04T15:00:00.000Z',
        'updated: 2026-03-02T17:00:00.000Z',
        'version: 3',
        '---',
        '',
        '# Orders API',
        '',
        '## Endpoints',
        '',
        'POST /orders',
      ].join('\n'),
    );
  });

  it('keeps what an inline code span holds', async () => {
    // A spec page states its values in code spans — a path, an envelope, a
    // header. The rule that converts them used the wrong capture index, which
    // `String.replace` does not treat as an error: it emitted the token, so
    // every value became the literal `$2` and was lost on the way in.
    oneListing([
      page({
        body: {
          storage: {
            value:
              '<p>Errors from <code>/api/expenses</code> are '
              + '<code>{ "error": "message" }</code>.</p>',
          },
        },
      }),
    ]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.body).toContain('Errors from `/api/expenses` are `{ "error": "message" }`.');
    expect(doc.body).not.toContain('$2');
  });

  it('keeps bold, italics and a link beside it', async () => {
    oneListing([
      page({
        body: {
          storage: {
            value:
              '<p><strong>Must</strong> be <em>exact</em>: see '
              + '<a href="https://example.test/spec">the spec</a>.</p>',
          },
        },
      }),
    ]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.body).toContain('**Must** be _exact_: see [the spec](https://example.test/spec).');
  });

  it('makes a fenced block of a code macro, language and all', async () => {
    oneListing([
      page({
        body: {
          storage: {
            value:
              '<ac:structured-macro ac:name="code">'
              + '<ac:parameter ac:name="language">json</ac:parameter>'
              + '<ac:plain-text-body><![CDATA[{ "error": "message" }]]></ac:plain-text-body>'
              + '</ac:structured-macro>',
          },
        },
      }),
    ]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.body).toContain('```json\n{ "error": "message" }\n```');
    // The language belongs to the fence, never to the prose beside it.
    expect(doc.body).not.toMatch(/^json$/m);
  });

  it('drops a macro parameter rather than leaving it in the prose', async () => {
    oneListing([
      page({
        body: {
          storage: {
            value:
              '<ac:structured-macro ac:name="panel">'
              + '<ac:parameter ac:name="borderColor">note</ac:parameter>'
              + '<ac:rich-text-body><p>Read this first.</p></ac:rich-text-body>'
              + '</ac:structured-macro>',
          },
        },
      }),
    ]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.body).toContain('Read this first.');
    expect(doc.body).not.toMatch(/^note$/m);
  });

  it('does not turn an indented list into a code block', async () => {
    // Storage format is pretty-printed. Stripping a tag leaves its indentation,
    // and four spaces is an indented code block — a nested list came out as a
    // wall of grey with no way to tell it had ever been prose.
    oneListing([
      page({
        body: {
          storage: {
            value: '<ul>\n    <li>\n        First thing\n    </li>\n    <li>Second thing</li>\n</ul>',
          },
        },
      }),
    ]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    for (const line of doc.body.split('\n')) {
      expect(line).not.toMatch(/^ {4}\S/);
    }
    expect(doc.body).toContain('- First thing');
    expect(doc.body).toContain('- Second thing');
  });

  it('omits a date the API did not return, and the block when it returned none', async () => {
    oneListing([page({ history: undefined, version: { number: 2, when: undefined } })]);
    const partial = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(partial.body).toContain('version: 2');
    expect(partial.body).not.toContain('created:');
    expect(partial.body).not.toContain('updated:');
    // Nothing dated it, so the sync's own clock is what the ledger stores.
    expect(partial.updatedAt).toBe('2026-09-17T00:00:00.000Z');

    oneListing([page({ history: undefined, version: undefined })]);
    const bare = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(bare.body.startsWith('# Orders API')).toBe(true);
  });

  it('falls back to the URL the space and the id imply when the API gives none', async () => {
    oneListing([page({ _links: undefined })]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/101');
  });

  it('names an untitled page rather than leaving it blank', async () => {
    oneListing([page({ title: undefined })]);
    const doc = (await driver().sync({ spaceKey: 'ENG' }, [])).documents[0]!;
    expect(doc.title).toBe('(untitled 101)');
  });
});

describe('a Confluence sync', () => {
  it('renames its source to the space, and reconciles against the ledger', async () => {
    oneListing([page(), page({ id: 102, title: 'Refunds' })]);
    const first = await driver().sync({ spaceKey: 'ENG' }, []);
    expect(first.title).toBe('Engineering');
    expect(first.added).toEqual(['101', '102']);

    const ledger = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));
    oneListing([page(), page({ id: 102, title: 'Refunds, revised' })]);
    const second = await driver().sync({ spaceKey: 'ENG' }, ledger);
    expect(second).toMatchObject({ added: [], changed: ['102'], unchanged: ['101'], removed: [] });
  });

  it('counts what an add would store, without reading a single body', async () => {
    oneListing([page(), page({ id: 102, title: 'Refunds' })]);
    const check = await driver().check({ spaceKey: 'ENG' });
    expect(check).toEqual({
      title: 'Engineering',
      count: 2,
      titles: ['Orders API', 'Refunds'],
      skipped: [],
    });
    expect(decodeURIComponent(called()[0]!)).toContain('expand=space');
    expect(called()[0]).not.toContain('body.storage');
  });
});

describe('when Confluence refuses', () => {
  it('says authentication failed on a 401, and carries nothing it read', async () => {
    stub(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    const err = await refusalOf(() => driver().sync({ spaceKey: 'ENG' }, []));
    expect(err.message).toMatch(/authentication failed/i);
    for (const leak of ['super-secret-token', 'spaceKey=', 'statusCode', '{']) {
      expect(err.message).not.toContain(leak);
    }
  });

  it('surfaces Atlassian’s reason on a 404, stripping the Java exception class', async () => {
    stub(() => ({
      status: 404,
      body: {
        statusCode: 404,
        message:
          'com.atlassian.confluence.api.service.exceptions.api.NotFoundException: No space with key : ENG',
      },
    }));
    const err = await refusalOf(() => driver().sync({ spaceKey: 'ENG' }, []));
    expect(err.message).toBe('No space with key : ENG');
    expect(err.status).toBe(404);
  });

  it('retries a 429 honoring Retry-After', async () => {
    const waits: number[] = [];
    let calls = 0;
    stub(() => {
      calls += 1;
      if (calls === 1) return { status: 429, body: {}, headers: { 'Retry-After': '1' } };
      return { body: { results: [page()], _links: { base: 'https://acme.atlassian.net/wiki' } } };
    });
    const confluence = createConfluenceDriver({
      connection: async () => CONNECTION,
      sleepMs: async (ms) => {
        waits.push(ms);
      },
    });
    const result = await confluence.sync({ spaceKey: 'ENG' }, []);
    expect(result.documents).toHaveLength(1);
    expect(waits).toEqual([1000]);
  });
});

describe('the Confluence probe behind Test', () => {
  it('is the same listing, asking for one page and no space', async () => {
    stub(() => ({ body: { results: [] } }));
    await expect(probeConfluence(CONNECTION)).resolves.toBeUndefined();
    expect(called()[0]).toContain('/wiki/rest/api/content?type=page&status=current&limit=1');
    expect(called()[0]).not.toContain('spaceKey');
  });

  it('reports a licence problem as Atlassian stated it', async () => {
    stub(() => ({ status: 403, body: {} }));
    await expect(probeConfluence(CONNECTION)).rejects.toThrow(/access denied/i);
  });
});
