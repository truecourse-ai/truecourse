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
    expect(result.catalog.source).toEqual({ cli: 'tree', api: 'tree' });
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

    expect(result.catalog.source).toEqual({ cli: 'probes', api: 'tree' });
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

  it('maps api journeys from route registrations alongside the cli surface', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/cli.ts': COMMANDER_CLI,
      'src/server.ts': `
        import express from 'express'
        const app = express()
        app.get('/health', getHealth)
        app.post('/deploys', createDeploy)
        app.listen(3000)
      `,
    });

    const result = await mapJourneys(repo, { probeExec: null });
    expect(result.catalog.source).toEqual({ cli: 'tree', api: 'tree' });
    expect(result.catalog.journeys.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/deploy',
      'cli/status',
      'api/post-deploys',
      'api/get-health',
    ]);
    expect(Object.keys(result.fingerprints).sort()).toEqual(['api', 'cli']);
  });

  it('unions the corpus-kept OpenAPI doc into the api catalog and marks unrouted operations specOnly', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/server.ts': `
        import express from 'express'
        const app = express()
        app.get('/health', getHealth)
        app.listen(3000)
      `,
      'docs/openapi.yaml': [
        'openapi: 3.0.0',
        'info: { title: shipit, version: 1.0.0 }',
        'paths:',
        '  /health:',
        '    get: { operationId: getHealth, responses: { "200": { description: ok } } }',
        '  /deploys:',
        '    post: { operationId: createDeploy, responses: { "201": { description: created } } }',
      ].join('\n'),
      '.truecourse/specs/corpus.json': JSON.stringify({
        docs: [{ ref: 'docs/openapi.yaml' }],
      }),
    });

    const result = await mapJourneys(repo, { probeExec: null });
    const api = result.catalog.journeys.filter((j) => j.type === 'api');
    expect(api.map((j) => [j.id, j.specOnly ?? false])).toEqual([
      ['api/post-deploys', true],
      ['api/get-health', false],
    ]);
  });

  it('an unreadable corpus doc costs nothing — the api catalog still derives from routes', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/server.ts': `
        import express from 'express'
        const app = express()
        app.get('/health', getHealth)
      `,
      '.truecourse/specs/corpus.json': JSON.stringify({ docs: [{ ref: 'docs/missing.yaml' }] }),
    });

    const result = await mapJourneys(repo, { probeExec: null });
    expect(result.catalog.journeys.map((j) => j.id)).toEqual(['api/get-health']);
  });
});

describe('mapJourneys — guard-fixture-api acceptance', () => {
  it('derives the api catalog from the fixture OpenAPI doc alone, nothing marked specOnly', async () => {
    // The fixture server is framework-free node:http — the route extractors see
    // nothing, so the whole surface comes from the committed OpenAPI doc and the
    // specOnly cross-check must stay silent (no code-side routes to cross-check).
    fs.cpSync(path.join(__dirname, '../fixtures/guard-fixture-api'), repo, { recursive: true });
    writeRepo({
      '.truecourse/specs/corpus.json': JSON.stringify({ docs: [{ ref: 'openapi.yaml' }] }),
    });

    const result = await mapJourneys(repo, { probeExec: null });
    const api = result.catalog.journeys.filter((j) => j.type === 'api');
    expect(api.map((j) => j.id)).toEqual([
      'api/get-health',
      'api/get-todos',
      'api/post-todos',
      'api/delete-todos-id',
      'api/get-todos-id',
      'api/patch-todos-id',
    ]);
    expect(api.every((j) => j.specOnly === undefined)).toBe(true);
    expect(api.map((j) => j.steps[0].label)).toEqual([
      'getHealth',
      'listTodos',
      'createTodo',
      'deleteTodo',
      'getTodo',
      'updateTodo',
    ]);
    expect(result.fingerprints.api).toMatch(/^sha256:[0-9a-f]{64}$/);
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
