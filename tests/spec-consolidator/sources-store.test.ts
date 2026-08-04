/**
 * The web-sources lifecycle against a local fixture docs site: `add` materializes
 * a committable markdown snapshot plus its registry, `refresh` reconciles both
 * with the site, `remove` takes them away.
 *
 * The load-bearing invariant is that the registry OWNS the snapshot tree — every
 * file it lists exists, every file it stops listing is deleted, and nothing else
 * in the directory is touched.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addSource,
  assertSourceAddable,
  InvalidSourceUrlError,
  listSources,
  readSourcesFile,
  refreshSource,
  removeSource,
  SourceExistsError,
  SourceNotFoundError,
  SourcesFileError,
  SourcesFileSchema,
  sourceDirPath,
  sourcesFilePath,
} from '../../packages/spec-consolidator/src/index.js';
import {
  INSTALLATION_MD,
  QUICK_START_MD,
  llmsTxtUrl,
  startDocsSite,
  startSite,
  type FixtureSite,
} from './sources-fixture.js';

const sites: FixtureSite[] = [];
const repos: string[] = [];

afterEach(async () => {
  while (sites.length) await sites.pop()!.close();
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-sources-'));
  repos.push(dir);
  return dir;
}

async function docsSite(): Promise<FixtureSite> {
  const site = await startDocsSite();
  sites.push(site);
  return site;
}

/** Snapshot paths on disk, relative to the source dir, forward-slashed. */
function snapshotTree(repo: string, id: string): string[] {
  const root = sourceDirPath(repo, id);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('addSource', () => {
  it('writes a snapshot file per page and a registry that describes it', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const result = await addSource(repo, llmsTxtUrl(site));

    const id = result.source.id;
    expect(id).toBe(`127.0.0.1-${new URL(site.origin).port}`);
    expect(result.written).toBe(6);
    expect(snapshotTree(repo, id)).toEqual([
      'cms/api/rest.md',
      'cms/content-type-builder.md',
      'cms/draft-and-publish.md',
      'cms/installation.md',
      'cms/quick-start.md',
      'design-system.md',
    ]);

    const quickStart = fs.readFileSync(path.join(sourceDirPath(repo, id), 'cms/quick-start.md'), 'utf-8');
    expect(quickStart).toBe(QUICK_START_MD);

    const registry = readSourcesFile(repo);
    expect(registry.version).toBe(1);
    expect(registry.sources).toHaveLength(1);
    const source = registry.sources[0];
    expect(source.title).toBe('Strapi Docs');
    expect(source.llmsTxtUrl).toBe(llmsTxtUrl(site));
    expect(Date.parse(source.fetchedAt)).not.toBeNaN();
    expect(source.docs.map((doc) => doc.path)).toEqual([
      'cms/quick-start.md',
      'cms/installation.md',
      'cms/content-type-builder.md',
      'cms/draft-and-publish.md',
      'cms/api/rest.md',
      'design-system.md',
    ]);
    expect(source.docs[1]).toEqual({
      url: `${site.origin}/cms/installation.md`,
      path: 'cms/installation.md',
      title: 'Installation',
      contentHash: sha256(INSTALLATION_MD),
    });
    expect(source.skipped).toEqual([
      { url: 'https://github.com/strapi/strapi', reason: 'external-origin' },
      { url: 'https://forum.strapi.io/', reason: 'external-origin' },
      { url: `${site.origin}/cloud/deployment`, reason: 'not-markdown', detail: 'content-type: text/html' },
    ]);
  });

  it('records a content hash that matches the file it wrote', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site));

    for (const doc of source.docs) {
      const abs = path.join(sourceDirPath(repo, source.id), doc.path);
      expect(sha256(fs.readFileSync(abs, 'utf-8'))).toBe(doc.contentHash);
    }
  });

  it('leaves no temp files behind and writes valid JSON', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site));

    const specDir = path.dirname(sourcesFilePath(repo));
    const stray = fs
      .readdirSync(specDir, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith('.tmp'));
    expect(stray).toEqual([]);
    expect(() => SourcesFileSchema.parse(JSON.parse(fs.readFileSync(sourcesFilePath(repo), 'utf-8')))).not.toThrow();
    expect(listSources(repo).map((entry) => entry.id)).toEqual([source.id]);
  });

  it('honors an explicit id override', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site), { id: 'Strapi Docs' });

    expect(source.id).toBe('strapi-docs');
    expect(fs.existsSync(sourceDirPath(repo, 'strapi-docs'))).toBe(true);
  });

  it('refuses a URL that is already registered', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    await addSource(repo, llmsTxtUrl(site));

    await expect(addSource(repo, llmsTxtUrl(site))).rejects.toThrow(SourceExistsError);
    expect(listSources(repo)).toHaveLength(1);
  });

  // The same check, decided from the registry alone — callers run it before the
  // network so a re-add costs nothing.
  it('assertSourceAddable resolves the id and refuses a taken URL or id', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const url = llmsTxtUrl(site);

    const id = assertSourceAddable(repo, url);
    const { source } = await addSource(repo, url);
    expect(id).toBe(source.id);

    expect(() => assertSourceAddable(repo, url)).toThrow(SourceExistsError);
    expect(() => assertSourceAddable(repo, 'https://docs.other.test/llms.txt', source.id)).toThrow(
      SourceExistsError,
    );
    expect(() => assertSourceAddable(repo, `${site.origin}/docs`)).toThrow(InvalidSourceUrlError);
  });

  it('refuses a URL that is not an llms.txt', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    await expect(addSource(repo, `${site.origin}/docs`)).rejects.toThrow(InvalidSourceUrlError);
    expect(fs.existsSync(sourcesFilePath(repo))).toBe(false);
  });

  it('reports a corrupt registry instead of overwriting it', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    fs.mkdirSync(path.dirname(sourcesFilePath(repo)), { recursive: true });
    fs.writeFileSync(sourcesFilePath(repo), '{ not json');

    await expect(addSource(repo, llmsTxtUrl(site))).rejects.toThrow(SourcesFileError);
    expect(fs.readFileSync(sourcesFilePath(repo), 'utf-8')).toBe('{ not json');
  });
});

describe('refreshSource', () => {
  it('classifies every page as added, changed, removed, or unchanged', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site));
    const id = source.id;

    // The site publishes a new page, edits one, and unlists another.
    site.routes['/cms/relations.md'] = {
      body: '# Relations\n\nRelations connect entries of two content-types.\n',
    };
    site.routes['/cms/installation.md'] = { body: `${INSTALLATION_MD}\n## Upgrading\n\nRun the upgrade tool.\n` };
    site.routes['/llms.txt'] = {
      body: (origin) => `# Strapi Docs

> Strapi is the leading open-source headless CMS.

## CMS

- [Quick Start Guide](/cms/quick-start.md): Create a project and query it in ten minutes.
- [Installation](${origin}/cms/installation.md): Install with the CLI, a template, or Docker.
- [Relations](${origin}/cms/relations.md): Connect entries across content-types.
- [Content-Type Builder](${origin}/cms/content-type-builder): Model collection and single types.
- [REST API](${origin}/cms/api/rest#filters): Filters, sort, pagination, populate.

## Optional

- [Design System](${origin}/design-system.md): The admin panel component library.
`,
      contentType: 'text/plain; charset=utf-8',
    };

    const result = await refreshSource(repo, id);

    expect(result.added).toEqual(['cms/relations.md']);
    expect(result.changed).toEqual(['cms/installation.md']);
    expect(result.removed).toEqual(['cms/draft-and-publish.md']);
    expect(result.unchanged).toEqual([
      'cms/quick-start.md',
      'cms/content-type-builder.md',
      'cms/api/rest.md',
      'design-system.md',
    ]);
    // The unlisted page is gone from disk and from the registry; nothing else is.
    expect(snapshotTree(repo, id)).toEqual([
      'cms/api/rest.md',
      'cms/content-type-builder.md',
      'cms/installation.md',
      'cms/quick-start.md',
      'cms/relations.md',
      'design-system.md',
    ]);
    expect(readSourcesFile(repo).sources[0].docs.map((doc) => doc.path)).toEqual([
      'cms/quick-start.md',
      'cms/installation.md',
      'cms/relations.md',
      'cms/content-type-builder.md',
      'cms/api/rest.md',
      'design-system.md',
    ]);
    expect(
      fs.readFileSync(path.join(sourceDirPath(repo, id), 'cms/installation.md'), 'utf-8'),
    ).toContain('## Upgrading');
  });

  it('leaves an unchanged file untouched on disk', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site));
    const quickStart = path.join(sourceDirPath(repo, source.id), 'cms/quick-start.md');
    const before = fs.statSync(quickStart).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await refreshSource(repo, source.id);

    expect(result.unchanged).toContain('cms/quick-start.md');
    expect(fs.statSync(quickStart).mtimeMs).toBe(before);
  });

  it('keeps the last good snapshot of a still-listed page that fails to fetch', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const { source } = await addSource(repo, llmsTxtUrl(site));
    const id = source.id;
    site.routes['/cms/installation.md'] = { body: 'upstream is down', status: 500 };

    const result = await refreshSource(repo, id, { retries: 0 });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toContainEqual({
      url: `${site.origin}/cms/installation.md`,
      reason: 'fetch-failed',
      detail: 'HTTP 500 Internal Server Error',
    });
    expect(fs.readFileSync(path.join(sourceDirPath(repo, id), 'cms/installation.md'), 'utf-8')).toBe(
      INSTALLATION_MD,
    );
    expect(readSourcesFile(repo).sources[0].docs.map((doc) => doc.path)).toContain('cms/installation.md');
  });

  it('refuses an unknown source id', async () => {
    const repo = makeRepo();
    await expect(refreshSource(repo, 'nope')).rejects.toThrow(SourceNotFoundError);
  });
});

describe('removeSource', () => {
  it('deletes the snapshot directory and the registry entry', async () => {
    const repo = makeRepo();
    const site = await docsSite();
    const other = await startSite({
      '/llms.txt': {
        body: (origin) => `# Other Docs\n\n## Guides\n\n- [Intro](${origin}/intro.md): Getting started.\n`,
        contentType: 'text/plain',
      },
      '/intro.md': { body: '# Intro\n\nStart here.\n' },
    });
    sites.push(other);

    const { source } = await addSource(repo, llmsTxtUrl(site));
    const kept = await addSource(repo, llmsTxtUrl(other));

    const removed = removeSource(repo, source.id);

    expect(removed.id).toBe(source.id);
    expect(fs.existsSync(sourceDirPath(repo, source.id))).toBe(false);
    expect(fs.existsSync(sourceDirPath(repo, kept.source.id))).toBe(true);
    expect(listSources(repo).map((entry) => entry.id)).toEqual([kept.source.id]);
  });

  it('refuses an unknown source id', () => {
    const repo = makeRepo();
    expect(() => removeSource(repo, 'nope')).toThrow(SourceNotFoundError);
  });
});
