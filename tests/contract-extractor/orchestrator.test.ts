import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CanonicalSpecMissingError,
  generateContracts,
  type SliceRunner,
} from '../../packages/contract-extractor/src/index.js';

/**
 * The orchestrator end-to-end against the canonical spec at
 * `.truecourse/specs/`: section files → slicer → cache → runner stub →
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
   * Write a minimal canonical spec — one module with one section
   * file and a module.yaml. Mimics what the consolidator produces.
   */
  function writeCanonical(opts: {
    moduleName?: string;
    sectionName?: string;
    body?: string;
  } = {}): void {
    const moduleName = opts.moduleName ?? 'orders';
    const sectionName = opts.sectionName ?? 'endpoints.md';
    const body =
      opts.body ??
      ['# Endpoints', '## Operations', '### Orders', 'Body.'].join('\n');
    const moduleDir = path.join(tmpRoot, '.truecourse', 'specs', 'modules', moduleName);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, sectionName), body);
    fs.writeFileSync(
      path.join(moduleDir, 'module.yaml'),
      [
        `name: ${moduleName}`,
        `status: shipped`,
        `sourceDocs:`,
        `  - docs/source.md`,
        `scope:`,
        `  paths:`,
        `    - /api/${moduleName}/**`,
      ].join('\n') + '\n',
    );
  }

  /** Stub runner: returns one Operation + one Entity fragment per slice. */
  function stubRunner(): SliceRunner {
    return async (slices) =>
      slices.map((slice) => {
        const opName = slice.headingPath.at(-1)!;
        // Canonical-spec paths start with `.truecourse/...` so they
        // need quoting in the origin grammar.
        const originPath = `"${slice.specPath}"`;
        const tcSource = [
          `operation POST "/api/${opName.toLowerCase()}" {`,
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
                identity: `POST /api/${opName.toLowerCase()}`,
                tcSource,
                origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
                obligationKeys: [],
              },
              {
                kind: 'Entity',
                identity: 'Order',
                tcSource: `entity Order {\n  origin ${originPath} "Order" 1..2\n  field id: string immutable\n}`,
                origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
                obligationKeys: [],
              },
            ],
          },
          durationMs: 1,
        };
      });
  }

  it('runs end-to-end and writes .tc files from the canonical spec', async () => {
    writeCanonical();

    const result = await generateContracts({ repoRoot: tmpRoot, runner: stubRunner() });

    expect(result.validationIssues).toEqual([]);
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

    await generateContracts({ repoRoot: tmpRoot, runner: countingRunner });
    expect(calls).toBe(1);

    await generateContracts({ repoRoot: tmpRoot, runner: countingRunner });
    expect(calls).toBe(1); // second call hit cache → runner not invoked
  });

  it('honours --diff mode: no writes, returns proposed paths', async () => {
    writeCanonical();

    const result = await generateContracts({
      repoRoot: tmpRoot,
      runner: stubRunner(),
      dryRun: true,
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

    const result = await generateContracts({ repoRoot: tmpRoot, runner: badRunner });
    expect(result.validationIssues.length).toBeGreaterThan(0);
    expect(result.write.written).toEqual([]);
  });

  it('throws CanonicalSpecMissingError when .truecourse/specs/ is absent', async () => {
    await expect(
      generateContracts({ repoRoot: tmpRoot, runner: stubRunner() }),
    ).rejects.toThrow(CanonicalSpecMissingError);
  });

  it('walks every module section file under .truecourse/specs/', async () => {
    writeCanonical({ moduleName: 'orders' });
    // Add a second module with a different section file.
    fs.mkdirSync(
      path.join(tmpRoot, '.truecourse', 'specs', 'modules', 'auth'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(tmpRoot, '.truecourse', 'specs', 'modules', 'auth', 'auth.md'),
      ['# Authentication', '## Bearer', 'Bearer JWT.'].join('\n'),
    );
    fs.writeFileSync(
      path.join(tmpRoot, '.truecourse', 'specs', 'modules', 'auth', 'module.yaml'),
      `name: auth\nstatus: shipped\nsourceDocs: []\nscope:\n  paths:\n    - /api/auth/**\n`,
    );

    const seen: string[] = [];
    const observingRunner: SliceRunner = async (slices) => {
      for (const s of slices) seen.push(s.specPath);
      return stubRunner()(slices);
    };

    await generateContracts({ repoRoot: tmpRoot, runner: observingRunner });
    expect(seen.some((p) => p.startsWith('.truecourse/specs/modules/orders/'))).toBe(true);
    expect(seen.some((p) => p.startsWith('.truecourse/specs/modules/auth/'))).toBe(true);
  });

  it('skips modules whose manifest declares status: out-of-scope', async () => {
    writeCanonical({ moduleName: 'orders' });
    // Add a module marked out-of-scope. Its sections must not produce slices.
    const oosDir = path.join(tmpRoot, '.truecourse', 'specs', 'modules', 'legacy');
    fs.mkdirSync(oosDir, { recursive: true });
    fs.writeFileSync(
      path.join(oosDir, 'endpoints.md'),
      '# Legacy\n## OldOp\nbody\n',
    );
    fs.writeFileSync(
      path.join(oosDir, 'module.yaml'),
      `name: legacy\nstatus: out-of-scope\nsourceDocs: []\nscope:\n  paths:\n    - /legacy/**\n`,
    );

    const seen: string[] = [];
    const observingRunner: SliceRunner = async (slices) => {
      for (const s of slices) seen.push(s.specPath);
      return stubRunner()(slices);
    };
    await generateContracts({ repoRoot: tmpRoot, runner: observingRunner });
    expect(seen.some((p) => p.includes('modules/legacy/'))).toBe(false);
  });

  it('also reads shared/ section files (cross-cutting)', async () => {
    writeCanonical();
    const sharedDir = path.join(tmpRoot, '.truecourse', 'specs', 'shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, 'auth.md'),
      '# Auth\n## Scheme\nBearer JWT.\n',
    );

    const seen: string[] = [];
    const observingRunner: SliceRunner = async (slices) => {
      for (const s of slices) seen.push(s.specPath);
      return stubRunner()(slices);
    };
    await generateContracts({ repoRoot: tmpRoot, runner: observingRunner });
    expect(seen.some((p) => p.startsWith('.truecourse/specs/shared/'))).toBe(true);
  });
});
