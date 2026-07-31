/**
 * The offline half of the web-sources engine: llms.txt parsing, URL
 * normalization, and the URL→snapshot-path mapping.
 *
 * These decide what the corpus ends up containing and where it lands on disk,
 * so they are pinned hard: a path that shifts between runs invalidates the
 * relevance/area-tag caches (keyed on `path :: contentHash`), and a link the
 * parser drops is a doc the user silently never sees.
 */

import { describe, it, expect } from 'vitest';
import {
  assertLlmsTxtUrl,
  flattenLinks,
  InvalidSourceUrlError,
  mapUrlsToPaths,
  normalizeSourceUrl,
  parseLlmsTxt,
  sourceIdFromUrl,
  urlToSnapshotPath,
} from '../../packages/spec-consolidator/src/index.js';

const LLMS_TXT_URL = 'https://docs.strapi.io/llms.txt';

const LLMS_TXT = `# Strapi Docs

> Strapi is the leading open-source headless CMS.
> It is 100% JavaScript/TypeScript and developer-first.

- [Overview](/cms/intro.md): What Strapi is and how the pieces fit together.

## CMS

- [Quick Start Guide](/cms/quick-start.md): Create a project and query it in ten minutes.
- [Installation](https://docs.strapi.io/cms/installation.md): Install with the CLI, a template, or Docker.
- [Content-Type Builder](https://docs.strapi.io/cms/content-type-builder)
- [REST API](https://docs.strapi.io/cms/api/rest?utm_source=llms#filters): Filters, sort, pagination, populate.
- [Quick Start Guide](https://docs.strapi.io/cms/quick-start.md/): Listed twice, once with a trailing slash.

Some prose between sections, with an [inline link](https://docs.strapi.io/cms/never-listed)
that is navigation rather than a doc entry.

\`\`\`markdown
- [Example](https://docs.strapi.io/cms/from-a-code-fence.md): Sample llms.txt syntax.
\`\`\`

## Optional

- [Design System](https://design-system.strapi.io/): A separate deployment.
- [Support](mailto:support@strapi.io): Not a page.
`;

describe('parseLlmsTxt', () => {
  const doc = parseLlmsTxt(LLMS_TXT, LLMS_TXT_URL);

  it('reads the H1 title and the blockquote summary', () => {
    expect(doc.title).toBe('Strapi Docs');
    expect(doc.summary).toBe(
      'Strapi is the leading open-source headless CMS. It is 100% JavaScript/TypeScript and developer-first.',
    );
  });

  it('keeps every H2 section, "Optional" included', () => {
    expect(doc.sections.map((section) => section.name)).toEqual(['', 'CMS', 'Optional']);
    const optional = doc.sections.find((section) => section.name === 'Optional')!;
    expect(optional.links.map((link) => link.title)).toEqual(['Design System']);
  });

  it('collects links that precede the first H2 into an unnamed section', () => {
    expect(doc.sections[0].links).toEqual([
      {
        title: 'Overview',
        url: 'https://docs.strapi.io/cms/intro.md',
        description: 'What Strapi is and how the pieces fit together.',
      },
    ]);
  });

  it('resolves relative links against the llms.txt URL', () => {
    const quickStart = flattenLinks(doc).find((link) => link.title === 'Quick Start Guide')!;
    expect(quickStart.url).toBe('https://docs.strapi.io/cms/quick-start.md');
  });

  it('keeps the description when present and omits it when absent', () => {
    const links = flattenLinks(doc);
    expect(links.find((link) => link.title === 'Installation')?.description).toBe(
      'Install with the CLI, a template, or Docker.',
    );
    expect(links.find((link) => link.title === 'Content-Type Builder')).toEqual({
      title: 'Content-Type Builder',
      url: 'https://docs.strapi.io/cms/content-type-builder',
    });
  });

  it('strips query strings and fragments from link URLs', () => {
    const rest = flattenLinks(doc).find((link) => link.title === 'REST API')!;
    expect(rest.url).toBe('https://docs.strapi.io/cms/api/rest');
  });

  it('dedupes by normalized URL, keeping the first occurrence', () => {
    const quickStarts = flattenLinks(doc).filter(
      (link) => link.url === 'https://docs.strapi.io/cms/quick-start.md',
    );
    expect(quickStarts).toHaveLength(1);
    expect(quickStarts[0].description).toBe('Create a project and query it in ten minutes.');
  });

  it('ignores prose links, fenced code blocks, and non-http links', () => {
    const urls = flattenLinks(doc).map((link) => link.url);
    expect(urls).not.toContain('https://docs.strapi.io/cms/never-listed');
    expect(urls).not.toContain('https://docs.strapi.io/cms/from-a-code-fence.md');
    expect(urls.some((url) => url.startsWith('mailto:'))).toBe(false);
  });

  it('yields links in document order', () => {
    expect(flattenLinks(doc).map((link) => link.url)).toEqual([
      'https://docs.strapi.io/cms/intro.md',
      'https://docs.strapi.io/cms/quick-start.md',
      'https://docs.strapi.io/cms/installation.md',
      'https://docs.strapi.io/cms/content-type-builder',
      'https://docs.strapi.io/cms/api/rest',
      'https://design-system.strapi.io/',
    ]);
  });
});

describe('normalizeSourceUrl', () => {
  it('strips fragments, queries, and trailing slashes but keeps the origin root', () => {
    expect(normalizeSourceUrl('/a/b/?x=1#c', 'https://docs.strapi.io/llms.txt')).toBe(
      'https://docs.strapi.io/a/b',
    );
    expect(normalizeSourceUrl('https://docs.strapi.io/', 'https://docs.strapi.io/llms.txt')).toBe(
      'https://docs.strapi.io/',
    );
  });

  it('rejects non-http(s) and malformed URLs', () => {
    expect(normalizeSourceUrl('mailto:a@b.co', 'https://docs.strapi.io/llms.txt')).toBeNull();
    expect(normalizeSourceUrl('ftp://docs.strapi.io/x', 'https://docs.strapi.io/llms.txt')).toBeNull();
  });
});

describe('assertLlmsTxtUrl', () => {
  it('accepts an llms.txt at the root or under a path', () => {
    expect(assertLlmsTxtUrl('https://docs.strapi.io/llms.txt')).toBe('https://docs.strapi.io/llms.txt');
    expect(assertLlmsTxtUrl('https://cal.com/docs/llms.txt#top')).toBe('https://cal.com/docs/llms.txt');
  });

  it('rejects anything that is not an llms.txt', () => {
    for (const url of ['https://docs.strapi.io', 'https://docs.strapi.io/docs', 'https://x.dev/my-llms.txt']) {
      expect(() => assertLlmsTxtUrl(url)).toThrow(InvalidSourceUrlError);
    }
  });
});

describe('sourceIdFromUrl', () => {
  it('uses the host, plus the path when the llms.txt is not at the root', () => {
    expect(sourceIdFromUrl('https://docs.strapi.io/llms.txt')).toBe('docs.strapi.io');
    expect(sourceIdFromUrl('https://cal.com/docs/llms.txt')).toBe('cal.com-docs');
    expect(sourceIdFromUrl('https://example.dev/en/v2/llms.txt')).toBe('example.dev-en-v2');
  });

  it('makes a host:port safe to use as a directory name', () => {
    expect(sourceIdFromUrl('http://127.0.0.1:54321/llms.txt')).toBe('127.0.0.1-54321');
  });
});

describe('urlToSnapshotPath', () => {
  it('maps a path to a markdown file under the source directory', () => {
    expect(urlToSnapshotPath('https://docs.strapi.io/cms/installation.md')).toBe('cms/installation.md');
    expect(urlToSnapshotPath('https://docs.strapi.io/cms/content-type-builder')).toBe(
      'cms/content-type-builder.md',
    );
    expect(urlToSnapshotPath('https://docs.strapi.io/cms/api/rest.html')).toBe('cms/api/rest.html.md');
  });

  it('maps the origin root to index.md', () => {
    expect(urlToSnapshotPath('https://docs.strapi.io/')).toBe('index.md');
    expect(urlToSnapshotPath('https://docs.strapi.io')).toBe('index.md');
  });

  it('decodes percent-encoding and sanitizes filesystem-hostile characters', () => {
    expect(urlToSnapshotPath('https://docs.strapi.io/cms/draft%20and%20publish')).toBe(
      'cms/draft-and-publish.md',
    );
    expect(urlToSnapshotPath('https://docs.strapi.io/cms/a%3Ab%22c%7Cd')).toBe('cms/a-b-c-d.md');
  });

  it('escapes Windows device names', () => {
    expect(urlToSnapshotPath('https://docs.strapi.io/con')).toBe('con_.md');
    expect(urlToSnapshotPath('https://docs.strapi.io/aux.md')).toBe('aux_.md');
  });

  it('confines traversal attempts to the source directory', () => {
    // The URL parser resolves plain and percent-encoded `..` itself...
    expect(urlToSnapshotPath('https://docs.strapi.io/docs/%2e%2e/%2e%2e/secrets')).toBe('secrets.md');
    // ...but an encoded slash survives it and would otherwise decode into one.
    expect(urlToSnapshotPath('https://docs.strapi.io/..%2f..%2fetc/passwd')).toBe('..-..-etc/passwd.md');
  });
});

describe('mapUrlsToPaths', () => {
  it('gives colliding URLs a deterministic numeric suffix', () => {
    const assigned = mapUrlsToPaths([
      'https://docs.strapi.io/guides',
      'https://docs.strapi.io/guides.md',
    ]);
    expect([...assigned.values()]).toEqual(['guides.md', 'guides-2.md']);
  });

  it('keeps a URL on the path it already had, so cache keys survive a refresh', () => {
    const before = mapUrlsToPaths(['https://docs.strapi.io/a', 'https://docs.strapi.io/a.md']);
    expect(before.get('https://docs.strapi.io/a.md')).toBe('a-2.md');

    // `/a` is gone this run — `/a.md` must NOT slide into the freed `a.md`.
    const after = mapUrlsToPaths(['https://docs.strapi.io/a.md'], before);
    expect(after.get('https://docs.strapi.io/a.md')).toBe('a-2.md');
  });
});
