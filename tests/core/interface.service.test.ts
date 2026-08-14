/**
 * `mapInterfaces` — the core wrapper that analyzes the working tree, derives the
 * interface catalog, and snapshots it to `.truecourse/guard/interfaces.json`. Free and
 * deterministic: no LLM, no analyze store, no prior `truecourse analyze` run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapInterfaces, interfaceTypeFingerprints } from '../../packages/core/src/services/interface.service';
import { ensureRepoTruecourseDir } from '../../packages/core/src/config/paths';
import type { InterfacesFile } from '../../packages/shared/src/index';

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
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-interfaces-'));
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

function readSnapshot(): InterfacesFile {
  return JSON.parse(fs.readFileSync(path.join(repo, '.truecourse/guard/interfaces.json'), 'utf-8'));
}

describe('mapInterfaces', () => {
  it('derives the catalog from the tree and writes the snapshot', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit', bin: { shipit: 'dist/cli.js' } }),
      'src/cli.ts': COMMANDER_CLI,
    });

    const result = await mapInterfaces(repo, { probeExec: null });

    expect(result.snapshotPath).toBe(path.join(repo, '.truecourse/guard/interfaces.json'));
    expect(result.catalog.version).toBe(2);
    expect(result.catalog.source).toEqual({ cli: 'tree', api: 'tree' });
    expect(result.catalog.interfaces.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/deploy',
      'cli/status',
    ]);
    expect(result.catalog.recipeFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Date(result.catalog.generatedAt).toString()).not.toBe('Invalid Date');

    expect(readSnapshot()).toEqual(result.catalog);
  });

  it('fingerprints each surface over its interface set, order-independently', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/cli.ts': COMMANDER_CLI,
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(Object.keys(result.fingerprints)).toEqual(['cli']);
    expect(result.fingerprints.cli).toMatch(/^sha256:[0-9a-f]{64}$/);

    const shuffled = [...result.catalog.interfaces].reverse();
    expect(interfaceTypeFingerprints(shuffled).cli).toBe(result.fingerprints.cli);

    // A surface change moves it.
    expect(interfaceTypeFingerprints(result.catalog.interfaces.slice(1)).cli).not.toBe(
      result.fingerprints.cli,
    );
  });

  it('rewrites the snapshot on every mapping', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/cli.ts': COMMANDER_CLI,
    });
    await mapInterfaces(repo, { probeExec: null });

    writeRepo({
      'src/cli.ts': COMMANDER_CLI.replace(
        `program.parse(process.argv)`,
        `program.command('rollback').description('Roll back the last deploy').action(runRollback)\nprogram.parse(process.argv)`,
      ),
    });
    const second = await mapInterfaces(repo, { probeExec: null });

    expect(second.catalog.interfaces.map((j) => j.id)).toContain('cli/rollback');
    expect(readSnapshot().interfaces.map((j) => j.id)).toContain('cli/rollback');
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
    const result = await mapInterfaces(repo, {
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
    expect(result.catalog.interfaces.map((j) => j.id)).toEqual(['cli/deploy', 'cli/status']);
    expect(result.catalog.interfaces[0].steps[0]).toMatchObject({ flags: ['--env'] });
    // The entry the recipe declares, resolved to the built artifact.
    expect(probed[0]).toEqual([]);
    expect(probed[1]).toEqual(['--help']);
  });

  it('writes an empty catalog — never an error — for a repo with no cli surface', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'reporting' }),
      'src/report.ts': `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.catalog.interfaces).toEqual([]);
    expect(result.fingerprints).toEqual({});
    expect(readSnapshot().interfaces).toEqual([]);
  });

  it('does not probe when the repo declares no recipe entry', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'reporting' }),
      'src/cli.js': HAND_ROLLED_CLI,
    });

    let probes = 0;
    const result = await mapInterfaces(repo, {
      probeExec: async () => {
        probes++;
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });
    expect(probes).toBe(0);
    expect(result.catalog.interfaces).toEqual([]);
  });

  it('maps caller-supplied analyses without re-analyzing the tree', async () => {
    writeRepo({ 'package.json': JSON.stringify({ name: 'shipit' }) });
    const { analyzeFileContent } = await import('../../packages/analyzer/src/file-analyzer');

    const result = await mapInterfaces(repo, {
      fileAnalyses: [analyzeFileContent('src/cli.ts', COMMANDER_CLI, 'typescript')],
      probeExec: null,
    });
    expect(result.catalog.interfaces.map((j) => j.id)).toContain('cli/deploy');
  });

  it('maps api interfaces from route registrations alongside the cli surface', async () => {
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

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.catalog.source).toEqual({ cli: 'tree', api: 'tree' });
    expect(result.catalog.interfaces.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/deploy',
      'cli/status',
      'api/post-deploys',
      'api/get-health',
    ]);
    expect(Object.keys(result.fingerprints).sort()).toEqual(['api', 'cli']);
  });

  it('forms both surfaces’ PLACES and points every interface at its own', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit', bin: { shipit: 'dist/cli.js' } }),
      'src/cli.ts': COMMANDER_CLI,
      'src/server.ts': `
        import express from 'express'
        const app = express()
        app.get('/deploys', listDeploys)
        app.get('/deploys/:id', getDeploy)
        app.post('/deploys/:id/rollback', rollbackDeploy)
        app.listen(3000)
      `,
    });

    const result = await mapInterfaces(repo, { probeExec: null });

    // The cli tree: the program's own root group, plus one per parent command.
    // The root is named from `package.json`'s bin key — nothing else knows it.
    expect(result.catalog.resources!.cli).toEqual([
      { id: 'shipit', kind: 'command-group', title: 'shipit' },
      { id: 'config', kind: 'command-group', title: 'shipit config', of: 'shipit' },
    ]);
    // The api tree, with the RPC tail folded into the noun it is issued to.
    expect(result.catalog.resources!.api).toEqual([
      { id: 'deploys', kind: 'rest-noun', title: '/deploys' },
    ]);
    const owner = (id: string) => result.catalog.interfaces.find((j) => j.id === id)!.resource;
    expect(owner('cli/deploy')).toBe('shipit');
    expect(owner('cli/config-get')).toBe('config');
    expect(owner('api/post-deploys-id-rollback')).toBe('deploys');
    expect(owner('api/get-deploys-id')).toBe('deploys');

    // The registry is written to disk with everything else, and re-reads valid.
    expect(readSnapshot().resources).toEqual(result.catalog.resources);
  });

  it('writes the request contract ONTO the operation it belongs to', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'shipit' }),
      'src/server.ts': `
        import express from 'express'
        const app = express()
        app.get('/deploys', (req, res) => {
          const { status, limit } = req.query
          res.json([])
        })
        app.post('/deploys', (req, res) => {
          const { service } = req.body
          if (!req.body.service) return res.status(400).json({ error: 'service required' })
          res.status(201).json({})
        })
        app.listen(3000)
      `,
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    const contractOf = (id: string) => result.catalog.interfaces.find((j) => j.id === id)!.contract;

    // The api member, natively — not a command wearing an argv of ["POST", "/x"].
    const post = contractOf('api/post-deploys')!;
    expect(post.surface).toBe('api');
    if (post.surface !== 'api') throw new Error('not an api contract');
    expect(post.operation.request!.body!.map((f) => f.name)).toEqual(['service']);
    const get = contractOf('api/get-deploys')!;
    if (get.surface !== 'api') throw new Error('not an api contract');
    expect(get.operation.request!.query!.map((f) => f.name)).toEqual(['status', 'limit']);
    expect(get.operation.request!.body).toBeUndefined();

    // …and the catalog is their ONE home: the mapping result no longer carries a
    // second copy for the generator to join by method+path.
    expect('requestContracts' in result).toBe(false);

    // Nothing else is invented: no statuses, no body markers, no path params —
    // the derivation establishes none of them, and omitted is the honest answer.
    expect(post.operation.produces).toBeUndefined();
    expect(post.operation.consumes).toBeUndefined();
    expect(post.operation.request!.params).toBeUndefined();
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

    const result = await mapInterfaces(repo, { probeExec: null });
    const api = result.catalog.interfaces.filter((j) => j.type === 'api');
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

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.catalog.interfaces.map((j) => j.id)).toEqual(['api/get-health']);
  });
});

describe('mapInterfaces — own hosts (the cal.com false positive)', () => {
  /** A config module writing the app's OWN production origin as an env fallback,
   *  next to a genuine third party. */
  const SELF_REFERENCING_CONFIG = `
    const webapp = process.env.NEXT_PUBLIC_WEBAPP_URL ?? 'https://app.cal.com';
    const consoleUrl = 'https://console.cal.com/teams';
    const stripe = 'https://api.stripe.com/v1';
  `;

  it('with no recipe, every host detects — the pre-fix baseline', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'calcom' }),
      'src/config.ts': SELF_REFERENCING_CONFIG,
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.externalServices.map((s) => s.service)).toEqual(['cal', 'stripe']);
  });

  it('a recipe pinning the base-URL env var drops the self-service', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'calcom' }),
      'src/config.ts': SELF_REFERENCING_CONFIG,
      '.truecourse/scenarios/recipe.json': JSON.stringify({
        build: 'true',
        env: { NEXT_PUBLIC_WEBAPP_URL: 'http://localhost:3000' },
        api: { serve: ['node', 'server.js'] },
      }),
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.externalServices.map((s) => s.service)).toEqual(['stripe']);
  });

  it('an explicit recipe ownHosts declaration drops the self-service too', async () => {
    writeRepo({
      'package.json': JSON.stringify({ name: 'calcom' }),
      'src/config.ts': SELF_REFERENCING_CONFIG,
      '.truecourse/scenarios/recipe.json': JSON.stringify({
        build: 'true',
        ownHosts: ['cal.com'],
        api: { serve: ['node', 'server.js'] },
      }),
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    expect(result.externalServices.map((s) => s.service)).toEqual(['stripe']);
  });
});

describe('mapInterfaces — guard-fixture-api acceptance', () => {
  it('derives the api catalog from the fixture OpenAPI doc alone, nothing marked specOnly', async () => {
    // The fixture server is framework-free node:http — the route extractors see
    // nothing, so the whole surface comes from the committed OpenAPI doc and the
    // specOnly cross-check must stay silent (no code-side routes to cross-check).
    fs.cpSync(path.join(__dirname, '../fixtures/guard-fixture-api'), repo, { recursive: true });
    writeRepo({
      '.truecourse/specs/corpus.json': JSON.stringify({ docs: [{ ref: 'openapi.yaml' }] }),
    });

    const result = await mapInterfaces(repo, { probeExec: null });
    const api = result.catalog.interfaces.filter((j) => j.type === 'api');
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

describe('the interface snapshot is gitignored', () => {
  it('lists guard/interfaces.json in the store .gitignore', () => {
    writeRepo({ 'package.json': '{}' });
    const dir = ensureRepoTruecourseDir(repo);
    const ignored = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').split('\n');
    expect(ignored).toContain('guard/interfaces.json');
  });
});
