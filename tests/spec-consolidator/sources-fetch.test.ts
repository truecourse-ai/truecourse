/**
 * The network half of the web-sources engine, against a local fixture docs site
 * (the suite never reaches the real internet).
 *
 * The contract under test: every listed page either becomes markdown or lands in
 * `skipped` with a reason — a page is never silently dropped, and an HTML page
 * is never converted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  fetchLlmsTxt,
  fetchPages,
  flattenLinks,
  LlmsTxtFetchError,
  previewSource,
  USER_AGENT,
  type FetchOptions,
  type FetchProgress,
} from '../../packages/spec-consolidator/src/index.js';
import { llmsTxtUrl, startDocsSite, startSite, type FixtureSite } from './sources-fixture.js';

const sites: FixtureSite[] = [];

afterEach(async () => {
  while (sites.length) await sites.pop()!.close();
});

async function docsSite(): Promise<FixtureSite> {
  const site = await startDocsSite();
  sites.push(site);
  return site;
}

/** Fetch every page of a site, with test-sized timeouts. */
async function fetchAll(site: FixtureSite, opts: FetchOptions = {}) {
  const { doc, url } = await fetchLlmsTxt(llmsTxtUrl(site), opts);
  return fetchPages(flattenLinks(doc), new URL(url).origin, opts);
}

describe('previewSource', () => {
  it('reports the site title and how many pages are actually fetchable', async () => {
    const site = await docsSite();
    const preview = await previewSource(llmsTxtUrl(site));

    expect(preview.title).toBe('Strapi Docs');
    expect(preview.totalLinks).toBe(9);
    expect(preview.fetchableLinks).toBe(7);
    expect(preview.skipped.map((skip) => skip.url)).toEqual([
      'https://github.com/strapi/strapi',
      'https://forum.strapi.io/',
    ]);
    expect(new Set(preview.skipped.map((skip) => skip.reason))).toEqual(new Set(['external-origin']));
  });

  it('costs exactly one request — no page is fetched', async () => {
    const site = await docsSite();
    await previewSource(llmsTxtUrl(site));
    expect(site.hits.map((hit) => hit.path)).toEqual(['/llms.txt']);
  });

  it('fails with a typed error when the llms.txt is unreachable', async () => {
    const site = await startSite({});
    sites.push(site);
    await expect(previewSource(llmsTxtUrl(site), { retries: 0 })).rejects.toThrow(LlmsTxtFetchError);
  });

  it('fails with a typed error when the response carries no llms.txt content', async () => {
    const site = await startSite({ '/llms.txt': { body: 'nothing to see here', contentType: 'text/plain' } });
    sites.push(site);
    await expect(previewSource(llmsTxtUrl(site))).rejects.toThrow(/no llms.txt content/);
  });
});

describe('fetchPages', () => {
  it('resolves markdown through all three branches and skips HTML-only pages', async () => {
    const site = await docsSite();
    const { pages, skipped } = await fetchAll(site);

    expect(pages.map((page) => page.url)).toEqual([
      `${site.origin}/cms/quick-start.md`,
      `${site.origin}/cms/installation.md`,
      `${site.origin}/cms/content-type-builder`,
      `${site.origin}/cms/draft-and-publish`,
      `${site.origin}/cms/api/rest`,
      `${site.origin}/design-system.md`,
    ]);
    // Branch 1: fetched as-is. Branch 2: only the `<url>.md` twin exists.
    // Branch 3: no twin, the page itself serves markdown.
    expect(site.hitsFor('/cms/installation.md')).toBe(1);
    expect(site.hitsFor('/cms/content-type-builder.md')).toBe(1);
    expect(site.hitsFor('/cms/content-type-builder')).toBe(0);
    expect(site.hitsFor('/cms/draft-and-publish.md')).toBe(1);
    expect(site.hitsFor('/cms/draft-and-publish')).toBe(1);

    expect(pages.find((page) => page.url.endsWith('/cms/api/rest'))?.content).toContain('# REST API');
    expect(skipped).toEqual([
      { url: 'https://github.com/strapi/strapi', reason: 'external-origin' },
      { url: 'https://forum.strapi.io/', reason: 'external-origin' },
      {
        url: `${site.origin}/cloud/deployment`,
        reason: 'not-markdown',
        detail: 'content-type: text/html',
      },
    ]);
  });

  it('carries the llms.txt link title onto the page', async () => {
    const site = await docsSite();
    const { pages } = await fetchAll(site);
    expect(pages.find((page) => page.url.endsWith('/design-system.md'))?.title).toBe('Design System');
  });

  it('never requests an off-origin link', async () => {
    const site = await docsSite();
    await fetchAll(site);
    expect(site.hits.some((hit) => hit.path.includes('strapi/strapi'))).toBe(false);
  });

  it('identifies itself with a User-Agent on every request', async () => {
    const site = await docsSite();
    await fetchAll(site);
    expect(site.hits.every((hit) => hit.userAgent === USER_AGENT)).toBe(true);
  });

  it('reports progress as pages settle', async () => {
    const site = await docsSite();
    const seen: FetchProgress[] = [];
    await fetchAll(site, { concurrency: 2, onProgress: (p: FetchProgress) => seen.push({ ...p }) });

    expect(seen[0]).toEqual({ done: 0, total: 7 });
    expect(seen[seen.length - 1]).toEqual({ done: 7, total: 7 });
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('falls through to the page itself when the .md twin answers with an app shell', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# Soft 404 Docs\n\n## Guides\n\n- [Routing](${origin}/guides/routing): Route matching.\n`,
        contentType: 'text/plain',
      },
      // A 200 that is really a "page not found" render — must not be snapshotted.
      '/guides/routing.md': { body: '<html><body>Page not found</body></html>', contentType: 'text/html' },
      '/guides/routing': { body: '# Routing\n\nRoutes are matched most-specific first.\n' },
    });
    sites.push(site);

    const { pages, skipped } = await fetchAll(site);
    expect(skipped).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].content).toContain('# Routing');
  });

  it('skips a page whose only response is HTML, with the content type as detail', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# HTML Docs\n\n## Guides\n\n- [Overview](${origin}/overview): Rendered only.\n`,
        contentType: 'text/plain',
      },
      '/overview': { body: '<html><body>Overview</body></html>', contentType: 'text/html; charset=utf-8' },
    });
    sites.push(site);

    const { pages, skipped } = await fetchAll(site);
    expect(pages).toEqual([]);
    expect(skipped).toEqual([
      { url: `${site.origin}/overview`, reason: 'not-markdown', detail: 'content-type: text/html' },
    ]);
  });
});

describe('retries', () => {
  it('retries a rate-limited page and keeps it', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# Flaky Docs\n\n## Guides\n\n- [Rate Limited](${origin}/guides/limited.md): Answers on the third try.\n`,
        contentType: 'text/plain',
      },
      '/guides/limited.md': {
        body: '# Rate Limited\n\nThe page behind a 429.\n',
        failFirst: { times: 2, status: 429, retryAfter: '0' },
      },
    });
    sites.push(site);

    const { pages, skipped } = await fetchAll(site, { retryBaseMs: 5 });
    expect(skipped).toEqual([]);
    expect(pages[0].content).toContain('# Rate Limited');
    expect(site.hitsFor('/guides/limited.md')).toBe(3);
  });

  it('waits the Retry-After the server asked for, not its own backoff', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# Patient Docs\n\n## Guides\n\n- [Slow Down](${origin}/guides/slow-down.md): Comes back after a second.\n`,
        contentType: 'text/plain',
      },
      '/guides/slow-down.md': {
        body: '# Slow Down\n\nServed after the requested pause.\n',
        failFirst: { times: 1, status: 503, retryAfter: '1' },
      },
    });
    sites.push(site);

    const started = Date.now();
    // Backoff of its own would be 0ms here, so anything near a second is the header.
    const { pages } = await fetchAll(site, { retryBaseMs: 0 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(pages[0].content).toContain('# Slow Down');
  });

  it('gives up after the retry budget and records the failure', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# Broken Docs\n\n## Guides\n\n- [Down](${origin}/guides/down.md): Always 500s.\n`,
        contentType: 'text/plain',
      },
      '/guides/down.md': { body: 'boom', status: 500 },
    });
    sites.push(site);

    const { pages, skipped } = await fetchAll(site, { retries: 1, retryBaseMs: 5 });
    expect(pages).toEqual([]);
    expect(skipped).toEqual([
      { url: `${site.origin}/guides/down.md`, reason: 'fetch-failed', detail: 'HTTP 500 Internal Server Error' },
    ]);
    expect(site.hitsFor('/guides/down.md')).toBe(2);
  });

  it('records a timeout as a fetch failure', async () => {
    const site = await startSite({
      '/llms.txt': {
        body: (origin) => `# Slow Docs\n\n## Guides\n\n- [Hangs](${origin}/guides/hangs.md): Never answers in time.\n`,
        contentType: 'text/plain',
      },
      '/guides/hangs.md': { body: '# Hangs\n', delayMs: 2000 },
    });
    sites.push(site);

    const { pages, skipped } = await fetchAll(site, { timeoutMs: 100, retries: 0 });
    expect(pages).toEqual([]);
    expect(skipped).toEqual([
      { url: `${site.origin}/guides/hangs.md`, reason: 'fetch-failed', detail: 'request timed out' },
    ]);
  });
});

describe('fetchLlmsTxt', () => {
  it('parses the site index it fetched', async () => {
    const site = await docsSite();
    const { doc, url } = await fetchLlmsTxt(llmsTxtUrl(site));
    expect(url).toBe(llmsTxtUrl(site));
    expect(doc.sections.map((section) => section.name)).toEqual(['CMS', 'Cloud', 'Optional']);
    expect(doc.summary).toContain('leading open-source headless CMS');
  });

  it('resolves relative links against the llms.txt it was served from', async () => {
    const site = await docsSite();
    const { doc } = await fetchLlmsTxt(llmsTxtUrl(site));
    expect(flattenLinks(doc)[0].url).toBe(`${site.origin}/cms/quick-start.md`);
  });

});
