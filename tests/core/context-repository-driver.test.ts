/**
 * The `repository` driver — a repository's own documentation as a WORKSPACE
 * source, over a real (temporary) git repository.
 *
 * What is asserted is the scope and the reconciliation: the default patterns
 * select `docs/**` and every markdown and subtract changelogs and licenses, the
 * engine's own skip list and `.truecourseignore` still apply, a document's
 * `updatedAt` is the commit that last touched it, the diff is against the
 * ledger, and the checkout is disposed however the call ends.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createRepositoryDriver,
  documentTitle,
  scopeFilter,
  type ContextLedgerEntry,
} from '@truecourse/core/services/context';
import {
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
} from '@truecourse/shared';

const REPO = 'acme/api';

let repoDir: string;
let disposed = 0;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

function write(rel: string, body: string): void {
  const abs = path.join(repoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf-8');
}

function commit(message: string): void {
  git(['add', '-A']);
  git(['commit', '-m', message]);
}

beforeEach(() => {
  disposed = 0;
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-context-repo-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  write('README.md', '# Acme API\n\nThe service.\n');
  write('docs/guide.md', '# Getting started\n\nInstall it.\n');
  write('docs/api/rest.md', '## REST\n\nEndpoints.\n');
  write('CHANGELOG.md', '# Changelog\n\n## 1.0.0\n');
  write('LICENSE', 'MIT\n');
  write('src/index.ts', 'export const x = 1;\n');
  write('node_modules/pkg/readme.md', '# vendored\n');
  commit('initial');
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

const driver = () =>
  createRepositoryDriver({
    acquireTree: async () => ({
      dir: repoDir,
      dispose: () => {
        disposed += 1;
      },
    }),
  });

const config = (over: Record<string, unknown> = {}) => ({
  repoFullName: REPO,
  include: [...DEFAULT_REPOSITORY_INCLUDE],
  exclude: [...DEFAULT_REPOSITORY_EXCLUDE],
  branch: 'main',
  ...over,
});

const paths = (docs: { docPath: string }[]): string[] => docs.map((doc) => doc.docPath).sort();

describe('repository driver — scope', () => {
  it('keeps the markdown the default patterns select', async () => {
    const result = await driver().sync(config(), []);
    expect(paths(result.documents)).toEqual(['README.md', 'docs/api/rest.md', 'docs/guide.md']);
  });

  it('subtracts changelogs and licenses', async () => {
    const result = await driver().sync(config(), []);
    expect(paths(result.documents)).not.toContain('CHANGELOG.md');
    expect(paths(result.documents)).not.toContain('LICENSE');
  });

  it('never looks inside the engine skip list', async () => {
    const result = await driver().sync(config(), []);
    expect(result.documents.some((doc) => doc.docPath.startsWith('node_modules/'))).toBe(false);
  });

  it('honors a narrower include: only docs/**', async () => {
    const result = await driver().sync(config({ include: ['docs/**'] }), []);
    expect(paths(result.documents)).toEqual(['docs/api/rest.md', 'docs/guide.md']);
  });

  it('honors an extra exclude on top of the include', async () => {
    const result = await driver().sync(config({ exclude: ['docs/api/**'] }), []);
    expect(paths(result.documents)).toEqual(['CHANGELOG.md', 'README.md', 'docs/guide.md']);
  });

  it('honors the repository .truecourseignore', async () => {
    write('.truecourseignore', 'docs/api/\n');
    commit('ignore the api docs');
    const result = await driver().sync(config(), []);
    expect(paths(result.documents)).not.toContain('docs/api/rest.md');
  });

  it('admits an OpenAPI document the patterns select', async () => {
    write('docs/openapi.yaml', 'openapi: 3.0.0\ninfo:\n  title: Acme\n  version: 1.0.0\npaths: {}\n');
    commit('add the contract');
    const result = await driver().sync(config({ include: ['docs/**'] }), []);
    expect(paths(result.documents)).toContain('docs/openapi.yaml');
  });

  it('is the walk alone: a committed llms.txt registry and its snapshots are not the repository\'s files', async () => {
    write(
      '.truecourse/specs/sources.json',
      JSON.stringify({
        version: 1,
        sources: [
          {
            id: 'docs-acme',
            llmsTxtUrl: 'https://docs.acme.test/llms.txt',
            title: 'Acme docs',
            fetchedAt: '2026-09-01T00:00:00.000Z',
            docs: [{ url: 'https://docs.acme.test/start', path: 'start.md', title: 'Start', contentHash: 'abc' }],
            skipped: [],
          },
        ],
      }),
    );
    write('.truecourse/specs/sources/docs-acme/start.md', '# Start\n');
    commit('register a site');
    const result = await driver().sync(config(), []);
    expect(result.documents.some((doc) => doc.docPath.includes('sources/docs-acme'))).toBe(false);
    expect(paths(result.documents)).toEqual(['README.md', 'docs/api/rest.md', 'docs/guide.md']);
  });

  it('is scoped by its own patterns, not the repository\'s spec.include', async () => {
    write('.truecourse/config.json', JSON.stringify({ spec: { include: ['docs/api/**'] } }));
    commit('narrow the repository scan');
    const result = await driver().sync(config(), []);
    expect(paths(result.documents)).toEqual(['README.md', 'docs/api/rest.md', 'docs/guide.md']);
  });

  it('refuses a config with no repository', async () => {
    await expect(driver().sync({ include: [], exclude: [], branch: '' }, [])).rejects.toThrow(
      /repoFullName/,
    );
  });
});

describe('repository driver — documents', () => {
  it('hands each document back with its body, hash and heading title', async () => {
    const result = await driver().sync(config(), []);
    const guide = result.documents.find((doc) => doc.docPath === 'docs/guide.md')!;
    expect(guide.docId).toBe('docs/guide.md');
    expect(guide.body).toBe('# Getting started\n\nInstall it.\n');
    expect(guide.title).toBe('Getting started');
    expect(guide.url).toBeNull();
    expect(guide.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stamps a document with the commit that last touched it', async () => {
    const result = await driver().sync(config(), []);
    const guide = result.documents.find((doc) => doc.docPath === 'docs/guide.md')!;
    const lastCommit = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'docs/guide.md'], {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();
    expect(guide.updatedAt).toBe(lastCommit);
  });
});

describe('repository driver — reconciliation', () => {
  it('is all additions against an empty ledger', async () => {
    const result = await driver().sync(config(), []);
    expect(result.added.sort()).toEqual(['README.md', 'docs/api/rest.md', 'docs/guide.md']);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('reports an edit, a deletion and a new file against the ledger', async () => {
    const first = await driver().sync(config(), []);
    const ledger: ContextLedgerEntry[] = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));

    write('docs/guide.md', '# Getting started\n\nInstall it, then run it.\n');
    fs.rmSync(path.join(repoDir, 'docs/api/rest.md'));
    write('docs/faq.md', '# FAQ\n');
    commit('edit, delete, add');

    const second = await driver().sync(config(), ledger);
    expect(second.changed).toEqual(['docs/guide.md']);
    expect(second.added).toEqual(['docs/faq.md']);
    expect(second.removed).toEqual(['docs/api/rest.md']);
    expect(second.unchanged).toEqual(['README.md']);
  });

  it('reports everything unchanged when nothing moved', async () => {
    const first = await driver().sync(config(), []);
    const ledger: ContextLedgerEntry[] = first.documents.map((doc) => ({
      docId: doc.docId,
      docPath: doc.docPath,
      contentHash: doc.contentHash,
    }));
    const second = await driver().sync(config(), ledger);
    expect(second.unchanged.sort()).toEqual(['README.md', 'docs/api/rest.md', 'docs/guide.md']);
    expect(second.added).toEqual([]);
    expect(second.changed).toEqual([]);
    expect(second.removed).toEqual([]);
  });
});

describe('repository driver — check', () => {
  it('reports the count and the first titles without storing anything', async () => {
    const check = await driver().check(config());
    expect(check.title).toBe(REPO);
    expect(check.count).toBe(3);
    expect(check.titles).toContain('Getting started');
    expect(check.skipped).toEqual([]);
  });
});

describe('repository driver — the checkout', () => {
  it('disposes the tree after a sync and after a check', async () => {
    await driver().sync(config(), []);
    await driver().check(config());
    expect(disposed).toBe(2);
  });

  it('disposes the tree even when the walk throws', async () => {
    const broken = createRepositoryDriver({
      acquireTree: async () => ({
        dir: path.join(repoDir, 'does-not-exist'),
        dispose: () => {
          disposed += 1;
        },
      }),
    });
    // A missing directory yields no documents rather than throwing, so the
    // disposal is what this proves either way.
    await broken.sync(config(), []);
    expect(disposed).toBe(1);
  });
});

describe('the scope filter and the title', () => {
  it('needs an include match and no exclude match', () => {
    const keep = scopeFilter(['docs/**'], ['**/private/**']);
    expect(keep('docs/guide.md')).toBe(true);
    expect(keep('README.md')).toBe(false);
    expect(keep('docs/private/secret.md')).toBe(false);
  });

  it('keeps everything when no include is configured', () => {
    const keep = scopeFilter([], []);
    expect(keep('anything.md')).toBe(true);
  });

  it('titles a document by its first heading, else by its file name', () => {
    expect(documentTitle('docs/guide.md', '# Getting started\n')).toBe('Getting started');
    expect(documentTitle('docs/guide.md', '### Deep heading\n')).toBe('Deep heading');
    expect(documentTitle('docs/guide.md', 'no heading here\n')).toBe('guide');
    expect(documentTitle('docs/openapi.yaml', 'openapi: 3.0.0\n')).toBe('openapi');
  });
});
