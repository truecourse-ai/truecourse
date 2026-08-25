/**
 * INTERFACE RECONCILIATION (plan 03 step 12) — the `guard-setup.reconcile-interfaces`
 * session and the two halves around it:
 *
 *  - the pure fold (`validateResolutions` / `applyReconcileResolutions`): the
 *    session's verdicts applied to the in-memory catalog, REMOVALS ONLY;
 *  - the session runner (`runReconcileInterfacesSession`): zero sessions on an
 *    empty dispute list, one otherwise, through the outcome cache;
 *  - the step body's reconcile half (`buildInterfacesStep`), including the
 *    corrected snapshot written back BEFORE anything reads the catalog;
 *  - the plumbing that feeds it: `mapInterfaces` carries the union's diagnostics
 *    as RUN REPORTING and never serializes them into `guard/interfaces.json`.
 *
 * The driver is always scripted (the shared spec-scan stub) — the real
 * `runAgentLoop` runs, so the outcome schema gate and the `check_resolutions`
 * precondition are the shell's, not a mock's.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionRunInput } from '../../packages/agent-loop/src/index';
import { computeRecipeFingerprint } from '@truecourse/guard-runner';
import {
  InterfacesFileSchema,
  interfaceFingerprint,
  type Interface,
  type InterfacesFile,
  type MapperDiagnostic,
} from '../../packages/shared/src/index';
import { buildCliInterfaces } from '../../packages/interface-mapper/src/cli-interfaces';
import {
  applyReconcileResolutions,
  reconcileInterfacesCacheKey,
  reconcileInterfacesSessionDef,
  runReconcileInterfacesSession,
  validateResolutions,
  RECONCILE_INTERFACES_CACHE_NAME,
  type InterfaceResolution,
} from '../../packages/core/src/services/guard-setup/reconcile-interfaces';
import { buildInterfacesStep } from '../../packages/core/src/services/guard-setup/interfaces-step';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { mapInterfaces } from '../../packages/core/src/services/interface.service';
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reconcile-'));
  repos.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY = ['node', '/repo/bin.mjs'];

const treeMissingFlag: MapperDiagnostic = {
  surface: 'cli',
  kind: 'tree-missing-flag',
  subject: 'relkit add --transport',
  detail: 'the help documents `--transport`; the tree does not register it.',
  command: ['add'],
  flag: '--transport',
};
const probeMissingFlag: MapperDiagnostic = {
  surface: 'cli',
  kind: 'probe-missing-flag',
  subject: 'relkit add --force',
  detail: 'the tree registers `--force`; the help does not list it.',
  command: ['add'],
  flag: '--force',
};
const probeMissingCommand: MapperDiagnostic = {
  surface: 'cli',
  kind: 'probe-missing-command',
  subject: 'relkit sync',
  detail: 'the tree registers `sync`; the help does not list it.',
  command: ['sync'],
};
const treeMissingCommand: MapperDiagnostic = {
  surface: 'cli',
  kind: 'tree-missing-command',
  subject: 'relkit export',
  detail: 'the help lists `export`; the tree does not register it.',
  command: ['export'],
};

const answer = (
  subject: string,
  resolution: InterfaceResolution['resolution'],
): InterfaceResolution => ({ subject, resolution, evidence: 'observed' });

/** The union's catalog for the disputes above. */
const unionCatalog = (): Interface[] =>
  buildCliInterfaces([
    { path: ['add'], flags: ['--force', '--transport'] },
    { path: ['sync'], flags: [] },
    { path: ['export'], flags: [] },
  ]);

// ---------------------------------------------------------------------------
// validateResolutions
// ---------------------------------------------------------------------------

describe('validateResolutions', () => {
  const disputes = [treeMissingFlag, probeMissingFlag];

  it('passes a complete list, `unknown` answers included', () => {
    expect(
      validateResolutions(disputes, [
        answer(treeMissingFlag.subject, 'unknown'),
        answer(probeMissingFlag.subject, 'unknown'),
      ]),
    ).toEqual([]);
  });

  it('names an unanswered subject', () => {
    const problems = validateResolutions(disputes, [answer(treeMissingFlag.subject, 'tree-right')]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(probeMissingFlag.subject);
    expect(problems[0]).toContain('not answered');
  });

  it('names a subject answered twice', () => {
    const problems = validateResolutions(disputes, [
      answer(treeMissingFlag.subject, 'tree-right'),
      answer(treeMissingFlag.subject, 'both'),
      answer(probeMissingFlag.subject, 'both'),
    ]);
    expect(problems).toEqual([expect.stringContaining('answered twice')]);
  });

  it('refuses an answer to something nobody asked', () => {
    const problems = validateResolutions(disputes, [
      answer(treeMissingFlag.subject, 'tree-right'),
      answer(probeMissingFlag.subject, 'tree-right'),
      answer('relkit invented --flag', 'both'),
    ]);
    expect(problems).toEqual([expect.stringContaining('not one of the briefed subjects')]);
  });
});

// ---------------------------------------------------------------------------
// applyReconcileResolutions — the pure fold
// ---------------------------------------------------------------------------

describe('applyReconcileResolutions', () => {
  it('drops a probe-filled flag the tree was right about, and re-fingerprints', () => {
    const interfaces = unionCatalog();
    const applied = applyReconcileResolutions({
      interfaces,
      diagnostics: [treeMissingFlag],
      resolutions: [answer(treeMissingFlag.subject, 'tree-right')],
    });

    const add = applied.interfaces.find((i) => i.id === 'cli/add')!;
    expect(add.steps[0].kind === 'invoke' && add.steps[0].flags).toEqual(['--force']);
    // The mirror image of the union having added the flag: the identity moves to
    // exactly what a flagless derivation of the same seed would have produced.
    const mirror = buildCliInterfaces([{ path: ['add'], flags: ['--force'] }])[0];
    expect(add.fingerprint).toBe(mirror.fingerprint);
    expect(applied.changes).toEqual(['dropped phantom flag `--transport` from `add`']);
  });

  it('drops a tree-registered flag the probe was right about', () => {
    const applied = applyReconcileResolutions({
      interfaces: unionCatalog(),
      diagnostics: [probeMissingFlag],
      resolutions: [answer(probeMissingFlag.subject, 'probe-right')],
    });
    const add = applied.interfaces.find((i) => i.id === 'cli/add')!;
    expect(add.steps[0].kind === 'invoke' && add.steps[0].flags).toEqual(['--transport']);
  });

  for (const resolution of ['probe-right', 'both', 'unknown'] as const) {
    it(`leaves the catalog byte-identical on \`${resolution}\` for a tree-missing-flag`, () => {
      const interfaces = unionCatalog();
      const applied = applyReconcileResolutions({
        interfaces,
        diagnostics: [treeMissingFlag],
        resolutions: [answer(treeMissingFlag.subject, resolution)],
      });
      expect(applied.interfaces).toEqual(interfaces);
      expect(applied.changes).toEqual([]);
    });
  }

  it('drops a tree command the probe was right about, and keeps it otherwise', () => {
    const dropped = applyReconcileResolutions({
      interfaces: unionCatalog(),
      diagnostics: [probeMissingCommand],
      resolutions: [answer(probeMissingCommand.subject, 'probe-right')],
    });
    expect(dropped.interfaces.map((i) => i.id)).toEqual(['cli/add', 'cli/export']);
    expect(dropped.changes).toEqual([expect.stringContaining('dropped phantom command `sync`')]);

    const kept = applyReconcileResolutions({
      interfaces: unionCatalog(),
      diagnostics: [probeMissingCommand],
      resolutions: [answer(probeMissingCommand.subject, 'tree-right')],
    });
    expect(kept.interfaces.map((i) => i.id)).toEqual(['cli/add', 'cli/sync', 'cli/export']);
    expect(kept.changes).toEqual([]);
  });

  it('drops a probe-filled command the tree was right about', () => {
    const applied = applyReconcileResolutions({
      interfaces: unionCatalog(),
      diagnostics: [treeMissingCommand],
      resolutions: [answer(treeMissingCommand.subject, 'tree-right')],
    });
    expect(applied.interfaces.map((i) => i.id)).toEqual(['cli/add', 'cli/sync']);
  });

  it('passes non-cli interfaces through untouched', () => {
    const api: Interface = {
      id: 'api/get-orgs',
      type: 'api',
      title: 'GET /orgs',
      entry: { method: 'GET', path: '/orgs' },
      steps: [{ kind: 'request', method: 'GET', path: '/orgs' }],
      fingerprint: interfaceFingerprint({
        type: 'api',
        entry: { method: 'GET', path: '/orgs' },
        steps: [{ kind: 'request', method: 'GET', path: '/orgs' }],
      }),
    };
    const applied = applyReconcileResolutions({
      interfaces: [...unionCatalog(), api],
      diagnostics: [treeMissingFlag],
      resolutions: [answer(treeMissingFlag.subject, 'tree-right')],
    });
    expect(applied.interfaces.find((i) => i.id === 'api/get-orgs')).toEqual(api);
  });

  it('ignores a diagnostic that carries no structured cli identity', () => {
    const merge: MapperDiagnostic = {
      surface: 'web',
      kind: 'authored-place-not-derived',
      subject: 'web/home',
      detail: 'an authored screen no derivation backs',
    };
    const interfaces = unionCatalog();
    for (const resolution of ['tree-right', 'probe-right', 'both', 'unknown'] as const) {
      const applied = applyReconcileResolutions({
        interfaces,
        diagnostics: [merge],
        resolutions: [answer(merge.subject, resolution)],
      });
      expect(applied.interfaces).toEqual(interfaces);
      expect(applied.changes).toEqual([]);
    }
  });

  it('records no change line for an edit that was already true', () => {
    // The disputed flag is not on the interface any more (a hand-edited catalog):
    // the resolution is legal, and it changes nothing, so it says nothing.
    const interfaces = buildCliInterfaces([{ path: ['add'], flags: ['--force'] }]);
    const applied = applyReconcileResolutions({
      interfaces,
      diagnostics: [treeMissingFlag],
      resolutions: [answer(treeMissingFlag.subject, 'tree-right')],
    });
    expect(applied.interfaces).toEqual(interfaces);
    expect(applied.changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runReconcileInterfacesSession
// ---------------------------------------------------------------------------

/** Call a session tool the way a driver does — the tool-result event is what the
 *  shell's outcome precondition reads off the transcript. */
async function callTool(input: SessionRunInput, name: string, args: unknown): Promise<string> {
  const tool = input.def.tools.find((t) => t.name === name)!;
  const result = await tool.execute(args, {
    workItem: 'cli:reconcile',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('not used');
    },
  });
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError });
  return result.content;
}

describe('runReconcileInterfacesSession', () => {
  it('spends ZERO sessions when nothing is disputed', async () => {
    const repo = tempRepo();
    const result = await runReconcileInterfacesSession({
      repoRoot: repo,
      diagnostics: [],
      entry: ENTRY,
      recipeFingerprint: 'fp-1',
      driver: async () => {
        throw new Error('the driver must not be acquired');
      },
      persistence: memoryPersistence().persistence,
    });

    expect(result).toEqual({ outcome: null });
    expect(fs.existsSync(path.join(repo, '.truecourse', '.cache', 'guard'))).toBe(false);
  });

  it('runs one session, caches its outcome, and answers the second call from the cache', async () => {
    const repo = tempRepo();
    const argvSeen: string[][] = [];
    const disputes = [treeMissingFlag, probeMissingFlag];
    const resolutions = [
      answer(treeMissingFlag.subject, 'tree-right'),
      answer(probeMissingFlag.subject, 'both'),
    ];
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_entry', { argv: ['add', '--help'] });
      await callTool(call.input, 'check_resolutions', { resolutions });
      return outcome({ resolutions });
    });
    let acquired = 0;

    const first = await runReconcileInterfacesSession({
      repoRoot: repo,
      diagnostics: disputes,
      entry: ENTRY,
      recipeFingerprint: 'fp-1',
      driver: async () => {
        acquired++;
        return stub.driver;
      },
      persistence: memoryPersistence().persistence,
      exec: async (argv) => {
        argvSeen.push([...argv]);
        return { stdout: 'Options:\n  --transport <kind>\n', stderr: '', exitCode: 0 };
      },
      mintSessionId: () => 'session-1',
    });

    expect(first.outcome?.status).toBe('completed');
    expect(first.sessionId).toBe('session-1');
    expect(acquired).toBe(1);
    // `run_entry` appends the argv to the resolved entry, never a binary path.
    expect(argvSeen).toEqual([[...ENTRY, 'add', '--help']]);
    const cacheFile = path.join(
      repo,
      '.truecourse',
      '.cache',
      RECONCILE_INTERFACES_CACHE_NAME,
      `${reconcileInterfacesCacheKey(disputes, 'fp-1')}.json`,
    );
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))).toEqual({ resolutions });

    // Same disputes, same recipe: the cache answers and no driver is acquired.
    const second = await runReconcileInterfacesSession({
      repoRoot: repo,
      diagnostics: disputes,
      entry: ENTRY,
      recipeFingerprint: 'fp-1',
      driver: async () => {
        throw new Error('the driver must not be acquired on a cache hit');
      },
      persistence: memoryPersistence().persistence,
    });
    expect(second.outcome).toMatchObject({ status: 'completed', fromCache: true });
    expect(second.sessionId).toBeUndefined();
  });

  it('keys on WHAT is disputed, not on derivation order — and re-asks when the recipe moves', () => {
    const forward = reconcileInterfacesCacheKey([treeMissingFlag, probeMissingFlag], 'fp-1');
    const reversed = reconcileInterfacesCacheKey([probeMissingFlag, treeMissingFlag], 'fp-1');
    const moved = reconcileInterfacesCacheKey([treeMissingFlag, probeMissingFlag], 'fp-2');

    expect(reversed).toBe(forward);
    expect(moved).not.toBe(forward);
  });

  it('turns a throwing probe into an error tool result, never a crashed session', async () => {
    const repo = tempRepo();
    const resolutions = [answer(treeMissingFlag.subject, 'unknown')];
    let toolContent = '';
    const stub = stubDriver(async (call) => {
      toolContent = await callTool(call.input, 'run_entry', { argv: ['add', '--help'] });
      await callTool(call.input, 'check_resolutions', { resolutions });
      return outcome({ resolutions });
    });

    const result = await runReconcileInterfacesSession({
      repoRoot: repo,
      diagnostics: [treeMissingFlag],
      entry: ENTRY,
      recipeFingerprint: 'fp-1',
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      exec: async () => {
        throw new Error('spawn ENOENT');
      },
    });

    expect(toolContent).toContain('spawn ENOENT');
    expect(result.outcome?.status).toBe('completed');
  });

  it('carries the check_resolutions precondition on its session def', () => {
    const def = reconcileInterfacesSessionDef({ diagnostics: [treeMissingFlag], entry: ENTRY });
    expect(def.outcomePrecondition?.tool).toBe('check_resolutions');
    expect(def.tools.map((t) => t.name).sort()).toEqual(['check_resolutions', 'run_entry']);
  });
});

// ---------------------------------------------------------------------------
// buildInterfacesStep — the reconcile half
// ---------------------------------------------------------------------------

/** A repo carrying a recipe with an entry and a derived cli catalog. */
function catalogRepo(interfaces: Interface[]): { repo: string; catalog: InterfacesFile } {
  const repo = tempRepo();
  const recipe = { build: 'true', entry: ['node', 'bin.mjs'] };
  fs.mkdirSync(path.join(repo, '.truecourse', 'scenarios'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.truecourse', 'scenarios', 'recipe.json'),
    JSON.stringify(recipe, null, 2),
  );
  fs.writeFileSync(path.join(repo, 'bin.mjs'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'relkit' }));
  const catalog: InterfacesFile = {
    version: 2,
    generatedAt: '2026-01-01T00:00:00Z',
    recipeFingerprint: 'rf',
    interfaces,
    source: { cli: 'union' },
  };
  fs.mkdirSync(path.join(repo, '.truecourse', 'guard'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.truecourse', 'guard', 'interfaces.json'),
    JSON.stringify(catalog, null, 2),
  );
  return { repo, catalog };
}

/** A session context that fails loudly if anything tries to open a run. */
function forbiddenContext(): GuardSetupSessionContext {
  return {
    async acquire() {
      throw new Error('no session should have been started');
    },
    runId: () => undefined,
    note: () => {},
    addSpend: () => {},
    usageTotals: () => null,
    finish: () => {},
  };
}

/** Pre-seed the reconcile cache so the step's session is answered without a driver. */
function seedReconcileCache(
  repo: string,
  diagnostics: readonly MapperDiagnostic[],
  resolutions: InterfaceResolution[],
): void {
  const key = reconcileInterfacesCacheKey(diagnostics, computeRecipeFingerprint(repo));
  const file = path.join(repo, '.truecourse', '.cache', RECONCILE_INTERFACES_CACHE_NAME, `${key}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ resolutions }, null, 2));
}

const stepInput = (repo: string, interfaces: Interface[], diagnostics: MapperDiagnostic[]) => ({
  repoRoot: repo,
  fingerprint: 'if-1',
  refresh: false,
  replace: false,
  recipe: { build: 'true', entry: ['node', 'bin.mjs'] } as never,
  interfaces,
  diagnostics,
});

const neverAuthors = async (): Promise<never> => {
  throw new Error('authoring must not run');
};

describe('buildInterfacesStep — the reconcile half', () => {
  it('starts no session when the mapping disputed nothing', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());

    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(
      stepInput(repo, catalog.interfaces, []),
    );

    expect(result.status).toBe('ok');
    expect(result.reason).toContain('zero sessions');
    // The context would have THROWN on an acquire, and the step swallows that
    // into a note — so the absence of any reconcile note is the assertion.
    expect(result.reason).not.toMatch(/reconcile/);
    expect(result.diagnostics).toBeUndefined();
    expect(fs.existsSync(path.join(repo, '.truecourse', 'sessions'))).toBe(false);
  });

  it('applies a cached `tree-right` verdict to the snapshot and records it on the row', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());
    seedReconcileCache(repo, [treeMissingFlag], [answer(treeMissingFlag.subject, 'tree-right')]);

    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(
      stepInput(repo, catalog.interfaces, [treeMissingFlag]),
    );

    expect(result.status).toBe('ok');
    expect(result.diagnostics).toEqual([treeMissingFlag]);
    expect(result.resolutions).toEqual([answer(treeMissingFlag.subject, 'tree-right')]);
    expect(result.changes).toEqual(['dropped phantom flag `--transport` from `add`']);

    const written = InterfacesFileSchema.parse(
      JSON.parse(fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'interfaces.json'), 'utf-8')),
    );
    const add = written.interfaces.find((i) => i.id === 'cli/add')!;
    expect(add.steps[0].kind === 'invoke' && add.steps[0].flags).toEqual(['--force']);
    expect(add.fingerprint).not.toBe(catalog.interfaces.find((i) => i.id === 'cli/add')!.fingerprint);
    // Run reporting stays OUT of the catalog.
    expect(JSON.stringify(written)).not.toContain('diagnostics');
  });

  it('leaves the catalog untouched when every verdict is `unknown`', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());
    const before = fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'interfaces.json'), 'utf-8');
    seedReconcileCache(repo, [treeMissingFlag], [answer(treeMissingFlag.subject, 'unknown')]);

    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(
      stepInput(repo, catalog.interfaces, [treeMissingFlag]),
    );

    expect(result.changes).toBeUndefined();
    expect(fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'interfaces.json'), 'utf-8')).toBe(before);
  });

  it('ignores a cached outcome whose subjects the disputes have moved under', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());
    const before = fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'interfaces.json'), 'utf-8');
    // The cache entry is keyed on THESE disputes, but answers a subject that is
    // no longer one of them (a moved world writing the same key is impossible —
    // this is the shape of the check, driven directly).
    seedReconcileCache(repo, [treeMissingFlag], [answer('relkit add --gone', 'probe-right')]);

    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(
      stepInput(repo, catalog.interfaces, [treeMissingFlag]),
    );

    expect(result.reason).toContain('resolutions ignored');
    expect(result.changes).toBeUndefined();
    expect(fs.readFileSync(path.join(repo, '.truecourse', 'guard', 'interfaces.json'), 'utf-8')).toBe(before);
  });

  it('notes an unreconcilable dispute when the recipe declares no entry', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());
    const input = { ...stepInput(repo, catalog.interfaces, [treeMissingFlag]), recipe: { build: 'true' } as never };

    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(input);

    expect(result.reason).toContain('no `entry`');
    expect(result.diagnostics).toEqual([treeMissingFlag]);
  });

  it('never sends a merge diagnostic to the session — a program run cannot answer it', async () => {
    const { repo, catalog } = catalogRepo(unionCatalog());
    const merge: MapperDiagnostic = {
      surface: 'web',
      kind: 'authored-place-not-derived',
      subject: 'web/home',
      detail: 'an authored screen no derivation backs',
    };

    // A forbidden context proves it: with only this diagnostic, no session runs.
    const result = await buildInterfacesStep(forbiddenContext(), { author: neverAuthors })(
      stepInput(repo, catalog.interfaces, [merge]),
    );

    expect(result.status).toBe('ok');
    expect(result.resolutions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The plumbing: mapInterfaces carries diagnostics, the snapshot never does
// ---------------------------------------------------------------------------

describe('mapInterfaces — diagnostics are run reporting', () => {
  /** A repo whose tree registers `add --json` and whose recipe names an entry. */
  function mappableRepo(): string {
    const repo = tempRepo();
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'relkit', bin: { relkit: './bin.mjs' } }, null, 2),
    );
    fs.writeFileSync(path.join(repo, 'bin.mjs'), '#!/usr/bin/env node\n');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'src', 'cli.ts'),
      [
        "import { Command } from 'commander'",
        'const program = new Command()',
        "program.command('add <name>').description('Add a release').option('--json', 'Emit JSON').action(runAdd)",
        'program.parse()',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(path.join(repo, '.truecourse', 'scenarios'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'scenarios', 'recipe.json'),
      JSON.stringify({ build: 'true', entry: ['node', 'bin.mjs'] }, null, 2),
    );
    return repo;
  }

  const ROOT_HELP = 'Usage: relkit [options] [command]\n\nCommands:\n  add [options] <name>  Add a release\n';
  const ADD_HELP =
    'Usage: relkit add [options] <name>\n\nOptions:\n  --transport <kind>  Upload transport\n  -h, --help  display help\n';

  it('reports the union disputes and writes NONE of them into interfaces.json', async () => {
    const repo = mappableRepo();

    const result = await mapInterfaces(repo, {
      probeExec: async (argv) => ({
        stdout: argv.join(' ').includes('add') ? ADD_HELP : ROOT_HELP,
        stderr: '',
        exitCode: 0,
      }),
    });

    expect(result.catalog.source?.cli).toBe('union');
    expect(result.diagnostics.map((d) => `${d.kind} ${d.subject}`).sort()).toEqual([
      'probe-missing-flag relkit add --json',
      'tree-missing-flag relkit add --transport',
    ]);
    const raw = fs.readFileSync(result.snapshotPath, 'utf-8');
    expect(raw).not.toContain('diagnostics');
    expect(() => InterfacesFileSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it('keeps the no-spawn path exactly as it was', async () => {
    const repo = mappableRepo();

    const result = await mapInterfaces(repo, { probeExec: null });

    expect(result.catalog.source?.cli).toBe('tree');
    expect(result.diagnostics).toEqual([]);
  });

  it('still parses a catalog written with the pre-union `probes` source', () => {
    const file: unknown = {
      version: 2,
      generatedAt: '2026-01-01T00:00:00Z',
      recipeFingerprint: 'rf',
      interfaces: [],
      source: { cli: 'probes' },
    };
    expect(InterfacesFileSchema.parse(file).source).toEqual({ cli: 'probes' });
  });
});
