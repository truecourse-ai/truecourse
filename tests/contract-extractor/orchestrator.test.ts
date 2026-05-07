import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateContracts,
  type SliceRunner,
} from '../../packages/contract-extractor/src/index.js';

/**
 * The orchestrator end-to-end: spec on disk → slicer → cache → runner stub →
 * merger → validator → writer. The runner is stubbed so no Claude Code
 * subprocesses run during tests.
 */

describe('contract extractor — orchestrator', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-orch-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeSpec(contents: string): void {
    fs.writeFileSync(path.join(tmpRoot, 'SPEC.md'), contents);
  }

  function writeConfig(): void {
    const yamlPath = path.join(tmpRoot, '.truecourse', 'specs.yaml');
    fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
    fs.writeFileSync(yamlPath, 'specs:\n  - file: SPEC.md\n    rank: 0\n');
  }

  /** Stub runner: returns one Operation fragment per slice, plus origin lines. */
  function stubRunner(): SliceRunner {
    return async (slices) =>
      slices.map((slice) => {
        const opName = slice.headingPath.at(-1)!;
        const tcSource = [
          `operation POST "/api/${opName.toLowerCase()}" {`,
          `  origin ${slice.specPath} "${opName}" ${slice.lineRange[0]}..${slice.lineRange[1]}`,
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
                tcSource: 'entity Order {\n  origin SPEC.md "Order" 1..2\n  field id: string immutable\n}',
                origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
                obligationKeys: [],
              },
            ],
          },
          durationMs: 1,
        };
      });
  }

  it('runs end-to-end and writes .tc files', async () => {
    writeSpec(['# Spec', '## Operations', '### Orders', 'Body.'].join('\n'));
    writeConfig();

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
    writeSpec(['# Spec', '## Operations', '### Orders', 'Body.'].join('\n'));
    writeConfig();

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
    writeSpec(['# Spec', '## Operations', '### Orders', 'Body.'].join('\n'));
    writeConfig();

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
    writeSpec(['# Spec', '## Operations', '### Orders', 'Body.'].join('\n'));
    writeConfig();

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

  it('throws ConfigMissingError when no specs.yaml exists', async () => {
    writeSpec('# Spec\n');
    await expect(
      generateContracts({ repoRoot: tmpRoot, runner: stubRunner() }),
    ).rejects.toThrow(/specs\.yaml/);
  });

  it('layers higher-rank specs over lower-rank ones', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'SPEC.md'), '# Spec\n## Auth\nBase auth.\n');
    fs.writeFileSync(path.join(tmpRoot, 'OVERRIDE.md'), '# Spec\n## Auth\nOverridden auth.\n');

    // Two specs, OVERRIDE.md at higher rank.
    const config = {
      specs: [
        { file: 'SPEC.md', rank: 0 },
        { file: 'OVERRIDE.md', rank: 2 },
      ],
    };

    // Stub runner: each slice produces one Entity:Foo fragment whose
    // tcSource includes the slice's source-spec filename so we can tell
    // which one wins.
    const runner = async (slices: any[]) =>
      slices.map((slice) => ({
        slice,
        result: {
          fragments: [
            {
              kind: 'Entity',
              identity: 'Foo',
              tcSource: `entity Foo {\n  origin ${slice.specPath} "Auth" 1..10\n  field src: string immutable\n}\n  // src=${slice.specPath}`,
              origin: { source: slice.specPath, section: 'Auth', lines: slice.lineRange },
              obligationKeys: [],
            },
          ],
        },
        durationMs: 1,
      }));

    const result = await generateContracts({ repoRoot: tmpRoot, runner: runner as any, config });
    expect(result.validationIssues).toEqual([]);

    // The higher-rank fragment's tcSource should be on disk.
    const writtenFooFile = result.write.written.find((f) => /foo\.tc$/.test(f));
    expect(writtenFooFile).toBeDefined();
    const onDisk = fs.readFileSync(writtenFooFile!, 'utf-8');
    expect(onDisk).toContain('// src=OVERRIDE.md');
    expect(onDisk).toContain('overridden by rank 2');     // origin lineage stack
  });
});
