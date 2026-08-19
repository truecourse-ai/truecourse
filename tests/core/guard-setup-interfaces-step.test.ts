/**
 * THE INTERFACES STEP's AUTHORING HALF (plan 03 step 11) — `buildInterfacesStep`
 * with no cli disputes to reconcile, which is the ordinary case: the step's job
 * is then the web-task authoring run, injected as a thunk so the service layer
 * never imports the command layer.
 *
 * The two rules this pins:
 *  - ZERO WORK COSTS ZERO SESSIONS. The engine decides the step should RUN
 *    (fingerprint moved, authored file absent, `--replace`); the seam still
 *    checks whether any screen actually needs authoring, because a run record
 *    with an empty work list is noise the boot sweep then has to reconcile.
 *  - AN AUTHORING FAILURE FAILS THE STEP, NEVER SETUP — and everything the run
 *    noticed (its stale-place diagnostics) comes back for the step ROW, which
 *    is the only place run reporting may land.
 *
 * The reconcile half (`guard-setup.reconcile-interfaces`) has its own coverage;
 * every case here briefs the step with an empty diagnostics list.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GuardSetupInterfacesStepInput } from '@truecourse/guard-generator';
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner';
import type { InterfacesFile, MapperDiagnostic } from '@truecourse/shared';
import {
  buildInterfacesStep,
  type GuardSetupSessionContext,
  type InterfacesAuthorFn,
  type InterfacesAuthorRun,
} from '../../packages/core/src/services/guard-setup/index.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-step-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(guardInterfacesPath(dir)), { recursive: true });
  return dir;
}

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-19T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}' },
    ],
  },
  source: { web: 'tree' },
};

/** An authored half carrying one task per named place. */
function authored(places: string[]): InterfacesFile {
  return {
    version: 2,
    generatedAt: '2026-08-19T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: places.map((at, i) => ({
      id: `web/task-${i}`,
      type: 'web' as const,
      title: `Do something on ${at}`,
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate' as const, target: 'button "Go"' }],
      at,
      fingerprint: `sha256:web-${i}`,
    })),
  };
}

function writeHalves(r: string, opts: { authoredPlaces?: string[] } = {}): void {
  fs.writeFileSync(guardInterfacesPath(r), JSON.stringify(DERIVED));
  if (opts.authoredPlaces) {
    fs.writeFileSync(guardAuthoredInterfacesPath(r), JSON.stringify(authored(opts.authoredPlaces)));
  }
}

function stepInput(r: string, over: Partial<GuardSetupInterfacesStepInput> = {}): GuardSetupInterfacesStepInput {
  return {
    repoRoot: r,
    fingerprint: 'fp-1',
    refresh: false,
    replace: false,
    recipe: { build: 'true', api: { serve: ['node', 'server.mjs'] } },
    interfaces: [],
    diagnostics: [],
    ...over,
  };
}

/** A context whose driver must never be needed: authoring runs under its OWN run. */
function stubContext(): { context: GuardSetupSessionContext; spend: { sessions: number; turns: number } } {
  const spend = { sessions: 0, turns: 0 };
  return {
    spend,
    context: {
      async acquire() {
        throw new Error('the authoring half must not acquire the setup driver');
      },
      runId: () => undefined,
      note: () => {},
      addSpend: (sessions, spent) => {
        spend.sessions += sessions;
        spend.turns += spent.turns;
      },
      usageTotals: () => (spend.sessions > 0 ? { count: spend.sessions, ...spend, tokens: 0, costUsd: 0 } : null),
      finish: () => {},
    },
  };
}

/** An authoring thunk answering from a fixed run, recording what it was asked. */
function authoring(
  run: Partial<InterfacesAuthorRun> = {},
): { author: InterfacesAuthorFn; calls: { repoRoot: string; replace: boolean }[] } {
  const calls: { repoRoot: string; replace: boolean }[] = [];
  const author: InterfacesAuthorFn = async (opts) => {
    calls.push(opts);
    return {
      runId: 'run-author',
      authored: 3,
      skipped: [],
      places: [{ status: 'ok' }],
      diagnostics: [],
      spent: { turns: 12, tokens: 90_000, costUsd: 0.4 },
      ...run,
    };
  };
  return { author, calls };
}

describe('buildInterfacesStep — the authoring half', () => {
  it('spends ZERO sessions when every derived screen already carries tasks', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    const { author, calls } = authoring();
    const stub = stubContext();

    const result = await buildInterfacesStep(stub.context, { author })(stepInput(r));

    expect(result.status).toBe('ok');
    expect(result.reason).toMatch(/zero sessions/);
    expect(calls).toEqual([]);
    expect(result.sessionRunId).toBeUndefined();
    expect(stub.spend.sessions).toBe(0);
  });

  it('runs the authoring when a screen has no tasks, and records its run id', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root'] });
    const { author, calls } = authoring();
    const stub = stubContext();

    const result = await buildInterfacesStep(stub.context, { author })(stepInput(r));

    expect(calls).toEqual([{ repoRoot: r, replace: false }]);
    expect(result).toMatchObject({ status: 'ok', sessionRunId: 'run-author' });
    expect(result.reason).toMatch(/authored 3 task\(s\) across 1 place\(s\)/);
    // The authoring run's spend is folded into the setup run's usage totals.
    expect(stub.spend).toEqual({ sessions: 1, turns: 12 });
  });

  // `--replace` is an explicit re-author: a covered place is work again, and the
  // thunk is told, since the authoring engine re-selects the same way.
  it('--replace re-authors places that already carry tasks', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    const { author, calls } = authoring();

    const result = await buildInterfacesStep(stubContext().context, { author })(
      stepInput(r, { replace: true }),
    );

    expect(calls).toEqual([{ repoRoot: r, replace: true }]);
    expect(result.status).toBe('ok');
  });

  // A fresh clone has no authored half at all: every screen is work.
  it('authors every screen when the authored half is missing', async () => {
    const r = repo();
    writeHalves(r);
    const { author, calls } = authoring();

    await buildInterfacesStep(stubContext().context, { author })(stepInput(r));

    expect(calls).toHaveLength(1);
  });

  it('fails the STEP when the authoring engine throws, quoting the message', async () => {
    const r = repo();
    writeHalves(r);
    const author: InterfacesAuthorFn = async () => {
      throw new Error('the context pack could not be built');
    };

    const result = await buildInterfacesStep(stubContext().context, { author })(stepInput(r));

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('authoring failed: the context pack could not be built');
  });

  // Every session failing is a failed step; one surviving place is not.
  it('fails the step only when EVERY place failed', async () => {
    const r = repo();
    writeHalves(r);

    const allFailed = await buildInterfacesStep(stubContext().context, {
      author: authoring({ places: [{ status: 'failed' }, { status: 'failed' }], authored: 0 }).author,
    })(stepInput(r));
    expect(allFailed.status).toBe('failed');
    expect(allFailed.reason).toMatch(/every authoring session failed \(2 place\(s\)\)/);

    const partial = await buildInterfacesStep(stubContext().context, {
      author: authoring({ places: [{ status: 'failed' }, { status: 'ok' }], authored: 1 }).author,
    })(stepInput(r));
    expect(partial.status).toBe('ok');
  });

  // Run reporting lands on the step ROW — never in the catalog.
  it('returns the authoring run diagnostics for the step row', async () => {
    const r = repo();
    writeHalves(r);
    const stale: MapperDiagnostic = {
      surface: 'web',
      kind: 'authored-place-not-derived',
      subject: 'o-orgurl-settings',
      detail: 'no derivation produces this screen any more',
    };

    const result = await buildInterfacesStep(stubContext().context, {
      author: authoring({ diagnostics: [stale] }).author,
    })(stepInput(r));

    expect(result.diagnostics).toEqual([stale]);
    expect(result.resolutions).toBeUndefined();
    expect(result.changes).toBeUndefined();
  });

  // An unmapped repository has no screens at all: nothing to author, nothing spent.
  it('spends nothing on a repository with no derived screens', async () => {
    const r = repo();
    const { author, calls } = authoring();

    const result = await buildInterfacesStep(stubContext().context, { author })(stepInput(r));

    expect(result.status).toBe('ok');
    expect(calls).toEqual([]);
  });

  // A cli dispute the recipe cannot observe (no `entry`) is NOTED, never dropped —
  // and it never blocks the authoring half.
  it('notes an unreconcilable cli dispute without reaching a session', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    const dispute: MapperDiagnostic = {
      surface: 'cli',
      kind: 'tree-missing-flag',
      subject: 'relkit add --transport',
      detail: 'the probe lists it; the tree does not',
      command: ['add'],
      flag: '--transport',
    };

    const result = await buildInterfacesStep(stubContext().context, { author: authoring().author })(
      // No `entry` on the recipe: there is no program to observe with.
      stepInput(r, { diagnostics: [dispute] }),
    );

    expect(result.status).toBe('ok');
    expect(result.reason).toMatch(/1 cli dispute\(s\) left unreconciled/);
    expect(result.diagnostics).toEqual([dispute]);
    expect(result.resolutions).toBeUndefined();
  });
});
