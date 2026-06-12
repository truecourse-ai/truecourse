import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CanonicalSpecMissingError,
  canonicalFromClaims,
  generateContracts,
  generateContractsInMemory,
  type SliceRunner,
} from '../../packages/contract-extractor/src/index.js';
import type { ClaimsFile } from '../../packages/spec-consolidator/src/claims-store.js';

/**
 * The orchestrator end-to-end against the canonical spec at
 * `.truecourse/specs/claims.json`: read → cache → runner stub →
 * merger → validator → writer. The runner is stubbed so no Claude
 * Code subprocesses run during tests.
 */

describe('contract extractor — orchestrator', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-orch-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /**
   * Write a minimal `claims.json` snapshot with one module + one
   * endpoint claim, mimicking what the consolidator produces. The
   * second-module variant adds another shipped module so multi-module
   * traversal can be exercised.
   */
  function writeCanonical(opts: {
    modules?: Array<{
      name: string;
      status?: 'shipped' | 'out-of-scope' | 'planned' | 'deferred' | 'deprecated';
      subject: string;
    }>;
  } = {}): void {
    const modules = opts.modules ?? [
      { name: 'orders', status: 'shipped' as const, subject: 'POST /api/orders' },
    ];
    const claimsFile: ClaimsFile = {
      version: 1,
      generatedAt: '2026-05-22T00:00:00Z',
      modules: modules.map((m) => ({
        name: m.name,
        status: m.status ?? 'shipped',
        sourceDocs: ['docs/source.md'],
        scope: { paths: [`/api/${m.name}/**`] },
      })),
      claims: modules
        .filter((m) => (m.status ?? 'shipped') !== 'out-of-scope')
        .map((m, idx) => ({
          id: `claim-${idx}`,
          module: m.name,
          source: 'extracted',
          topic: 'endpoints',
          subject: m.subject,
          content: { method: m.subject.split(' ')[0], path: m.subject.split(' ')[1] },
          kind: 'definition',
          provenance: { file: 'docs/source.md', line: 1, quote: m.subject },
          metadata: { docKind: 'spec', lastTouched: '2026-05-22T00:00:00Z' },
        })),
    };
    const dir = path.join(tmpRoot, '.truecourse', 'specs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claims.json'), JSON.stringify(claimsFile, null, 2));
  }

  /** Stub runner: returns one Operation + one Entity fragment per slice. */
  function stubRunner(): SliceRunner {
    return async (slices) =>
      slices.map((slice) => {
        const opName = slice.headingPath.join('/');
        const originPath = `"${slice.specPath}"`;
        const tcSource = [
          `operation POST "/api/${opName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}" {`,
          `  origin ${originPath} "${opName}" ${slice.lineRange[0]}..${slice.lineRange[1]}`,
          `  response 201 on success {`,
          `    body Entity:Order`,
          `  }`,
          `  tags []`,
          `}`,
        ].join('\n');
        return {
          slice,
          result: {
            fragments: [
              {
                kind: 'Operation',
                identity: `POST /api/${opName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
                tcSource,
                origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
                obligationKeys: [],
              },
              {
                kind: 'Entity',
                identity: `Order_${opName.replace(/[^a-z0-9]/gi, '_')}`,
                tcSource: `entity Order_${opName.replace(/[^a-z0-9]/gi, '_')} {\n  origin ${originPath} "Order" 1..2\n  field id: string immutable\n}`,
                origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
                obligationKeys: [],
              },
            ],
          },
          durationMs: 1,
        };
      });
  }

  it('runs end-to-end and writes .tc files from claims.json', async () => {
    writeCanonical();

    const result = await generateContracts({ repoRoot: tmpRoot, runner: stubRunner(), disableRepair: true });

    // Successful runs may surface SOFT validation issues (unresolved
    // cross-references between disjoint slices); those don't block
    // the write. Only HARD issues are a failure signal.
    const hardIssues = result.validationIssues.filter((i) => i.severity === 'hard');
    expect(hardIssues).toEqual([]);
    expect(result.write.written.length).toBeGreaterThan(0);
    const opFile = result.write.written.find((f) => f.includes('operations'));
    expect(opFile).toBeDefined();
    expect(fs.existsSync(opFile!)).toBe(true);
    const wrote = fs.readFileSync(opFile!, 'utf-8');
    expect(wrote).toContain('operation POST');
  });

  it('hits the cache on the second run with no spec changes', async () => {
    writeCanonical();

    const runner = stubRunner();
    let calls = 0;
    const countingRunner: SliceRunner = async (slices) => {
      calls++;
      return runner(slices);
    };

    await generateContracts({ repoRoot: tmpRoot, runner: countingRunner, disableRepair: true });
    expect(calls).toBe(1);

    await generateContracts({ repoRoot: tmpRoot, runner: countingRunner, disableRepair: true });
    expect(calls).toBe(1); // second call hit cache → runner not invoked
  });

  it('honours --diff mode: no writes, returns proposed paths', async () => {
    writeCanonical();

    const result = await generateContracts({
      repoRoot: tmpRoot,
      runner: stubRunner(),
      dryRun: true,
      disableRepair: true,
    });
    expect(result.write.written).toEqual([]);
    expect(result.write.proposed.length).toBeGreaterThan(0);

    const contractsDir = path.join(tmpRoot, '.truecourse', 'contracts');
    expect(fs.existsSync(contractsDir)).toBe(false);
  });

  it('blocks the write when validation fails', async () => {
    writeCanonical();

    const badRunner: SliceRunner = async (slices) =>
      slices.map((slice) => ({
        slice,
        result: {
          fragments: [
            {
              kind: 'Operation',
              identity: 'POST /api/x',
              tcSource: 'this is not valid tc syntax',
              origin: { source: slice.specPath, section: 'x', lines: slice.lineRange },
              obligationKeys: [],
            },
          ],
        },
        durationMs: 1,
      }));

    const result = await generateContracts({ repoRoot: tmpRoot, runner: badRunner, disableRepair: true });
    expect(result.validationIssues.length).toBeGreaterThan(0);
    expect(result.write.written).toEqual([]);
  });

  it('throws CanonicalSpecMissingError when claims.json is absent', async () => {
    await expect(
      generateContracts({ repoRoot: tmpRoot, runner: stubRunner(), disableRepair: true }),
    ).rejects.toThrow(CanonicalSpecMissingError);
  });

  it('walks every (module, topic) group in claims.json', async () => {
    writeCanonical({
      modules: [
        { name: 'orders', subject: 'POST /api/orders' },
        { name: 'auth', subject: 'GET /api/auth/me' },
      ],
    });

    const seen: string[] = [];
    const observingRunner: SliceRunner = async (slices) => {
      for (const s of slices) seen.push(s.headingPath.join('/'));
      return stubRunner()(slices);
    };

    await generateContracts({ repoRoot: tmpRoot, runner: observingRunner, disableRepair: true });
    expect(seen).toContain('orders/endpoints');
    expect(seen).toContain('auth/endpoints');
  });

  it('skips modules whose manifest declares status: out-of-scope', async () => {
    writeCanonical({
      modules: [
        { name: 'orders', subject: 'POST /api/orders' },
        { name: 'legacy', status: 'out-of-scope', subject: 'GET /legacy/old' },
      ],
    });

    const seen: string[] = [];
    const observingRunner: SliceRunner = async (slices) => {
      for (const s of slices) seen.push(s.headingPath.join('/'));
      return stubRunner()(slices);
    };
    await generateContracts({ repoRoot: tmpRoot, runner: observingRunner, disableRepair: true });
    expect(seen.some((p) => p.startsWith('legacy/'))).toBe(false);
    expect(seen.some((p) => p.startsWith('orders/'))).toBe(true);
  });

  // --- In-memory generation (the enterprise workspace path) ------------------

  it('generateContractsInMemory yields the SAME corpus as the disk path (no scratch tree)', async () => {
    writeCanonical({
      modules: [
        { name: 'orders', subject: 'POST /api/orders' },
        { name: 'auth', subject: 'GET /api/auth/me' },
      ],
    });
    const disk = await generateContracts({ repoRoot: tmpRoot, runner: stubRunner(), disableRepair: true });

    const claimsFile = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.truecourse', 'specs', 'claims.json'), 'utf-8'),
    ) as ClaimsFile;
    const memScope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mem-'));
    const mem = await generateContractsInMemory({
      canonical: canonicalFromClaims(claimsFile),
      cacheScope: memScope,
      runner: stubRunner(),
      disableRepair: true,
    });
    fs.rmSync(memScope, { recursive: true, force: true });

    const contractsRoot = path.join(tmpRoot, '.truecourse', 'contracts');
    const diskRel = disk.write.written
      .map((f) => path.relative(contractsRoot, f).split(path.sep).join('/'))
      .sort();
    // Same set of files...
    expect(Object.keys(mem.files).sort()).toEqual(diskRel);
    expect(diskRel.length).toBeGreaterThan(0);
    // ...with byte-identical content.
    for (const rel of Object.keys(mem.files)) {
      expect(mem.files[rel]).toBe(fs.readFileSync(path.join(contractsRoot, rel), 'utf-8'));
    }
    // No scratch tree was created anywhere outside the explicit cache scope.
    expect(fs.existsSync(path.join(memScope, '.truecourse', 'contracts'))).toBe(false);
  });

  it('generateContractsInMemory returns an empty corpus when every module is out-of-scope', async () => {
    const claimsFile: ClaimsFile = {
      version: 1,
      generatedAt: '2026-05-22T00:00:00Z',
      modules: [{ name: 'legacy', status: 'out-of-scope', sourceDocs: [], scope: { paths: [] } }],
      claims: [],
    };
    const memScope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mem-'));
    const mem = await generateContractsInMemory({
      canonical: canonicalFromClaims(claimsFile),
      cacheScope: memScope,
      runner: stubRunner(),
      disableRepair: true,
    });
    fs.rmSync(memScope, { recursive: true, force: true });
    expect(mem.files).toEqual({});
  });
});
