/**
 * Corpus generate end-to-end with stub runners: enumerate → batch generate →
 * completeness gate → shared assemble tail → write. No Claude subprocesses.
 * Exercises batching, the enumerate cache, the retry-the-misses gate, residual
 * gap reporting, and cross-area identity dedup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  generateContractsFromCorpus,
  chunkByHeading,
  type AreaGenInput,
  type EnumerateRunner,
  type GenerateBatchRunner,
  type TargetSpec,
  type Fragment,
} from '../../packages/contract-extractor/src/index.js';

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-corpgen-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function areaInput(areaId: string, refs: string[]): AreaGenInput {
  const slash = areaId.indexOf('/');
  return {
    areaId,
    product: areaId.slice(0, slash),
    concern: areaId.slice(slash + 1),
    docs: refs.map((ref, i) => ({
      ref,
      content: `# ${ref}\nbody`,
      lastTouched: `2026-0${i + 1}-01T00:00:00Z`,
      status: 'shipped' as const,
      kind: 'prd' as const,
    })),
  };
}

/** A valid, self-contained Entity fragment for a target identity. */
function entityFragment(src: string, identity: string): Fragment {
  return {
    kind: 'Entity',
    identity,
    tcSource: `entity ${identity} {\n  origin "${src}" "${identity}" 1..2\n  field id: string immutable\n}`,
    origin: { source: src, section: identity, lines: [1, 2] },
    obligationKeys: [],
  };
}

/** Enumerate stub: each area declares the given entity targets. */
function enumerateStub(targetsByArea: Record<string, string[]>): EnumerateRunner {
  return async ({ area }) => (targetsByArea[area.areaId] ?? []).map((identity): TargetSpec => ({ kind: 'Entity', identity }));
}

/** Generate stub: emits a valid entity per requested target. */
const generateAll: GenerateBatchRunner = async ({ area, targets }) => ({
  fragments: targets.map((t) => entityFragment(area.docs[0]?.ref ?? area.areaId, t.identity)),
});

describe('generateContractsFromCorpus', () => {
  it('generates a contract for every enumerated target and writes them', async () => {
    const corpusInput = [areaInput('core/users-entity', ['users.md'])];
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput,
      enumerateRunner: enumerateStub({ 'core/users-entity': ['User', 'Account', 'Session'] }),
      generateRunner: generateAll,
      disableRepair: true,
      disableTargetReconciliation: true,
    });

    expect(result.validationIssues.filter((i) => i.severity === 'hard')).toEqual([]);
    expect(result.artifactsToWrite.map((a) => a.identity).sort()).toEqual(['Account', 'Session', 'User']);
    expect(result.write.written.length).toBeGreaterThan(0);
    expect(result.areas[0]).toMatchObject({ areaId: 'core/users-entity', targets: 3, emitted: 3 });
    expect(result.gaps).toEqual([]);
  });

  it('batches targets by batchSize', async () => {
    const batchSizes: number[] = [];
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      batchSizes.push(targets.length);
      return generateAll({ area, targets });
    };
    await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['A', 'B', 'C', 'D', 'E'] }),
      generateRunner,
      batchSize: 2,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    // 5 targets, batchSize 2 → 2 + 2 + 1.
    expect(batchSizes).toEqual([2, 2, 1]);
  });

  it('completeness gate retries the misses in focused calls', async () => {
    // The stub omits "Session" whenever it appears in a multi-target batch
    // (round 0), but emits it in a focused single-target retry (round 1).
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => ({
      fragments: targets
        .filter((t) => !(t.identity === 'Session' && targets.length > 1))
        .map((t) => entityFragment(area.docs[0].ref, t.identity)),
    });
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/users-entity', ['users.md'])],
      enumerateRunner: enumerateStub({ 'core/users-entity': ['User', 'Session', 'Token'] }),
      generateRunner,
      batchSize: 5,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    expect(result.artifactsToWrite.map((a) => a.identity).sort()).toEqual(['Session', 'Token', 'User']);
    expect(result.gaps).toEqual([]);
  });

  it('reports a residual gap for a target never produced', async () => {
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => ({
      fragments: targets
        .filter((t) => t.identity !== 'Ghost')
        .map((t) => entityFragment(area.docs[0].ref, t.identity)),
    });
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['Real', 'Ghost'] }),
      generateRunner,
      maxRetryRounds: 2,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true, // raw gap reporting, no auto-close
    });
    expect(result.artifactsToWrite.map((a) => a.identity)).toEqual(['Real']);
    expect(result.gaps).toMatchObject([{ areaId: 'core/x', kind: 'Entity', identity: 'Ghost' }]);
  });

  it('gap judge auto-closes a justified gap and keeps a genuine one with a reason', async () => {
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => ({
      fragments: targets
        .filter((t) => t.identity !== 'Ghost' && t.identity !== 'Covered')
        .map((t) => entityFragment(area.docs[0].ref, t.identity)),
    });
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['Real', 'Covered', 'Ghost'] }),
      generateRunner,
      maxRetryRounds: 0,
      disableRepair: true,
      disableTargetReconciliation: true,
      gapJudge: async () => ({
        verdicts: {
          'Entity:Covered': { justified: true, reason: 'written elsewhere' },
          'Entity:Ghost': { justified: false, reason: 'doc requires it, not written' },
        },
      }),
    });
    // Covered is auto-closed; Ghost survives with the judge's reason.
    expect(result.gaps.map((g) => g.identity)).toEqual(['Ghost']);
    expect(result.gaps[0].reason).toContain('not written');
    expect(result.areas[0].gaps.map((g) => g.identity)).toEqual(['Ghost']);
  });

  it('dedups an identity defined in two areas down to one artifact', async () => {
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/a', ['a.md']), areaInput('core/b', ['b.md'])],
      enumerateRunner: enumerateStub({ 'core/a': ['Shared', 'A1'], 'core/b': ['Shared', 'B1'] }),
      generateRunner: generateAll,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    const ids = result.artifactsToWrite.map((a) => a.identity).sort();
    expect(ids).toEqual(['A1', 'B1', 'Shared']);
    expect(ids.filter((i) => i === 'Shared')).toHaveLength(1);
  });

  it('caches enumeration — a second run with unchanged docs does not re-enumerate', async () => {
    let enumCalls = 0;
    const enumerateRunner: EnumerateRunner = async ({ area }) => {
      enumCalls++;
      return [{ kind: 'Entity', identity: 'User' }];
    };
    const corpusInput = [areaInput('core/users-entity', ['users.md'])];
    const opts = { repoRoot: repo, corpusInput, enumerateRunner, generateRunner: generateAll, disableRepair: true };
    await generateContractsFromCorpus(opts);
    expect(enumCalls).toBe(1);
    await generateContractsFromCorpus(opts);
    expect(enumCalls).toBe(1); // served from the enumerate cache
  });

  it('caches extraction — a second run with unchanged docs makes no generate calls', async () => {
    let genCalls = 0;
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      genCalls++;
      return generateAll({ area, targets });
    };
    const opts = {
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['A', 'B'] }),
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true,
      disableManifest: true, // exercise the extract cache, not the manifest no-op skip
    };
    const first = await generateContractsFromCorpus(opts);
    expect(genCalls).toBeGreaterThan(0);
    const afterFirst = genCalls;

    const second = await generateContractsFromCorpus(opts);
    expect(genCalls).toBe(afterFirst); // served from the extract cache — no new LLM calls
    expect(second.artifactsToWrite.map((a) => a.identity).sort()).toEqual(
      first.artifactsToWrite.map((a) => a.identity).sort(),
    );
    expect(second.areas[0]).toMatchObject({ areaId: 'core/x', targets: 2, emitted: 2 });
    expect(second.gaps).toEqual([]);
  });

  it('re-generates an area whose doc content changed (cache key busts)', async () => {
    let genCalls = 0;
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      genCalls++;
      return generateAll({ area, targets });
    };
    const mk = (content: string) => ({
      repoRoot: repo,
      corpusInput: [
        {
          areaId: 'core/x',
          product: 'core',
          concern: 'x',
          docs: [{ ref: 'x.md', content, lastTouched: '2026-01-01T00:00:00Z', status: 'shipped' as const, kind: 'prd' as const }],
        },
      ],
      enumerateRunner: enumerateStub({ 'core/x': ['A'] }),
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true,
    });
    await generateContractsFromCorpus(mk('# X\noriginal body'));
    const afterFirst = genCalls;
    await generateContractsFromCorpus(mk('# X\nCHANGED body'));
    expect(genCalls).toBeGreaterThan(afterFirst); // changed doc → cache miss → regenerate
  });

  it('disableExtractCache re-generates every run', async () => {
    let genCalls = 0;
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      genCalls++;
      return generateAll({ area, targets });
    };
    const opts = {
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['A'] }),
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true,
      disableExtractCache: true,
      disableManifest: true, // also bypass the manifest no-op skip, so it truly re-runs
    };
    await generateContractsFromCorpus(opts);
    const afterFirst = genCalls;
    await generateContractsFromCorpus(opts);
    expect(genCalls).toBeGreaterThan(afterFirst); // cache off → generated again
  });

  it('manifest: a second run with an unchanged corpus is a no-op (noChanges, 0 calls)', async () => {
    let genCalls = 0;
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => {
      genCalls++;
      return generateAll({ area, targets });
    };
    const opts = {
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['A', 'B'] }),
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true,
    };
    const first = await generateContractsFromCorpus(opts);
    expect(first.noChanges).toBeFalsy();
    const afterFirst = genCalls;

    const second = await generateContractsFromCorpus(opts);
    expect(second.noChanges).toBe(true); // manifest matched → whole pipeline skipped
    expect(genCalls).toBe(afterFirst); // 0 LLM calls — not even enumerate
    expect(second.ran).toBe(false);
  });

  it('matches coverage tolerantly across enumerator/generator format drift (no false gap)', async () => {
    // Enumerator lists an Operation with a trailing slash + lowercase method;
    // the generator emits the canonical form. The gate must treat it as covered.
    const enumerateRunner: EnumerateRunner = async () => [{ kind: 'Operation', identity: 'post /api/orders/' }];
    const generateRunner: GenerateBatchRunner = async ({ area }) => ({
      fragments: [
        {
          kind: 'Operation',
          identity: 'POST /api/orders',
          tcSource: `operation POST "/api/orders" {\n  origin "${area.docs[0].ref}" "POST /api/orders" 1..2\n  tags []\n}`,
          origin: { source: area.docs[0].ref, section: 'orders', lines: [1, 2] },
          obligationKeys: [],
        },
      ],
    });
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/orders', ['orders.md'])],
      enumerateRunner,
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    expect(result.gaps).toEqual([]);
    expect(result.artifactsToWrite.map((a) => a.identity)).toEqual(['POST /api/orders']);
  });

  it('chunks a big doc by heading so enumeration sees the tail, not just the first window', async () => {
    // A doc larger than the enumerate budget: section A is huge, section B (with
    // its target marker) is far past any single 40-48k window.
    const bigContent =
      `# A\nMARKER_A\n` + 'x'.repeat(50_000) + `\n# B\nMARKER_B\n` + 'the B section body';
    const area: AreaGenInput = {
      areaId: 'core/big',
      product: 'core',
      concern: 'big',
      docs: [{ ref: 'big.md', content: bigContent, lastTouched: '2026-01-01T00:00:00Z', status: 'shipped', kind: 'prd' }],
    };
    // The enumerator can only report a target whose marker is in the view it sees.
    const enumerateRunner: EnumerateRunner = async ({ area }) => {
      const text = area.docs.map((d) => d.content).join('\n');
      const targets: TargetSpec[] = [];
      if (text.includes('MARKER_A')) targets.push({ kind: 'Entity', identity: 'A' });
      if (text.includes('MARKER_B')) targets.push({ kind: 'Entity', identity: 'B' });
      return targets;
    };
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [area],
      enumerateRunner,
      generateRunner: generateAll,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    // Both A (head) and B (tail) targets were enumerated → both generated.
    expect(result.areas[0].targets).toBe(2);
    expect(result.artifactsToWrite.map((a) => a.identity).sort()).toEqual(['A', 'B']);
  });

  it('does not write when dryRun', async () => {
    const result = await generateContractsFromCorpus({
      repoRoot: repo,
      corpusInput: [areaInput('core/x', ['x.md'])],
      enumerateRunner: enumerateStub({ 'core/x': ['A'] }),
      generateRunner: generateAll,
      dryRun: true,
      disableRepair: true,
      disableTargetReconciliation: true,
    });
    expect(result.write.written).toEqual([]);
    expect(result.write.proposed.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts'))).toBe(false);
  });
});

describe('chunkByHeading', () => {
  it('returns the whole doc when under the cap', () => {
    expect(chunkByHeading('# A\nshort', 1000)).toEqual(['# A\nshort']);
  });
  it('splits at heading boundaries, packing sections under the cap', () => {
    const content = '# A\n' + 'a'.repeat(30) + '\n# B\n' + 'b'.repeat(30) + '\n# C\n' + 'c'.repeat(30);
    const chunks = chunkByHeading(content, 45);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk that contains a heading starts at one (no mid-section splits when sections fit).
    for (const ch of chunks) expect(ch.length).toBeLessThanOrEqual(45 + 4);
    // Round-trips the content (no data lost).
    expect(chunks.join('\n')).toContain('aaaa');
    expect(chunks.join('\n')).toContain('cccc');
  });
  it('hard-splits a single oversized section', () => {
    const content = '# Big\n' + 'x'.repeat(100);
    const chunks = chunkByHeading(content, 40);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(content);
  });
});
