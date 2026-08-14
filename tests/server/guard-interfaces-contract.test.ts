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
 *
 * The entry's FAMILY (`group`) rides the same wire — the panel groups the catalog
 * by it — and follows the same absence rule.
 */

const CONTRACT_INTERFACE = {
  id: 'cli/tasks-add',
  type: 'cli',
  title: 'tasks add',
  group: 'tasks',
  entry: { command: ['tasks', 'add'] },
  steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json', '--priority'] }],
  fingerprint: 'sha256:j1',
  contract: {
    surface: 'cli',
    summary: '`tasks add` and its `--json` mode.',
    command: {
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
  },
};

/** An api entry carrying the union's OTHER member — HTTP, in its own words. */
const OPERATION_INTERFACE = {
  id: 'api/post-tasks',
  type: 'api',
  title: 'POST /tasks',
  group: 'tasks',
  entry: { method: 'POST', path: '/tasks' },
  steps: [{ kind: 'request', method: 'POST', path: '/tasks' }],
  resource: 'tasks',
  fingerprint: 'sha256:j4',
  contract: {
    surface: 'api',
    operation: {
      request: {
        body: [
          { name: 'title', required: true },
          { name: 'priority', required: false, choices: ['low', 'high'], default: 'low' },
        ],
      },
      produces: {
        statuses: [
          { status: '201', when: 'the task was created' },
          { status: 'unknown', when: 'the store is unwritable and no path is declared' },
        ],
        body: [{ marker: '"id"' }],
        writes: [],
      },
    },
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

/** A web task carrying the LOCATION CONTRACT — its place, and where it leads. */
const PLACED_INTERFACE = {
  id: 'web/open-rules-dialog',
  type: 'web',
  title: 'Open the Rules dialog',
  entry: { method: 'GET', path: '/repos/{repoId}' },
  steps: [{ kind: 'activate', target: 'button "Rules"' }],
  at: 'repo-report',
  to: 'rules-dialog',
  fingerprint: 'sha256:j3',
};

/** The places those ids resolve in, readables included — the registry the view carries. */
const RESOURCES = {
  api: [{ id: 'tasks', kind: 'rest-noun', title: '/tasks' }],
  web: [
    { id: 'repo-report', kind: 'screen', title: 'the repository report' },
    {
      id: 'rules-dialog',
      kind: 'dialog',
      title: 'the Rules dialog',
      readables: {
        markers: [{ within: { role: 'dialog', name: 'Rules' }, marker: 'LLM rules' }],
        controls: [{ control: { role: 'switch', name: 'LLM rules' }, states: ['checked'] }],
        rows: [
          {
            item: 'listitem',
            template: '<ruleName> <severity>',
            slots: [
              { name: 'ruleName', kind: 'text' },
              { name: 'severity', kind: 'enum', values: ['critical', 'high'] },
            ],
          },
        ],
      },
    },
  ],
};

const CATALOG = {
  version: 2,
  generatedAt: '2026-08-06T13:39:00.000Z',
  recipeFingerprint: 'sha256:r',
  interfaces: [CONTRACT_INTERFACE, BARE_INTERFACE, PLACED_INTERFACE, OPERATION_INTERFACE],
  resources: RESOURCES,
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
    const io = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-add').contract.command.io;
    const produces = io.produces;
    // The read side travels with the write side — a scenario seeds what it reads.
    expect(io.consumes.reads).toEqual([{ path: '~/.tasks.json', when: 'the store the new task is appended to' }]);
    // An unestablished exit status arrives as `unknown` — never rounded to 0/1.
    expect(produces.exits.map((e: { exit: string }) => e.exit)).toEqual(['0', 'unknown']);
    // An authored EMPTY list is a fact ("none"), so it must not be dropped.
    expect(produces.writes).toEqual([]);
  });

  it('carries the entry’s family through, and invents none where the catalog has none', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    const rows = res.body.interfaces as { id: string; group?: string }[];
    expect(rows.find((j) => j.id === 'cli/tasks-add')!.group).toBe('tasks');
    expect('group' in rows.find((j) => j.id === 'cli/tasks-list')!).toBe(false);
  });

  it('carries the location contract and the resource registry through verbatim', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    expect(() => GuardInterfacesViewSchema.parse(res.body)).not.toThrow();

    // The row's place, and where the task leads — ids, joined client-side.
    const opened = res.body.interfaces.find((j: { id: string }) => j.id === 'web/open-rules-dialog');
    expect(opened).toMatchObject({ at: 'repo-report', to: 'rules-dialog' });
    // A row without a location grows none — same absence rule as the contract.
    const bare = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-list');
    expect('at' in bare).toBe(false);
    expect('to' in bare).toBe(false);
    // The registry travels ONCE, on the view, readables intact.
    expect(res.body.resources).toEqual(RESOURCES);
    // The OWNING place rides the same wire, and follows the same absence rule.
    const created = res.body.interfaces.find((j: { id: string }) => j.id === 'api/post-tasks');
    expect(created.resource).toBe('tasks');
    expect('resource' in bare).toBe(false);
  });

  it('serves the api member natively — no argv costume, no exit codes', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    expect(() => GuardInterfacesViewSchema.parse(res.body)).not.toThrow();
    const created = res.body.interfaces.find((j: { id: string }) => j.id === 'api/post-tasks');
    expect(created.contract).toEqual(OPERATION_INTERFACE.contract);
    expect(created.contract.surface).toBe('api');
    // `unknown` and "established as none" survive on this member too.
    expect(created.contract.operation.produces.statuses.map((s: { status: string }) => s.status)).toEqual([
      '201',
      'unknown',
    ]);
    expect(created.contract.operation.produces.writes).toEqual([]);
  });

  it('an interface with no contract grows no empty one — absence survives the compose', async () => {
    const res = await request(app).get(url('interfaces')).expect(200);
    const list = res.body.interfaces.find((j: { id: string }) => j.id === 'cli/tasks-list');
    expect('contract' in list).toBe(false);
    // The row is otherwise exactly what it always was.
    expect(list).toMatchObject({ title: 'tasks list', fingerprint: 'sha256:j2', flows: [], scenarioIds: [] });
  });
});
