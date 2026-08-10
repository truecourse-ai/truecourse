import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { GuardInterfacesViewSchema } from '../../packages/shared/src/index';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The Interfaces tab reads the CONTRACT, not just the command tree: `GET
 * /guard/interfaces` must carry each interface's full grammar and its io facts
 * through to the client verbatim.
 *
 * Two properties are load-bearing here and both are asserted:
 *  - an interface WITHOUT a contract (the shape the mapper writes today) travels
 *    unchanged and grows no empty `contract` key — absence must survive the
 *    compose, or the view can't tell "not derived" from "nothing";
 *  - an interface WITH one arrives byte-identical, `unknown` exit statuses included.
 */

const CONTRACT_INTERFACE = {
  id: 'cli/tasks-add',
  type: 'cli',
  title: 'tasks add',
  entry: { command: ['tasks', 'add'] },
  steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json', '--priority'] }],
  fingerprint: 'sha256:j1',
  contract: {
    summary: '`tasks add` and its `--json` mode.',
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
            prompts: [{ kind: 'select', marker: 'Where should tasks live?', when: 'no config saved' }],
            env: [{ var: 'TASKS_HOME' }],
            reads: [{ path: '~/.tasks.json', when: 'the store the new task is appended to' }],
          },
          produces: {
            output: [{ stream: 'stdout', marker: 'Created task ' }],
            exits: [
              { exit: '0', when: 'the task was created' },
              { exit: 'unknown', when: 'an unwritable store declares no exit path in code' },
            ],
            writes: [],
          },
        },
      },
    ],
  },
};

/** The shape the mapper writes today — command tree only. */
const BARE_INTERFACE = {
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
  interfaces: [CONTRACT_INTERFACE, BARE_INTERFACE],
  source: { cli: 'tree' },
};

describe('Guard interfaces — the contract passthrough', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
    const file = path.join(root, '.truecourse', 'guard', 'interfaces.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(CATALOG, null, 2));
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('serves the contract verbatim, and validates against the wire schema', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    expect(() => GuardInterfacesViewSchema.parse(res.body)).not.toThrow();

    const add = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-add');
    expect(add.contract).toEqual(CONTRACT_INTERFACE.contract);
  });

  it('keeps `unknown` and "established as none" intact across the wire', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    const io = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-add').contract.commands[0].io;
    const produces = io.produces;
    // The read side travels with the write side — a scenario seeds what it reads.
    expect(io.consumes.reads).toEqual([{ path: '~/.tasks.json', when: 'the store the new task is appended to' }]);
    // An unestablished exit status arrives as `unknown` — never rounded to 0/1.
    expect(produces.exits.map((e: { exit: string }) => e.exit)).toEqual(['0', 'unknown']);
    // An authored EMPTY list is a fact ("none"), so it must not be dropped.
    expect(produces.writes).toEqual([]);
  });

  it('an interface with no contract grows no empty one — absence survives the compose', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    const list = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-list');
    expect('contract' in list).toBe(false);
    // The row is otherwise exactly what it always was.
    expect(list).toMatchObject({ title: 'tasks list', fingerprint: 'sha256:j2', flows: [], scenarioIds: [] });
  });
});
