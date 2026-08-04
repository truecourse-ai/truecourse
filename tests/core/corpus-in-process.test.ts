/**
 * The corpus-path driver behind `spec scan`: curateInProcess writes corpus.json
 * with stub runners (no Claude subprocesses), proving the wiring end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process.js';
import { readCorpus } from '../../packages/spec-consolidator/src/index.js';

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-corpus-inproc-'));
  const docs = path.join(repo, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'users.md'), '# Users\nStatus: shipped\nThe user entity has an id and email.');
  fs.writeFileSync(path.join(docs, 'auth.md'), '# Auth\nStatus: shipped\nSessions authenticate users.');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const includeAll = async ({ doc }: { doc: { path: string } }) => ({ path: doc.path, include: true, reason: 'ok' });
// The two docs carry two concerns, so the vocab stage makes a real call. Stub it to
// a no-op mapping — unstubbed it reaches the transport, and a stage that loses every
// call aborts the scan.
const noVocabDrift = async () => ({ products: {}, concerns: {} });
const tagByPath = async ({ doc }: { doc: { path: string } }) => ({
  tags: [{ product: 'core', concern: doc.path.includes('auth') ? 'auth' : 'users' }],
  status: 'shipped' as const,
});
describe('curateInProcess', () => {
  it('curates the repo docs into corpus.json', async () => {
    const { curate } = await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(curate.stats.docsKept).toBe(2);
    expect(curate.stats.areaCount).toBe(2);
    const corpus = readCorpus(repo);
    expect(corpus).not.toBeNull();
    expect(corpus!.areas.map((a) => a.id).sort()).toEqual(['core/auth', 'core/users-entity']);
  });

  it('persists relevance-dropped docs as skippedDocs (for the dashboard force-include UI)', async () => {
    const { curate } = await curateInProcess(repo, {
      // Drop auth.md; keep users.md.
      relevanceRunner: async ({ doc }: { doc: { path: string } }) => ({
        path: doc.path,
        include: !doc.path.includes('auth'),
        reason: doc.path.includes('auth') ? 'not a spec' : 'ok',
      }),
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(curate.skippedDocs.some((s) => s.path.includes('auth'))).toBe(true);
    // …and it round-trips through corpus.json so the dashboard can read it.
    const corpus = readCorpus(repo);
    expect(corpus!.skippedDocs.some((s) => s.ref.includes('auth') && s.reason === 'not a spec')).toBe(true);
  });
});
