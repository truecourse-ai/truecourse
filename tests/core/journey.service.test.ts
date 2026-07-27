/**
 * `mapJourneys` — the core wrapper that analyzes the working tree, derives the
 * journey catalog, and snapshots it to `.truecourse/guard/journeys.json`. Free and
 * deterministic: no LLM, no analyze store, no prior `truecourse analyze` run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapJourneys, journeyTypeFingerprints } from '../../packages/core/src/services/journey.service';
import { ensureRepoTruecourseDir } from '../../packages/core/src/config/paths';
import type { JourneysFile } from '../../packages/shared/src/index';

const COMMANDER_CLI = `
import { Command } from 'commander'
import { runDeploy, runStatus } from './deploy.js'

const program = new Command()
program.name('shipit').version('2.4.0')

program
  .command('deploy <service>')
  .description('Deploy a service to an environment')
  .option('-e, --env <name>', 'Target environment')
  .action(runDeploy)

program
  .command('status')
  .description('Show the current rollout status')
  .option('--json', 'Emit machine-readable JSON')
  .action(runStatus)

const configCmd = program.command('config').description('Inspect deploy configuration')
configCmd.command('get <key>').action(printConfig)

program.parse(process.argv)
`;

/** A hand-rolled argv switch — a real CLI shape no framework extractor reads. */
const HAND_ROLLED_CLI = `
const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case 'deploy':
    deploy(rest)
    break
  case 'status':
    status(rest)
    break
  default:
    console.log('usage: shipit <deploy|status>')
    process.exit(1)
}
`;

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-journeys-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function writeRepo(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(repo, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function readSnapshot(): JourneysFile {
  return JSON.parse(fs.readFileSync(path.join(repo, '.truecourse/guard/journeys.json'), 'utf-8'));
}

describe('mapJourneys', () => {
  it('derives the catalog from the tree and writes the snapshot', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit', bin: { shipit: 'dist/cli.js' } }),
      'src/cli.ts': COMMANDER_CLI,
    });

    const result = await mapJourneys(repo, { probeExec: null });

    expect(result.snapshotPath).toBe(path.join(repo, '.truecourse/guard/journeys.json'));
    expect(result.catalog.version).toBe(1);
    expect(result.catalog.source).toEqual({ cli: 'tree' });
    expect(result.catalog.journeys.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/deploy',
      'cli/status',
    ]);
    expect(result.catalog.recipeFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Date(result.catalog.generatedAt).toString()).not.toBe('Invalid Date');

    expect(readSnapshot()).toEqual(result.catalog);
  });

  it('fingerprints each surface over its journey set, order-independently', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/cli.ts': COMMANDER_CLI,
    });

    const result = await mapJourneys(repo, { probeExec: null });
    expect(Object.keys(result.fingerprints)).toEqual(['cli']);
    expect(result.fingerprints.cli).toMatch(/^sha256:[0-9a-f]{64}$/);

    const shuffled = [...result.catalog.journeys].reverse();
    expect(journeyTypeFingerprints(shuffled).cli).toBe(result.fingerprints.cli);

    // A surface change moves it.
    expect(journeyTypeFingerprints(result.catalog.journeys.slice(1)).cli).not.toBe(
      result.fingerprints.cli,
    );
  });

  it('rewrites the snapshot on every mapping', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/cli.ts': COMMANDER_CLI,
    });
    await mapJourneys(repo, { probeExec: null });

    writeRepo({
      'src/cli.ts': COMMANDER_CLI.replace(
        `program.parse(process.argv)`,
        `program.command('rollback').description('Roll back the last deploy').action(runRollback)\nprogram.parse(process.argv)`,
      ),
    });
    const second = await mapJourneys(repo, { probeExec: null });

    expect(second.catalog.journeys.map((j) => j.id)).toContain('cli/rollback');
    expect(readSnapshot().journeys.map((j) => j.id)).toContain('cli/rollback');
  });

  it('falls back to probing the recipe entry when the tree finds no commands', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: '@acme/shipit', bin: { shipit: 'dist/cli.js' } }),
      'src/cli.js': HAND_ROLLED_CLI,
      'dist/cli.js': HAND_ROLLED_CLI,
      '.truecourse/scenarios/recipe.json': JSON.stringify({
        build: 'npm run build',
        entry: ['node', 'dist/cli.js'],
      }),
    });

    const probed: string[][] = [];
    const result = await mapJourneys(repo, {
      probeExec: async (argv) => {
        probed.push([...argv].slice(2));
        const args = [...argv].slice(2).join(' ');
        const help = `Usage: shipit <command>\n\nCommands:\n  deploy   Deploy a service\n  status   Show the rollout status\n`;
        if (args === '' || args === '--help') return { stdout: help, stderr: '', exitCode: 0 };
        if (args === 'deploy --help') {
          return { stdout: 'Usage: shipit deploy\n\nOptions:\n  --env <name>  Target environment\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 1 };
      },
    });

    expect(result.catalog.source).toEqual({ cli: 'probes' });
    expect(result.catalog.journeys.map((j) => j.id)).toEqual(['cli/deploy', 'cli/status']);
    expect(result.catalog.journeys[0].steps[0]).toMatchObject({ flags: ['--env'] });
    // The entry the recipe declares, resolved to the built artifact.
    expect(probed[0]).toEqual([]);
    expect(probed[1]).toEqual(['--help']);
  });

  it('writes an empty catalog — never an error — for a repo with no cli surface', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'reporting' }),
      'src/report.ts': `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    });

    const result = await mapJourneys(repo, { probeExec: null });
    expect(result.catalog.journeys).toEqual([]);
    expect(result.fingerprints).toEqual({});
    expect(readSnapshot().journeys).toEqual([]);
  });

  it('does not probe when the repo declares no recipe entry', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'reporting' }),
      'src/cli.js': HAND_ROLLED_CLI,
    });

    let probes = 0;
    const result = await mapJourneys(repo, {
      probeExec: async () => {
        probes++;
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });
    expect(probes).toBe(0);
    expect(result.catalog.journeys).toEqual([]);
  });

  it('maps caller-supplied analyses without re-analyzing the tree', async () => {
    writeRepo({ 'package.json': JSON.stringify({ name: 'shipit' }) });
    const { analyzeFileContent } = await import('../../packages/analyzer/src/file-analyzer');

    const result = await mapJourneys(repo, {
      fileAnalyses: [analyzeFileContent('src/cli.ts', COMMANDER_CLI, 'typescript')],
      probeExec: null,
    });
    expect(result.catalog.journeys.map((j) => j.id)).toContain('cli/deploy');
  });
});

describe('the journey snapshot is gitignored', () => {
  it('lists guard/journeys.json in the store .gitignore', () => {
    writeRepo({ 'package.json': '{}' });
    const dir = ensureRepoTruecourseDir(repo);
    const ignored = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').split('\n');
    expect(ignored).toContain('guard/journeys.json');
  });
});
