/**
 * The web spec sources seam: the registry and its pages move between a
 * working tree and a store as one snapshot, a hosted store's sources are
 * materialized into a tree the file engine can read, and a hosted write runs
 * the engine over a scratch tree and keeps what it left — unless it threw.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashContent,
  readSourcesFile,
  sourceDirPath,
  sourcesFilePath,
  writeSourcesFile,
  type SourcesFile,
} from '../../packages/spec-consolidator/src/index.js';
import {
  materializeSpecSources,
  parseSpecSourceRef,
  specSourcesChangedAt,
  readSpecSourceDoc,
  readSpecSourcesFromTree,
  resetSpecSourcesStore,
  setSpecSourcesStore,
  withSpecSourcesTree,
  writeSpecSourcesToTree,
  type SpecSourcesSnapshot,
  type SpecSourcesStore,
} from '@truecourse/core/lib/spec-sources';

const INSTALL = '# Installation\n';
const REST = '# REST\n';

const registry = (): SourcesFile => ({
  version: 1,
  sources: [
    {
      id: 'docs.strapi.io',
      llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
      title: 'Strapi Docs',
      fetchedAt: '2026-07-29T10:15:00.000Z',
      docs: [
        { url: 'https://docs.strapi.io/cms/installation', path: 'cms/installation.md', title: 'Installation', contentHash: hashContent(INSTALL) },
        { url: 'https://docs.strapi.io/cms/api/rest', path: 'cms/api/rest.md', title: 'REST API', contentHash: hashContent(REST) },
      ],
      skipped: [],
    },
  ],
});

const snapshot = (): SpecSourcesSnapshot => ({
  registry: registry(),
  bodies: { [hashContent(INSTALL)]: INSTALL, [hashContent(REST)]: REST },
});

/** A hosted store: one snapshot per repo key, in memory. */
function memStore(): SpecSourcesStore & { rows: Map<string, SpecSourcesSnapshot> } {
  const rows = new Map<string, SpecSourcesSnapshot>();
  const changed = new Map<string, string>();
  return {
    rows,
    materializesInPlace: false,
    async readRegistry(repoKey) {
      return rows.get(repoKey)?.registry ?? { version: 1, sources: [] };
    },
    async readBody(repoKey, sha) {
      return rows.get(repoKey)?.bodies[sha] ?? null;
    },
    async write(repoKey, next) {
      if (next.registry.sources.length === 0) rows.delete(repoKey);
      else rows.set(repoKey, next);
      changed.set(repoKey, new Date().toISOString());
    },
    async changedAt(repoKey) {
      return rows.has(repoKey) ? (changed.get(repoKey) ?? null) : null;
    },
  };
}

let tree: string;

beforeEach(() => {
  tree = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-sources-seam-'));
});
afterEach(() => {
  resetSpecSourcesStore();
  fs.rmSync(tree, { recursive: true, force: true });
});

describe('the tree round trip', () => {
  it('writes the registry and its pages where the engine reads them, and reads them back', () => {
    writeSpecSourcesToTree(tree, snapshot());
    expect(readSourcesFile(tree)).toEqual(registry());
    expect(fs.readFileSync(path.join(sourceDirPath(tree, 'docs.strapi.io'), 'cms/api/rest.md'), 'utf-8')).toBe(REST);
    expect(readSpecSourcesFromTree(tree)).toEqual(snapshot());
  });

  it('skips a page whose body the store lacks, and leaves an empty registry unwritten', () => {
    writeSpecSourcesToTree(tree, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    expect(fs.existsSync(path.join(sourceDirPath(tree, 'docs.strapi.io'), 'cms/api/rest.md'))).toBe(false);
    // Reading back names both pages but carries only the one on disk.
    expect(Object.keys(readSpecSourcesFromTree(tree).bodies)).toEqual([hashContent(INSTALL)]);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-sources-empty-'));
    writeSpecSourcesToTree(empty, { registry: { version: 1, sources: [] }, bodies: {} });
    expect(fs.existsSync(sourcesFilePath(empty))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('parseSpecSourceRef', () => {
  it('splits a source page ref into its source and page, and rejects everything else', () => {
    expect(parseSpecSourceRef('.truecourse/specs/sources/docs.strapi.io/cms/api/rest.md')).toEqual({
      sourceId: 'docs.strapi.io',
      docPath: 'cms/api/rest.md',
    });
    expect(parseSpecSourceRef('docs/orders.md')).toBeNull();
    expect(parseSpecSourceRef('.truecourse/specs/sources/docs.strapi.io')).toBeNull();
    expect(parseSpecSourceRef('.truecourse/specs/sources/docs.strapi.io/')).toBeNull();
  });
});

describe('a hosted store', () => {
  it('materializes its sources into a tree, and reads one page by its corpus ref', async () => {
    const store = memStore();
    store.rows.set('acme/api', snapshot());
    setSpecSourcesStore(store);

    await materializeSpecSources('acme/api', tree);
    expect(readSourcesFile(tree)).toEqual(registry());
    expect(fs.readFileSync(path.join(sourceDirPath(tree, 'docs.strapi.io'), 'cms/installation.md'), 'utf-8')).toBe(INSTALL);

    expect(await readSpecSourceDoc('acme/api', '.truecourse/specs/sources/docs.strapi.io/cms/api/rest.md')).toBe(REST);
    expect(await readSpecSourceDoc('acme/api', '.truecourse/specs/sources/docs.strapi.io/cms/gone.md')).toBeNull();
    expect(await readSpecSourceDoc('acme/api', 'docs/orders.md')).toBeNull();
    expect(await readSpecSourceDoc('other/repo', '.truecourse/specs/sources/docs.strapi.io/cms/api/rest.md')).toBeNull();
  });

  it('writes nothing into the tree for a repo with nothing registered', async () => {
    setSpecSourcesStore(memStore());
    await materializeSpecSources('acme/api', tree);
    expect(fs.existsSync(sourcesFilePath(tree))).toBe(false);
  });

  it('runs a write over a scratch tree and stores what the engine left', async () => {
    const store = memStore();
    store.rows.set('acme/api', snapshot());
    setSpecSourcesStore(store);

    let scratch = '';
    const result = await withSpecSourcesTree('acme/api', (dir) => {
      scratch = dir;
      // The engine: drop one page from the registry and its file, add another.
      const next = readSourcesFile(dir);
      next.sources[0]!.docs = [
        next.sources[0]!.docs[0]!,
        { url: 'https://docs.strapi.io/cms/new', path: 'cms/new.md', title: 'New', contentHash: hashContent('# New\n') },
      ];
      fs.rmSync(path.join(sourceDirPath(dir, 'docs.strapi.io'), 'cms/api/rest.md'));
      fs.writeFileSync(path.join(sourceDirPath(dir, 'docs.strapi.io'), 'cms/new.md'), '# New\n');
      writeSourcesFile(dir, next);
      return 'done';
    });

    expect(result).toBe('done');
    expect(scratch).not.toBe('acme/api');
    expect(fs.existsSync(scratch)).toBe(false);
    const stored = store.rows.get('acme/api')!;
    expect(stored.registry.sources[0]!.docs.map((d) => d.path)).toEqual(['cms/installation.md', 'cms/new.md']);
    expect(stored.bodies).toEqual({ [hashContent(INSTALL)]: INSTALL, [hashContent('# New\n')]: '# New\n' });
  });

  it('stores nothing when the engine throws', async () => {
    const store = memStore();
    store.rows.set('acme/api', snapshot());
    setSpecSourcesStore(store);
    await expect(
      withSpecSourcesTree('acme/api', (dir) => {
        fs.rmSync(sourcesFilePath(dir));
        throw new Error('site unreachable');
      }),
    ).rejects.toThrow('site unreachable');
    expect(store.rows.get('acme/api')).toEqual(snapshot());
  });

  it('runs in place on the file store', async () => {
    writeSpecSourcesToTree(tree, snapshot());
    expect(await withSpecSourcesTree(tree, (dir) => dir)).toBe(tree);
  });

  it('stamps when the sources last changed: the registry file on the file store, nothing when none', async () => {
    expect(await specSourcesChangedAt(tree)).toBeNull();
    writeSpecSourcesToTree(tree, snapshot());
    const stamp = await specSourcesChangedAt(tree);
    expect(stamp).toBe(fs.statSync(sourcesFilePath(tree)).mtime.toISOString());
  });
});
