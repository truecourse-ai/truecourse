/**
 * Total-vs-partial LLM failure accounting in the SCAN RUN (plan 02: the
 * `curate()` stages are sessions now, so a "call" is a session and a "stage" is
 * a session kind). The rules are carried over verbatim: every kind fails OPEN
 * per item, so total failure would otherwise be written as a healthy corpus (all
 * docs kept, zero areas) and reported as success. Instead — a kind that loses
 * EVERY session to a TRANSPORT failure aborts the scan and leaves the previous
 * corpus.json untouched; a kind that loses SOME keeps its fail-open defaults and
 * reports the counts; a run that never starts a session (cache hits) is healthy;
 * and a malformed outcome is not a transport failure, so it never aborts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { LlmStageFailureError } from '@truecourse/shared/llm';
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run';
import { corpusFilePath, readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type { DecisionsFile, DocCandidate } from '../../packages/spec-consolidator/src/index.js';
import {
  docPathOf,
  malformedFailure,
  memoryPersistence,
  outcome,
  stubDriver,
  toolResult,
  transportFailure,
  type StubCall,
  type StubScript,
} from '../core/spec-scan-session-stub';

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
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
};

/** One concern for every doc — the settle gate stays CLOSED unless a case wants it. */
const keepAll = (concern = 'orders') => (): unknown => ({
  keep: true,
  reason: 'spec',
  subject: 'this-product',
  areas: [{ product: 'core', concern }],
  status: 'shipped',
});

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-fail-'));
});
afterEach(() => {
  resetKvCacheStore();
  fs.rmSync(repo, { recursive: true, force: true });
});

function run(script: StubScript) {
  const stub = stubDriver(script);
  return {
    stub,
    result: runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      docSource: () => DOCS,
      decisions: EMPTY_DECISIONS,
      disableOverlapDetection: true,
      skipGit: true,
    }),
  };
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

describe('the scan run — a kind that loses every session to transport aborts', () => {
  it('every curate-doc session failed: throws the typed error and leaves the previous corpus untouched', async () => {
    const prior = seedCorpus();
    const err = await run(() => transportFailure()).result.then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(LlmStageFailureError);
    const tally = (err as LlmStageFailureError).tally;
    expect(tally.stage).toBe('spec-scan.curate-doc');
    expect(tally.attempts).toBe(DOCS.length);
    expect(tally.failures).toBe(DOCS.length);
    expect(tally.firstError).toContain('the provider is gone');
    expect((err as Error).message).toContain('spec-scan.curate-doc');

    // The fail-open corpus (every doc kept, zero areas) was never written.
    expect(fs.readFileSync(corpusFilePath(repo), 'utf-8')).toBe(prior);
  });

  it('the settle session failed: aborts at that kind, writing no corpus at all', async () => {
    // Two concerns ⇒ the settle gate opens; every curate session lands, so the
    // abort can only come from the barrier.
    const err = await run((call) =>
      call.kind === 'spec-scan.settle-areas'
        ? transportFailure()
        : outcome(keepAll(docPathOf(call.briefing).includes('auth') ? 'auth' : 'orders')()),
    ).result.then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(LlmStageFailureError);
    expect((err as LlmStageFailureError).tally.stage).toBe('spec-scan.settle-areas');
    expect((err as LlmStageFailureError).tally.failures).toBe(1);
    expect(fs.existsSync(corpusFilePath(repo))).toBe(false);
  });
});

describe('the scan run — isolated failures stay fail-open but are reported', () => {
  it('one curate session failed: the corpus is written, the doc is kept, the counts are recorded', async () => {
    const { result } = run((call) =>
      docPathOf(call.briefing) === 'docs/auth.md'
        ? {
            kind: 'failure',
            failure: {
              kind: 'transport',
              detail: 'claude API error (api 429): usage limit reached',
              class: 'provider',
              retryability: 'none',
            },
          }
        : outcome(keepAll()()),
    );
    const res = await result;

    expect(res.stats.llmFailures).toEqual([
      {
        stage: 'spec-scan.curate-doc',
        attempts: 3,
        failures: 1,
        firstError: expect.stringContaining('usage limit reached'),
      },
    ]);
    // Fail-open: the affected doc is KEPT, never silently dropped.
    expect(res.corpus.docs.map((d) => d.ref)).toContain('docs/auth.md');
    expect(res.skippedDocs.map((s) => s.path)).not.toContain('docs/auth.md');
    expect(res.stats.classifyFailed).toBe(1);
    expect(readCorpus(repo)).not.toBeNull();
  });

  it('a clean run reports no failures', async () => {
    const res = await run(() => outcome(keepAll()())).result;
    expect(res.stats.llmFailures).toEqual([]);
    expect(res.noChanges).toBe(false);
  });
});

describe('the scan run — what is NOT a transport failure', () => {
  it('a cache-hit-only re-run starts no session, so it is healthy', async () => {
    const first = await run(() => outcome(keepAll()())).result;
    expect(first.stats.llmFailures).toEqual([]);

    // Same docs, same content hashes: every kind resolves from cache. Resolving
    // the driver at all would throw — zero attempts must NOT read as a failure.
    const second = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => {
        throw new Error('the cached run must not resolve a driver');
      },
      persistence: memoryPersistence().persistence,
      docSource: () => DOCS,
      decisions: EMPTY_DECISIONS,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(second.stats.llmFailures).toEqual([]);
    expect(second.noChanges).toBe(true);
    expect(second.corpus.docs).toHaveLength(DOCS.length);
  });

  it('a MALFORMED total loss falls open instead of aborting — the corpus is written', async () => {
    // The provider answered every session; the model never produced a valid
    // outcome. That is not a transport failure, so the one-abort rule stays out
    // of it: every doc is kept untagged and the loss is tallied.
    const res = await run(() => malformedFailure('outcome failed schema')).result;

    expect(res.stats.llmFailures).toEqual([
      {
        stage: 'spec-scan.curate-doc',
        attempts: 3,
        failures: 3,
        firstError: expect.stringContaining('outcome failed schema'),
      },
    ]);
    expect(res.corpus.docs.map((d) => d.ref)).toEqual(expect.arrayContaining(['docs/auth.md']));
    expect(readCorpus(repo)).not.toBeNull();
  });

  it('a settlement refused for its own reasons never aborts a healthy scan', async () => {
    const script: StubScript = async (call: StubCall) => {
      if (call.kind !== 'spec-scan.settle-areas') {
        return outcome(keepAll(docPathOf(call.briefing).includes('auth') ? 'auth' : 'orders')());
      }
      await call.emit(toolResult('check_settlement', 'valid'));
      return malformedFailure('the settlement never arrived');
    };
    const res = await run(script).result;

    expect(res.stats.llmFailures).toEqual([
      expect.objectContaining({ stage: 'spec-scan.settle-areas', attempts: 1, failures: 1 }),
    ]);
    // Labels are kept as-is; the corpus still lands.
    expect(readCorpus(repo)).not.toBeNull();
    expect(res.corpus.areas.map((a) => a.id).sort()).toEqual(['core/auth', 'core/orders']);
  });
});
