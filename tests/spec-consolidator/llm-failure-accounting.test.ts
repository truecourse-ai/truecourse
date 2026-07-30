/**
 * Total-vs-partial LLM failure accounting in curate(). Every stage fails OPEN per
 * item, so total failure used to be written as a healthy corpus (all docs kept,
 * zero areas) and reported as success. Now: a stage that loses EVERY call aborts
 * the scan and leaves the previous corpus.json untouched; a stage that loses SOME
 * keeps its fail-open defaults and reports the counts; a run that never reaches the
 * transport (cache hits) is healthy; and a parse failure is not a transport failure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { LlmStageFailureError, type LlmTransport } from '@truecourse/shared/llm';
import { curate, corpusFilePath, readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type {
  AreaTagRunner,
  DecisionsFile,
  DocCandidate,
  RelevanceRunner,
} from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

const DOCS = [doc('docs/orders.md'), doc('docs/auth.md'), doc('docs/billing.md')];

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
};

/** Keep every doc — used to hold a stage OFF the transport. */
const keepAll: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
const tagAll: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'orders' }], status: 'shipped' });

/** A transport that throws for `stages` and answers `answer` otherwise. */
function transport(stages: string[], message: string, answer = '{}'): LlmTransport {
  return async (req) => {
    if (stages.includes(req.stage ?? '')) throw new Error(message);
    return answer;
  };
}

const RELEVANCE_OK = '{"include":true,"reason":"spec"}';

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-fail-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function run(extra: Parameters<typeof curate>[1] = {}) {
  return curate(repo, {
    docSource: () => DOCS,
    decisions: EMPTY_DECISIONS,
    disableOverlapDetection: true,
    ...extra,
  });
}

/** Seed a previous corpus.json so an abort can be shown to leave it alone. */
function seedCorpus(): string {
  const file = corpusFilePath(repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prior = JSON.stringify({
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [{ ref: 'docs/orders.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/orders'] }],
    areas: [],
    skippedDocs: [],
  });
  fs.writeFileSync(file, prior);
  return prior;
}

describe('curate — a stage that loses every LLM call aborts', () => {
  it('all relevance calls failed: throws the typed error and leaves the previous corpus untouched', async () => {
    const prior = seedCorpus();
    const err = await run({
      transport: transport(['spec.relevance'], 'claude exited 1: invalid schema for response_format'),
      areaTagRunner: tagAll,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(LlmStageFailureError);
    const tally = (err as LlmStageFailureError).tally;
    expect(tally.stage).toBe('spec.relevance');
    expect(tally.attempts).toBe(DOCS.length);
    expect(tally.failures).toBe(DOCS.length);
    expect(tally.firstError).toContain('invalid schema for response_format');
    expect((err as Error).message).toContain('spec.relevance');

    // The fail-open corpus (every doc kept, zero areas) was never written.
    expect(fs.readFileSync(corpusFilePath(repo), 'utf-8')).toBe(prior);
  });

  it('all area-tag calls failed: aborts at the tagging stage, writing no corpus at all', async () => {
    const err = await run({
      relevanceRunner: keepAll,
      transport: transport(['spec.areaTag'], 'claude exited 1: expired login'),
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(LlmStageFailureError);
    expect((err as LlmStageFailureError).tally.stage).toBe('spec.areaTag');
    expect((err as LlmStageFailureError).tally.failures).toBe(DOCS.length);
    expect(fs.existsSync(corpusFilePath(repo))).toBe(false);
  });
});

describe('curate — isolated failures stay fail-open but are reported', () => {
  it('one relevance call failed: the corpus is written, the doc is kept, the counts are recorded', async () => {
    const failing: LlmTransport = async (req) => {
      if (req.stage === 'spec.relevance' && req.id?.endsWith('docs/auth.md')) {
        throw new Error('claude API error (api 429): usage limit reached');
      }
      return RELEVANCE_OK;
    };

    const result = await run({ transport: failing, areaTagRunner: tagAll });

    expect(result.stats.llmFailures).toEqual([
      {
        stage: 'spec.relevance',
        attempts: 3,
        failures: 1,
        firstError: 'claude API error (api 429): usage limit reached',
      },
    ]);
    // Fail-open: the affected doc is KEPT, never silently dropped.
    expect(result.corpus.docs.map((d) => d.ref)).toContain('docs/auth.md');
    expect(result.skippedDocs.map((s) => s.path)).not.toContain('docs/auth.md');
    expect(readCorpus(repo)).not.toBeNull();
  });

  it('a clean run reports no failures', async () => {
    const result = await run({ relevanceRunner: keepAll, areaTagRunner: tagAll });
    expect(result.stats.llmFailures).toEqual([]);
  });
});

describe('curate — what is NOT a transport failure', () => {
  it('a cache-hit-only re-run never reaches the transport, so it is healthy', async () => {
    const first = await run({
      transport: async (req) =>
        req.stage === 'spec.relevance' ? RELEVANCE_OK : '{"areas":[{"product":"core","concern":"orders"}],"status":null}',
    });
    expect(first.stats.llmFailures).toEqual([]);

    // Same docs, same content hashes: every stage resolves from cache. A transport
    // call here would throw — zero attempts must NOT read as a failure.
    let calls = 0;
    const second = await run({
      transport: async () => {
        calls++;
        throw new Error('the cached run must not call the transport');
      },
    });
    expect(calls).toBe(0);
    expect(second.stats.llmFailures).toEqual([]);
    expect(second.corpus.docs).toHaveLength(DOCS.length);
  });

  it('an unparseable answer is a parse failure, not a transport failure: no abort, no tally', async () => {
    // The transport answered every call; the runner then failed to parse it. That
    // has its own per-stage handling (fail-open), and it is not accounted here.
    const result = await run({
      transport: async () => 'I cannot help with that.',
      areaTagRunner: tagAll,
    });

    expect(result.stats.llmFailures).toEqual([]);
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(expect.arrayContaining(['docs/auth.md']));
  });
});
