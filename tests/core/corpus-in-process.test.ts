/**
 * The flag-gated corpus-path drivers shared by `spec scan --corpus` and
 * `contracts generate --corpus`: curateInProcess writes corpus.json, then
 * generateFromCorpusInProcess reads it and emits .tc — all with stub runners
 * (no Claude subprocesses), proving the wiring end-to-end alongside the claims path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  curateInProcess,
  generateFromCorpusInProcess,
  readGeneratedSummary,
} from '../../packages/core/src/commands/spec-in-process.js';
import { readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type { Fragment } from '../../packages/contract-extractor/src/index.js';

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
const tagByPath = async ({ doc }: { doc: { path: string } }) => ({
  tags: [{ product: 'core', concern: doc.path.includes('auth') ? 'auth' : 'users' }],
  status: 'shipped' as const,
});
function entityFragment(src: string, identity: string): Fragment {
  return {
    kind: 'Entity',
    identity,
    tcSource: `entity ${identity} {\n  origin "${src}" "${identity}" 1..2\n  field id: string immutable\n}`,
    origin: { source: src, section: identity, lines: [1, 2] },
    obligationKeys: [],
  };
}

describe('curateInProcess', () => {
  it('curates the repo docs into corpus.json', async () => {
    const { curate } = await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
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
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(curate.skippedDocs.some((s) => s.path.includes('auth'))).toBe(true);
    // …and it round-trips through corpus.json so the dashboard can read it.
    const corpus = readCorpus(repo);
    expect(corpus!.skippedDocs.some((s) => s.ref.includes('auth') && s.reason === 'not a spec')).toBe(true);
  });
});

describe('curateInProcess — empty-corpus signal', () => {
  it('no-docs-found: a repo with only non-markdown docs forces noChanges false', async () => {
    // yamllint-shaped repo: rst only, no markdown → nothing discoverable.
    fs.rmSync(path.join(repo, 'docs'), { recursive: true, force: true });
    const docs = path.join(repo, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'guide.rst'), 'restructured text');
    fs.writeFileSync(path.join(docs, 'api.rst'), 'more rst');

    const result = await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(result.emptyCorpus).toBe('no-docs-found');
    // Silence-as-success is the bug: an empty corpus is never "nothing changed".
    expect(result.noChanges).toBe(false);
    expect(result.curate.stats.docsScanned).toBe(0);
    expect(result.curate.stats.ignoredNonMarkdown).toEqual({ '.rst': 2 });
  });

  it('all-docs-dropped: docs scanned but relevance kept none forces noChanges false', async () => {
    const result = await curateInProcess(repo, {
      // Drop every doc.
      relevanceRunner: async ({ doc }: { doc: { path: string } }) => ({
        path: doc.path,
        include: false,
        reason: 'not a spec',
      }),
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(result.emptyCorpus).toBe('all-docs-dropped');
    expect(result.noChanges).toBe(false);
    expect(result.curate.stats.docsScanned).toBe(2);
    expect(result.curate.stats.docsKept).toBe(0);
  });

  it('a non-empty corpus is never force-flagged, and its per-doc stages cache on re-scan', async () => {
    // `noChanges` counts REAL transport calls, which stubbed stages never make —
    // so this asserts what a hermetic run can actually prove: a non-empty corpus
    // is left to the genuine llmCalls derivation (never forced false like an
    // empty one), and the per-doc caches really do absorb the second scan.
    let relevanceCalls = 0;
    let tagCalls = 0;
    const opts = {
      relevanceRunner: async (input: { doc: { path: string } }) => {
        relevanceCalls += 1;
        return includeAll(input);
      },
      areaTagRunner: async (input: { doc: { path: string } }) => {
        tagCalls += 1;
        return tagByPath(input);
      },
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    };
    const first = await curateInProcess(repo, opts);
    expect(first.emptyCorpus).toBeUndefined();
    expect(first.curate.stats.docsKept).toBe(2);
    expect(relevanceCalls).toBe(2);
    expect(tagCalls).toBe(2);

    // Re-scan of unchanged docs: every per-doc stage is a content-keyed cache hit,
    // so neither runner is consulted again and the "nothing changed" signal stands
    // for a non-empty corpus (only an EMPTY corpus is forced to false).
    const second = await curateInProcess(repo, opts);
    expect(second.emptyCorpus).toBeUndefined();
    expect(second.noChanges).toBe(true);
    expect(second.curate.stats.docsKept).toBe(2);
    expect(relevanceCalls).toBe(2);
    expect(tagCalls).toBe(2);
  });
});

describe('generateFromCorpusInProcess', () => {
  it('skips when no corpus.json exists', async () => {
    const { corpus } = await generateFromCorpusInProcess(repo, { disableRepair: true });
    expect(corpus.kind).toBe('skipped');
  });

  it('generates .tc from corpus.json after a curate', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });

    const { corpus } = await generateFromCorpusInProcess(repo, {
      enumerateRunner: async ({ area }) => [
        { kind: 'Entity', identity: area.concern === 'auth' ? 'Session' : 'User' },
      ],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets.map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
    });

    expect(corpus.kind).toBe('generated');
    if (corpus.kind === 'generated') {
      expect(corpus.result.resolverHard).toBe(false);
      expect(corpus.result.gaps).toEqual([]);
      expect(corpus.result.write.written.length).toBeGreaterThan(0);
      expect(corpus.result.artifactsToWrite.map((a) => a.identity).sort()).toEqual(['Session', 'User']);
    }
    // The .tc tree landed on disk.
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts'))).toBe(true);
  });

  it('dry run writes nothing and does not stamp the generated marker', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });
    const { corpus } = await generateFromCorpusInProcess(repo, {
      dryRun: true,
      enumerateRunner: async () => [{ kind: 'Entity', identity: 'User' }],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets.map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
    });
    expect(corpus.kind).toBe('generated');
    if (corpus.kind === 'generated') {
      expect(corpus.result.write.written).toEqual([]);
      expect(corpus.result.write.proposed.length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts', 'result.json'))).toBe(false);
  });

  it('persists the run summary (written + gaps) so it survives a reload', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipGit: true,
    });
    // Enumerate a target the generate runner never emits → a coverage gap.
    const { corpus } = await generateFromCorpusInProcess(repo, {
      enumerateRunner: async ({ area }) =>
        area.concern === 'auth'
          ? [{ kind: 'Entity', identity: 'Session' }]
          : [
              { kind: 'Entity', identity: 'User' },
              { kind: 'Entity', identity: 'Ghost' },
            ],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets
          .filter((t) => t.identity !== 'Ghost')
          .map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
      disableGapJudge: true, // test raw gap persistence, not the judge
    });
    expect(corpus.kind).toBe('generated');

    const summary = readGeneratedSummary(repo);
    expect(summary).not.toBeNull();
    expect(summary!.written).toBeGreaterThan(0);
    expect(summary!.gaps).toContainEqual({
      areaId: 'core/users-entity',
      kind: 'Entity',
      identity: 'Ghost',
    });
    // What the run returned and what we persisted agree.
    if (corpus.kind === 'generated') {
      expect(summary!.written).toBe(corpus.result.write.written.length);
      expect(summary!.gaps).toEqual(corpus.result.gaps);
    }
  });
});
