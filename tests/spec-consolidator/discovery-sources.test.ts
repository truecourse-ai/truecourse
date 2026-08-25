/**
 * Discovery's web-sources merge: the markdown snapshot of every registered docs
 * site joins the doc universe as an ordinary candidate. The load-bearing rules
 * are that the registry (not the walk) enumerates them — the walk hard-skips
 * `.truecourse/` — that the include-scope and `.truecourseignore` never subtract
 * them (registering the source IS the opt-in), and that from curate's point of
 * view they are indistinguishable from a repo doc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  discoverDocs,
  readSourcesFile,
  sourceDirPath,
  sourceDocRef,
  sourcesFilePath,
  writeSourcesFile,
  SourcesFileError,
  SOURCES_REF_PREFIX,
} from '../../packages/spec-consolidator/src/index.js';
import type { DecisionsFile } from '../../packages/spec-consolidator/src/index.js';
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run';
import {
  docPathOf,
  memoryPersistence,
  outcome,
  stubDriver,
} from '../core/spec-scan-session-stub';
import { INSTALLATION_MD, QUICK_START_MD, SEED_PAGES, seedSource } from './sources-fixture.js';

const DEPLOYMENT_MD = `# Deployment

A Strapi Cloud project is built from a GitHub repository on every push to the
tracked branch. The build runs \`yarn build\` and then starts the server with the
environment the project settings define.

## Rolling back

Every deployment keeps its predecessor available for one hour. Rolling back
re-points the domain at the previous build; the database is never touched.
`;

const SITE_ID = 'docs.strapi.io';
const ref = (docPath: string): string => sourceDocRef(SITE_ID, docPath);

let root: string;

beforeEach(() => {
  resetKvCacheStore();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-disc-sources-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('discoverDocs — web sources', () => {
  it('appends every registered snapshot doc as a candidate under its source ref', () => {
    place('README.md', '# The product\n\nA repo doc, discovered by the walk.\n');
    seedSource(root, { id: SITE_ID });

    const docs = discoverDocs(root, { skipGit: true });
    const byPath = new Map(docs.map((d) => [d.path, d]));

    expect([...byPath.keys()]).toEqual([
      'README.md',
      ref('cms/api/rest.md'),
      ref('cms/installation.md'),
      ref('cms/quick-start.md'),
    ]);

    const installation = byPath.get(ref('cms/installation.md'))!;
    expect(installation.path.startsWith(`${SOURCES_REF_PREFIX}/`)).toBe(true);
    expect(installation.absPath).toBe(path.join(sourceDirPath(root, SITE_ID), 'cms/installation.md'));
    expect(fs.readFileSync(installation.absPath, 'utf-8')).toBe(INSTALLATION_MD);
    expect(installation.contentHash).toBe(sha256(INSTALLATION_MD));
    expect(installation.size).toBe(Buffer.byteLength(INSTALLATION_MD));
    expect(installation.preview).toBe(INSTALLATION_MD.split('\n').slice(0, 200).join('\n'));
    expect(installation.lastTouched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // In-memory content is for injected (EE) sources only — a snapshot doc is a
    // real file every downstream consumer re-reads by ref.
    expect(installation.content).toBeUndefined();
  });

  it('classifies a snapshot doc exactly like a repo doc', () => {
    seedSource(root, {
      id: SITE_ID,
      pages: [
        ...SEED_PAGES,
        { path: 'cloud/deployment.md', title: 'Deployment', body: DEPLOYMENT_MD },
      ],
    });

    const kinds = new Map(discoverDocs(root, { skipGit: true }).map((d) => [d.path, d.kind]));
    expect(kinds.get(ref('cloud/deployment.md'))).toBe('runbook');
    expect(kinds.get(ref('cms/quick-start.md'))).toBe('unknown');
  });

  it('merges several registered sources, each under its own id', () => {
    seedSource(root, { id: SITE_ID });
    seedSource(root, {
      id: 'cal.com-docs',
      title: 'Cal.com Docs',
      origin: 'https://cal.com/docs',
      pages: [{ path: 'quick-start.md', title: 'Quick Start', body: QUICK_START_MD }],
    });

    const paths = discoverDocs(root, { skipGit: true }).map((d) => d.path);
    expect(paths).toContain(sourceDocRef('cal.com-docs', 'quick-start.md'));
    expect(paths).toContain(ref('cms/quick-start.md'));
  });

  it('discovers nothing extra when no source is registered', () => {
    place('docs/spec.md', '# Spec\n\nThe repo doc.\n');

    expect(discoverDocs(root, { skipGit: true }).map((d) => d.path)).toEqual(['docs/spec.md']);
    expect(fs.existsSync(sourcesFilePath(root))).toBe(false);
  });

  it('orders source docs by ref and repeats identically across runs', () => {
    place('README.md', '# The product\n');
    seedSource(root, { id: SITE_ID });
    seedSource(root, { id: 'cal.com-docs', origin: 'https://cal.com/docs' });

    const first = discoverDocs(root, { skipGit: true });
    const second = discoverDocs(root, { skipGit: true });
    expect(second).toEqual(first);

    const sourcePaths = first.filter((d) => d.path.startsWith(SOURCES_REF_PREFIX)).map((d) => d.path);
    expect(sourcePaths).toEqual([...sourcePaths].sort());
  });
});

describe('discoverDocs — web sources are exempt from scope and ignore', () => {
  it('an include-scope narrows repo docs only', () => {
    place('.truecourse/config.json', JSON.stringify({ spec: { include: ['docs/**'] } }));
    place('docs/spec.md', '# In scope\n');
    place('README.md', '# Out of scope\n');
    seedSource(root, { id: SITE_ID });

    const paths = discoverDocs(root, { skipGit: true }).map((d) => d.path);
    expect(paths).toContain('docs/spec.md');
    expect(paths).not.toContain('README.md');
    expect(paths).toContain(ref('cms/installation.md'));
    expect(paths).toContain(ref('cms/quick-start.md'));
  });

  it('.truecourseignore subtracts repo docs but never snapshot docs', () => {
    // Patterns that would match the snapshot tree if it were walked at all.
    place('.truecourseignore', '**/installation.md\n.truecourse/**\ninternal/\n');
    place('docs/installation.md', '# Repo installation doc — ignored\n');
    place('internal/secrets.md', '# Ignored\n');
    place('docs/spec.md', '# Kept\n');
    seedSource(root, { id: SITE_ID });

    const paths = discoverDocs(root, { skipGit: true }).map((d) => d.path);
    expect(paths).toContain('docs/spec.md');
    expect(paths).not.toContain('docs/installation.md');
    expect(paths).not.toContain('internal/secrets.md');
    expect(paths).toContain(ref('cms/installation.md'));
  });
});

describe('discoverDocs — degraded registries', () => {
  it('skips a registry entry whose snapshot file is gone', () => {
    const source = seedSource(root, { id: SITE_ID });
    fs.rmSync(path.join(sourceDirPath(root, SITE_ID), 'cms/installation.md'));

    const paths = discoverDocs(root, { skipGit: true }).map((d) => d.path);
    expect(paths).not.toContain(ref('cms/installation.md'));
    expect(paths).toContain(ref('cms/quick-start.md'));
    // The entry stays registered — the next `spec source refresh` restores the file.
    expect(readSourcesFile(root).sources[0].docs).toHaveLength(source.docs.length);
  });

  it('skips a registry path that would escape its source directory', () => {
    place('escape.md', '# Outside the snapshot tree\n');
    seedSource(root, { id: SITE_ID });
    const registry = readSourcesFile(root);
    registry.sources[0].docs.push({
      url: 'https://docs.strapi.io/escape',
      path: '../../../escape.md',
      title: 'Escape',
      contentHash: sha256('# Outside the snapshot tree\n'),
    });
    writeSourcesFile(root, registry);

    const docs = discoverDocs(root, { skipGit: true });
    expect(docs.map((d) => d.path)).toEqual([
      'escape.md',
      ref('cms/api/rest.md'),
      ref('cms/installation.md'),
      ref('cms/quick-start.md'),
    ]);
    // The only candidate for that file is the walk's, rooted at the repo.
    expect(docs.find((d) => d.path === 'escape.md')!.absPath).toBe(path.join(root, 'escape.md'));
  });

  it('surfaces a corrupt registry instead of scanning without the registered docs', () => {
    place('docs/spec.md', '# Kept\n');
    fs.mkdirSync(path.dirname(sourcesFilePath(root)), { recursive: true });
    fs.writeFileSync(sourcesFilePath(root), '{ not json');

    expect(() => discoverDocs(root, { skipGit: true })).toThrow(SourcesFileError);
  });
});

// ---------------------------------------------------------------------------
// The scan run — a snapshot doc is just a doc: curation, tagging, decisions.
// ---------------------------------------------------------------------------

/** Drop the scratch note; tag everything else into one area. */
const curateSession = (briefing: string): unknown => {
  const p = docPathOf(briefing);
  return p.endsWith('scratch.md')
    ? {
        keep: false,
        reason: 'scratch note',
        subject: 'this-product',
        category: 'scratch',
        areas: [],
        status: null,
      }
    : {
        keep: true,
        reason: 'documents the product',
        subject: 'this-product',
        areas: [{ product: 'cms', concern: 'content' }],
        status: 'shipped',
      };
};

const scopeRow = (p: string) => ({
  path: p,
  verdict: 'keep' as const,
  reason: 'covered by the test',
  decidedAt: '2026-01-01T00:00:00Z',
  resolvedBy: 'user' as const,
});

const DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  instructions: [],
  // Covering verdicts keep the scope orchestrator (step 6) out of these cases.
  scopeVerdicts: [scopeRow('.'), scopeRow('notes'), scopeRow(SITE_ID)],
};

function runScan(decisions: DecisionsFile = DECISIONS) {
  const stub = stubDriver(({ kind, briefing }) =>
    kind === 'spec-scan.curate-doc'
      ? outcome(curateSession(briefing))
      : outcome({ concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] }),
  );
  return runSpecScanSessions({
    repoRoot: root,
    driver: async () => stub.driver,
    persistence: memoryPersistence().persistence,
    decisions,
    repoIdentity: null,
    disableOverlapDetection: true,
    skipGit: true,
  });
}

describe('the scan run — snapshot docs flow through the pipeline', () => {
  it('a registered page is curated, tagged, and lands in the corpus', async () => {
    place('README.md', '# The product\n\nThe repo doc.\n');
    place('notes/scratch.md', '# Scratch\n\nA note the classifier drops.\n');
    seedSource(root, { id: SITE_ID });

    const result = await runScan();

    expect(result.corpus.docs.map((d) => d.ref)).toContain(ref('cms/installation.md'));
    expect(result.stats.docsScanned).toBe(5);
    expect(result.skippedDocs).toEqual([
      { path: 'notes/scratch.md', reason: 'scratch note', category: 'scratch' },
    ]);
    const area = result.corpus.areas.find((a) => a.id === 'cms/content')!;
    expect(area.docRefs).toContain(ref('cms/quick-start.md'));
    // The ref resolves to the real file, which is what guard generate + the doc
    // viewer re-read it by.
    for (const doc of result.corpus.docs) {
      expect(fs.existsSync(path.join(root, doc.ref))).toBe(true);
    }
  });

  it('a force-exclude by source ref drops that page from the corpus', async () => {
    seedSource(root, { id: SITE_ID });

    const result = await runScan({ ...DECISIONS, manualExcludes: [ref('cms/installation.md')] });

    const refs = result.corpus.docs.map((d) => d.ref);
    expect(refs).not.toContain(ref('cms/installation.md'));
    expect(refs).toContain(ref('cms/quick-start.md'));
  });
});
