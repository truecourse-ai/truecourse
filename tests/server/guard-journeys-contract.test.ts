import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { GuardJourneysViewSchema } from '../../packages/shared/src/index';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The Journeys tab reads the CONTRACT, not just the command tree: `GET
 * /guard/journeys` must carry each journey's full grammar, its input/output and
 * its doc-versus-code findings through to the client verbatim.
 *
 * Two properties are load-bearing here and both are asserted:
 *  - a journey WITHOUT a contract (the shape the mapper writes today) travels
 *    unchanged and grows no empty `contract` / `diagnostics` keys — absence must
 *    survive the compose, or the view can't tell "not derived" from "nothing";
 *  - a journey WITH one arrives byte-identical, `unknown` exit codes included.
 */

const CONTRACT_JOURNEY = {
  id: 'cli/tasks-add',
  type: 'cli',
  title: 'tasks add',
  entry: { command: ['tasks', 'add'] },
  steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json', '--priority'] }],
  fingerprint: 'sha256:j1',
  contract: {
    summary: '`tasks add` and its `--json` mode.',
    derivedFrom: ['Source of truth: src/cli.ts', 'Cross-check: `tasks add --help` probe'],
    commands: [
      {
        path: ['tasks', 'add'],
        description: 'Add a task.',
        options: [
          { flag: '--json', takesValue: false, valueRequired: false, scope: 'command', description: 'Print JSON.' },
          {
            flag: '--priority',
            short: '-p',
            takesValue: true,
            valueRequired: true,
            valueHint: 'level',
            choices: ['low', 'high'],
            default: 'low',
            scope: 'command',
          },
        ],
        positionals: [{ name: 'title', required: true, variadic: false, description: 'The task title.' }],
        io: {
          consumes: {
            stdin: [{ name: 'none', when: 'never — the title is an argument' }],
            reads: [{ path: '~/.tasks.json', as: 'the task store' }],
            environment: ['TASKS_HOME — relocates the store'],
          },
          produces: {
            stdout: [{ shape: 'created line', when: 'always', content: 'Created task <id>' }],
            stderr: [],
            writes: [{ path: '~/.tasks.json', when: 'always' }],
            exitCodes: [
              { code: '0', means: 'task created' },
              { code: 'unknown', means: 'an unwritable store declares no exit path in code' },
            ],
            sideEffects: [],
          },
        },
        notes: ['Re-running with the same title creates a second task.'],
        inheritsShared: [{ block: 'stdin', note: 'the first-run wizard' }],
      },
    ],
    shared: {
      stdin: [{ name: 'first-run wizard', when: 'no config saved', prompts: ['Where should tasks live?'] }],
      notes: ['Every command resolves the store by walking up from the cwd.'],
    },
    decisions: [{ id: 'no-remote-store', decision: 'The contract models the local store only.' }],
  },
  diagnostics: [
    { kind: 'docs-missing-behavior', subject: '--priority', detail: 'The docs omit the default.', right: 'code' },
  ],
};

/** The shape the mapper writes today — command tree only. */
const BARE_JOURNEY = {
  id: 'cli/tasks-list',
  type: 'cli',
  title: 'tasks list',
  entry: { command: ['tasks', 'list'] },
  steps: [{ kind: 'invoke', command: ['tasks', 'list'], flags: ['--done'] }],
  fingerprint: 'sha256:j2',
};

const CATALOG = {
  version: 1,
  generatedAt: '2026-08-06T13:39:00.000Z',
  recipeFingerprint: 'sha256:r',
  journeys: [CONTRACT_JOURNEY, BARE_JOURNEY],
  source: { cli: 'tree' },
};

describe('Guard journeys — the contract passthrough', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
    const file = path.join(root, '.truecourse', 'guard', 'journeys.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(CATALOG, null, 2));
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('serves the contract and the findings verbatim, and validates against the wire schema', async () => {
    const res = await request(app).get(url('journeys')).expect(200);
    expect(() => GuardJourneysViewSchema.parse(res.body)).not.toThrow();

    const add = res.body.journeys.find((j: { id: string }) => j.id === 'cli/tasks-add');
    expect(add.contract).toEqual(CONTRACT_JOURNEY.contract);
    expect(add.diagnostics).toEqual(CONTRACT_JOURNEY.diagnostics);
  });

  it('keeps `unknown` and "established as none" intact across the wire', async () => {
    const res = await request(app).get(url('journeys')).expect(200);
    const produces = res.body.journeys.find((j: { id: string }) => j.id === 'cli/tasks-add').contract.commands[0].io
      .produces;
    // An unestablished exit status arrives as `unknown` — never rounded to 0/1.
    expect(produces.exitCodes.map((c: { code: string }) => c.code)).toEqual(['0', 'unknown']);
    // An authored EMPTY list is a fact ("none"), so it must not be dropped.
    expect(produces.stderr).toEqual([]);
    expect(produces.sideEffects).toEqual([]);
  });

  it('a journey with no contract grows no empty one — absence survives the compose', async () => {
    const res = await request(app).get(url('journeys')).expect(200);
    const list = res.body.journeys.find((j: { id: string }) => j.id === 'cli/tasks-list');
    expect('contract' in list).toBe(false);
    expect('diagnostics' in list).toBe(false);
    // The row is otherwise exactly what it always was.
    expect(list).toMatchObject({ title: 'tasks list', fingerprint: 'sha256:j2', flows: [], scenarioIds: [] });
  });
});
