/**
 * THE COMMAND ADAPTER — the run's context, which is everything the authoring
 * package deliberately does not know: which backend the configured transport
 * selects, where the transcripts land, and what the run record says afterwards.
 *
 * The driver here is the CONFIGURED one only in the sense that this test never
 * builds one: it asserts the store and the view, the two halves that must hold
 * whatever the model does. A live driver is exercised by the driver packages'
 * own conformance suites.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import { GITIGNORE_CONTENTS } from '../../packages/core/src/config/paths';
import type { InterfacesFile } from '../../packages/shared/src/index';
import { readGuardInterfacesAuthorView, runGuardInterfaceAuthoring } from '../../packages/core/src/commands/guard-interfaces';
import { stubDriver, outcome, toolResult } from './spec-scan-session-stub.js';
import { createSessionRun, listSessionRuns } from '../../packages/core/src/lib/sessions-store';

let repo: string;

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    {
      id: 'cli/tasks-add',
      type: 'cli',
      title: 'add a task',
      entry: { command: ['tasks', 'add'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: [] }],
      fingerprint: 'sha256:cli',
    },
  ],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}' },
    ],
  },
  source: { cli: 'tree', web: 'tree' },
};

const AUTHORED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T01:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    {
      id: 'web/add-repository-by-path',
      type: 'web',
      title: 'Register a repository from its path',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate', target: 'button "Add Repository"' }],
      at: 'root',
      fingerprint: 'sha256:web-add',
    },
  ],
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-cmd-'));
  fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('the read view', () => {
  it('says which places carry tasks and which are empty', () => {
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED));
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(AUTHORED));

    const view = readGuardInterfacesAuthorView(repo);
    expect(view.unmapped).toBe(false);
    expect(view.derived).toEqual({ cli: 1 });
    expect(view.authored).toEqual({ web: 1 });
    expect(view.places).toEqual([
      { id: 'root', kind: 'screen', title: '/', address: '/', authored: ['web/add-repository-by-path'], needsAuthoring: true },
      { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}', authored: [], needsAuthoring: true },
    ]);
  });

  it('reports readable enrichment as work to the CLI, including nested places', () => {
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED));
    const complete = { ...AUTHORED, resources: { web: [{ ...DERIVED.resources!.web[0],
      readables: { markers: [], elements: [], controls: [], rows: [] },
    }] } };
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(complete));
    expect(readGuardInterfacesAuthorView(repo).places[0].needsAuthoring).toBe(false);
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify({ ...complete, resources: { web: [
      ...complete.resources.web, { id: 'details', kind: 'dialog', of: 'root', title: 'Details' },
    ] } }));
    expect(readGuardInterfacesAuthorView(repo).places[0].needsAuthoring).toBe(true);
  });

  it('reads an unmapped repository as unmapped rather than as a repo with no places', () => {
    const view = readGuardInterfacesAuthorView(repo);
    expect(view.unmapped).toBe(true);
    expect(view.places).toEqual([]);
  });

  it('reads an authored task standing on a derived place — the half-catalog case', () => {
    // The derived half is gitignored, so a fresh clone has the authored file and
    // nothing else. Reading it must not fail on an `at` its own half cannot resolve.
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(AUTHORED));
    const view = readGuardInterfacesAuthorView(repo);
    expect(view.unmapped).toBe(true);
    expect(view.authored).toEqual({ web: 1 });
  });
});

describe('the findings ledger', () => {
  /**
   * It is a report about the REPOSITORY (a doc that disagrees with the source),
   * so it travels through git like the authored half beside it. The store's
   * ignore template must not catch it — by a line of its own, or by a directory
   * pattern over `guard/`.
   */
  it('is committable: no line of the ignore template catches it', () => {
    const rel = 'guard/interfaces.findings.md';
    const catching = GITIGNORE_CONTENTS.split('\n')
      .filter((line) => line !== '')
      .filter((line) => rel === line || (line.endsWith('/') && rel.startsWith(line)));
    expect(catching).toEqual([]);
    // The derived catalog beside it IS ignored — the two halves differ on this.
    expect(GITIGNORE_CONTENTS.split('\n')).toContain('guard/interfaces.json');
  });
});

describe('the sessions store', () => {
  it.each([false, true])('persists authoring in the owning run, shared=%s', async (shared) => {
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED));
    const parent = shared ? createSessionRun(repo, { command: 'guard-setup', gitRef: 'abc', activityStream: true }) : undefined;
    const onRunStarted = vi.fn();
    const { driver } = stubDriver(async (call) => {
      await call.emit(toolResult('check_draft'));
      return outcome({ interfaces: [], unresolved: ['No actions on this screen'] });
    });
    const result = await runGuardInterfaceAuthoring({ repoRoot: repo, driver, transportMode: 'api', sessionRun: parent, onRunStarted });
    const runs = listSessionRuns(repo);
    expect(runs).toHaveLength(1);
    expect(runs[0].command).toBe(shared ? 'guard-setup' : 'guard-interfaces');
    expect(runs[0].status).toBe(shared ? 'running' : 'completed');
    expect(runs[0].sessions).toHaveLength(2);
    expect(runs[0].sessions.every(session => session.kind === 'guard-interfaces.web-tasks')).toBe(true);
    for (const session of runs[0].sessions) {
      const transcript = fs.readFileSync(path.join(result.runDir, `${session.sessionId}.jsonl`), 'utf8');
      expect(transcript).toContain('session-start');
      expect(transcript).toContain('check_draft');
    }
    expect(onRunStarted).toHaveBeenCalledTimes(shared ? 0 : 1);
    if (parent) {
      expect(result.runId).toBe(parent.runId);
      expect(result.runDir).toBe(parent.dir);
      expect(parent.record().llm).toBeUndefined();
      expect(fs.readFileSync(path.join(parent.dir, 'activity.jsonl'), 'utf8')).toContain('session-event');
    }
  });

  it.each([false, true])('leaves failure finalization to the run owner, shared=%s', async (shared) => {
    const parent = shared ? createSessionRun(repo, { command: 'guard-setup', gitRef: 'abc' }) : undefined;
    const { driver } = stubDriver(() => outcome({ interfaces: [] }));
    await expect(runGuardInterfaceAuthoring({
      repoRoot: repo, driver, transportMode: 'api', sessionRun: parent,
      onStatus: () => { throw new Error('context failed'); },
    })).rejects.toThrow('context failed');
    const runs = listSessionRuns(repo);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe(shared ? 'running' : 'failed');
    expect(runs[0].error?.message).toBe(shared ? undefined : 'context failed');
  });

  it('gives interface authoring a command of its own', () => {
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED));
    // No run has happened, so the store is empty — but the command is a legal
    // one, which is what `createSessionRun` would need.
    expect(listSessionRuns(repo, 'guard-interfaces')).toEqual([]);
  });
});
