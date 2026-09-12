/**
 * What a hosted run reads: the repository's SLICE of the workspace spec,
 * materialized into its ephemeral clone, and the doc reader that resolves a
 * `context/` ref for every surface that shows a document.
 *
 * Two things are pinned. The MATERIALIZATION writes only the documents of the
 * sources the repository is linked to, at their refs under `context/`, with the
 * workspace's decisions beside them — and answers false when there is nothing to
 * write. The READER resolves a context ref through the workspace that owns the
 * repository, live first and from the scan's snapshot after, so a document
 * stays readable once its source stops yielding it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import {
  resetSpecStore,
  saveWorkspaceSpec,
  saveWorkspaceSpecDocs,
  setSpecStore,
} from '@truecourse/core/lib/spec-store';
import {
  corpusFilePath,
  decisionsPath,
  type CuratedCorpus,
} from '../../packages/spec-consolidator/src/index.js';
import { materializeStoredSpec } from '../../apps/dashboard/server/src/jobs/materialize-spec';
import {
  readStoredRepoDoc,
  setRepoWorkspaceLookup,
} from '../../apps/dashboard/server/src/stores';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';

const ORG = 'org_A';
const REPO = 'acme/widgets';
const SRC_A = 'repo-acme-widgets';
const SRC_B = 'stripe-docs';
const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;

let context: ContextStore;
let tree: string;

beforeEach(async () => {
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  setRepoWorkspaceLookup(async (repoKey) => (repoKey === REPO ? ORG : null));
  tree = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-slice-'));
  await seed();
});

afterEach(() => {
  resetContextStore();
  resetSpecStore();
  setRepoWorkspaceLookup(null);
  fs.rmSync(tree, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  await context.createSource(ORG, {
    id: SRC_A,
    kind: 'repository',
    title: REPO,
    config: { repoFullName: REPO, installationId: 11, include: [], exclude: [], branch: 'main' },
  });
  await context.createSource(ORG, {
    id: SRC_B,
    kind: 'site',
    title: 'Stripe Docs',
    config: { llmsTxtUrl: 'https://stripe.example/llms.txt' },
  });
  await context.writeDocuments(ORG, SRC_A, {
    documents: [body('docs/one.md', '# One\n')],
    removed: [],
  });
  await context.writeDocuments(ORG, SRC_B, {
    documents: [body('site.md', '# Site\n')],
    removed: [],
  });
  await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpus());
  await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'decisions', {
    version: 2,
    manualIncludes: [ref(SRC_A, 'docs/one.md')],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: [],
    instructions: [],
  });
}

const body = (docPath: string, content: string) => ({
  docId: docPath,
  docPath,
  title: docPath,
  url: null,
  contentHash: `sha-${docPath}`,
  updatedAt: '2026-01-01T00:00:00.000Z',
  body: content,
});

function corpus(): CuratedCorpus {
  const docs = [
    { ref: ref(SRC_A, 'docs/one.md'), kind: 'prd' as const, lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A },
    { ref: ref(SRC_B, 'site.md'), kind: 'prd' as const, lastTouched: '', areaTags: ['p/c'], sourceId: SRC_B },
  ];
  return {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs,
    areas: [
      { id: 'p/c', product: 'p', concern: 'c', docRefs: docs.map((d) => d.ref), overlaps: [] },
    ],
    skippedDocs: [],
  };
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf-8'));

describe('materializeStoredSpec', () => {
  it('writes only the documents of the sources the repository reads, at their refs', async () => {
    await setContextBindings(ORG, REPO, [SRC_A]);

    expect(await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG)).toEqual({
      hasWorkspaceCorpus: true,
      documents: 1,
    });

    const written = readJson(corpusFilePath(tree)) as CuratedCorpus;
    expect(written.docs.map((d) => d.ref)).toEqual([ref(SRC_A, 'docs/one.md')]);
    // The bodies go in at their refs, so every stage reads them by the ref the
    // corpus names.
    expect(fs.readFileSync(path.join(tree, 'context', SRC_A, 'docs', 'one.md'), 'utf-8')).toBe('# One\n');
    expect(fs.existsSync(path.join(tree, 'context', SRC_B))).toBe(false);
  });

  it('writes the WORKSPACE decisions beside the slice', async () => {
    await setContextBindings(ORG, REPO, [SRC_A]);
    await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG);

    expect(readJson(decisionsPath(tree))).toMatchObject({
      manualIncludes: [ref(SRC_A, 'docs/one.md')],
    });
  });

  it('takes both sources when the repository reads both', async () => {
    await setContextBindings(ORG, REPO, [SRC_A, SRC_B]);
    expect(
      (await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG)).documents,
    ).toBe(2);

    const written = readJson(corpusFilePath(tree)) as CuratedCorpus;
    expect(written.docs).toHaveLength(2);
    expect(fs.existsSync(path.join(tree, 'context', SRC_B, 'site.md'))).toBe(true);
  });

  // An empty slice is a runnable state, not a refusal: Test setup derives the
  // recipe, the dependencies and the interfaces from the CODE, so a repository
  // linked to nothing still gets a corpus — one that holds nothing.
  it('writes an empty corpus when the repository is linked to nothing', async () => {
    await setContextBindings(ORG, REPO, []);

    expect(await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG)).toEqual({
      hasWorkspaceCorpus: true,
      documents: 0,
    });
    expect((readJson(corpusFilePath(tree)) as CuratedCorpus).docs).toEqual([]);
    expect(fs.existsSync(path.join(tree, 'context'))).toBe(false);
  });

  it('writes an empty corpus when the workspace has never scanned', async () => {
    setSpecStore(memorySpecStore()); // a fresh store: no workspace corpus
    await setContextBindings(ORG, REPO, [SRC_A]);

    expect(await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG)).toEqual({
      hasWorkspaceCorpus: false,
      documents: 0,
    });
    expect((readJson(corpusFilePath(tree)) as CuratedCorpus).docs).toEqual([]);
  });

  it('falls back to the scan’s snapshot for a document the source no longer yields', async () => {
    await setContextBindings(ORG, REPO, [SRC_A]);
    await saveWorkspaceSpecDocs({ workspaceOrgId: ORG }, {
      [ref(SRC_A, 'docs/one.md')]: '# One, as the scan read it\n',
    });
    // The source drops the document; the corpus still names it.
    await context.writeDocuments(ORG, SRC_A, { documents: [], removed: ['docs/one.md'] });

    expect(
      (await materializeStoredSpec({ repoKey: REPO, commitSha: 'abc' }, tree, ORG)).documents,
    ).toBe(1);
    expect(fs.readFileSync(path.join(tree, 'context', SRC_A, 'docs', 'one.md'), 'utf-8')).toBe(
      '# One, as the scan read it\n',
    );
  });
});

describe('the doc reader', () => {
  it('resolves a context ref through the workspace that owns the repository', async () => {
    expect(await readStoredRepoDoc(REPO, ref(SRC_B, 'site.md'))).toBe('# Site\n');
  });

  it('answers the scan’s snapshot once the source stopped yielding the document', async () => {
    await saveWorkspaceSpecDocs({ workspaceOrgId: ORG }, {
      [ref(SRC_B, 'site.md')]: '# Site, as the scan read it\n',
    });
    await context.writeDocuments(ORG, SRC_B, { documents: [], removed: ['site.md'] });

    expect(await readStoredRepoDoc(REPO, ref(SRC_B, 'site.md'))).toBe(
      '# Site, as the scan read it\n',
    );
  });

  it('answers absent for a context ref nobody holds', async () => {
    expect(await readStoredRepoDoc(REPO, ref(SRC_B, 'gone.md'))).toBeNull();
  });

  it('answers absent when the repository belongs to no workspace here', async () => {
    expect(await readStoredRepoDoc('someone/else', ref(SRC_B, 'site.md'))).toBeNull();
  });

  it('leaves a repository-relative ref to the per-repository snapshot', async () => {
    const { saveSpecDocs } = await import('@truecourse/core/lib/spec-store');
    await saveSpecDocs({ repoKey: REPO, commitSha: 'abc' }, { 'docs/local.md': '# Local\n' });
    expect(await readStoredRepoDoc(REPO, 'docs/local.md')).toBe('# Local\n');
  });
});
