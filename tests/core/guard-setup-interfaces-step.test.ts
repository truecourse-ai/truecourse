/**
 * THE INTERFACES STEP's AUTHORING HALF — `buildInterfacesStep`
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

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GuardSetupInterfacesStepInput } from '@truecourse/guard-generator';
import {
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
  authoringRecipeContract,
  screenAuthoringFingerprint,
} from '@truecourse/guard-runner';
import type { InterfacesFile, MapperDiagnostic } from '@truecourse/shared';
import {
  buildInterfacesStep,
  type GuardSetupSessionContext,
  type InterfacesAuthorFn,
  type InterfacesAuthorRun,
  type LiveScreensOpen,
} from '../../packages/core/src/services/guard-setup/index.js';
import type { LiveScreens } from '../../packages/core/src/services/interface-author/live-screen.js';

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
      steps: [{ kind: 'activate' as const, target: { role: 'button', name: 'Go' } }],
      at,
      fingerprint: `sha256:web-${i}`,
    })),
    resources: { web: DERIVED.resources!.web.filter((p) => places.includes(p.id)).map((p) => ({
      ...p, readables: { markers: [], elements: [], controls: [], rows: [] },
    })) },
  };
}

/** Give the authored half a ledger row per named screen, at today's inputs. */
function withLedger(r: string, rows: Record<string, 'authored' | 'failed'>): void {
  const half: InterfacesFile = JSON.parse(fs.readFileSync(guardAuthoredInterfacesPath(r), 'utf-8'));
  half.authoring = Object.fromEntries(
    Object.entries(rows).map(([id, status]) => [
      id,
      {
        status,
        inputFingerprint: screenAuthoringFingerprint({
          derived: DERIVED,
          place: DERIVED.resources!.web.find((place) => place.id === id)!,
          recipeContract: authoringRecipeContract(r),
        }),
      },
    ]),
  );
  fs.writeFileSync(guardAuthoredInterfacesPath(r), JSON.stringify(half));
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

/** The injected authoring thunk handles persistence; these tests exercise the step. */
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
): { author: InterfacesAuthorFn; calls: Parameters<InterfacesAuthorFn>[0][] } {
  const calls: Parameters<InterfacesAuthorFn>[0][] = [];
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
  it('spends ZERO sessions when every derived screen has tasks and established readables', async () => {
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

  it('enriches existing action-only catalogs and screens with unknown nested readables', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    const half = authored(['root', 'repos-repoid']);
    delete half.resources;
    fs.writeFileSync(guardAuthoredInterfacesPath(r), JSON.stringify(half));
    const first = authoring();
    await buildInterfacesStep(stubContext().context, { author: first.author })(stepInput(r));
    expect(first.calls).toHaveLength(1);

    const nested = authored(['root', 'repos-repoid']);
    nested.resources!.web.push({ id: 'details', kind: 'dialog', of: 'root', title: 'Details' });
    fs.writeFileSync(guardAuthoredInterfacesPath(r), JSON.stringify(nested));
    const second = authoring();
    await buildInterfacesStep(stubContext().context, { author: second.author })(stepInput(r));
    expect(second.calls).toHaveLength(1);
  });

  it.each(['rejected', 'failed', 'authored', 'empty'])('accounts for %s authoring in setup status', async (status) => {
    const r = repo();
    writeHalves(r);
    const { author } = authoring({ places: [{ status }] });
    const { context } = stubContext();
    context.note = vi.fn();
    const result = await buildInterfacesStep(context, { author })(stepInput(r));
    const failed = status === 'rejected' || status === 'failed';
    expect(result.status).toBe(failed ? 'failed' : 'ok');
    expect(context.note).toHaveBeenCalledExactlyOnceWith(failed ? 'failed' : 'completed');
  });

  it('runs the authoring when a screen has no tasks, and records its run id', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root'] });
    const { author, calls } = authoring();
    const stub = stubContext();

    const result = await buildInterfacesStep(stub.context, { author })(stepInput(r));

    expect(calls).toEqual([{ repoRoot: r, replace: false, refresh: false }]);
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

    expect(calls).toEqual([{ repoRoot: r, replace: true, refresh: false }]);
    expect(result.status).toBe('ok');
  });

  // An unauthored tree has no authored half at all: every screen is work.
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

    const { context } = stubContext();
    context.note = vi.fn();
    const result = await buildInterfacesStep(context, { author })(stepInput(r));

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('authoring failed: the context pack could not be built');
    expect(context.note).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('reports partial failure with the rejected screen and validation reason', async () => {
    const r = repo();
    writeHalves(r);

    const allFailed = await buildInterfacesStep(stubContext().context, {
      author: authoring({ places: [{ status: 'failed' }, { status: 'failed' }], authored: 0 }).author,
    })(stepInput(r));
    expect(allFailed.status).toBe('failed');
    expect(allFailed.reason).toMatch(/every authoring session failed \(2 place\(s\)\)/);

    // One screen that failed no longer holds the step open: it carries a ledger
    // row now, so the step has settled its whole work list and the row names
    // what did not settle.
    const partial = await buildInterfacesStep(stubContext().context, {
      author: authoring({ places: [{ status: 'failed', placeId: 'expenses-id', problems: ['expense-exists already names a different state'] }, { status: 'authored', placeId: 'root' }], authored: 1 }).author,
    })(stepInput(r));
    expect(partial.status).toBe('ok');
    expect(partial.reason).toContain('authored 1 task(s) across 1 place(s)');
    expect(partial.reason).toContain('expenses-id: expense-exists already names a different state');
    expect(partial.failedScreens).toEqual([
      { place: 'expenses-id', reason: 'expense-exists already names a different state' },
    ]);
  });

  /**
   * A screen the ledger holds as unsettled is not work by itself — its inputs
   * have not moved — so the step spends nothing on it and the ROW is what says
   * it is there to be refreshed.
   */
  it('names the screens the ledger holds as unsettled, and spends nothing on them', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    withLedger(r, { root: 'failed' });
    const { author, calls } = authoring();

    const result = await buildInterfacesStep(stubContext().context, { author })(stepInput(r));

    expect(calls).toEqual([]);
    expect(result.status).toBe('ok');
    expect(result.reason).toMatch(/1 of them unauthored, awaiting a refresh/);
    expect(result.failedScreens).toEqual([{ place: 'root', reason: 'authoring failed' }]);
  });

  it('re-opens an unsettled screen on a refresh, and a retry that authored is no longer awaiting one', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    withLedger(r, { root: 'failed' });
    const { author, calls } = authoring({ places: [{ status: 'authored', placeId: 'root' }], authored: 1 });

    const result = await buildInterfacesStep(stubContext().context, { author })(stepInput(r, { refresh: true }));

    expect(calls).toEqual([{ repoRoot: r, replace: false, refresh: true }]);
    expect(result.status).toBe('ok');
    expect(result.failedScreens).toBeUndefined();
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

// The live screens: stood up the first time the run asks (a screen whose live
// fragment is not cached), and torn down with the run — whatever it made of itself.
describe('the live screens', () => {
  /** A live-screens seam whose observer answers nothing, recording its lifecycle. */
  function liveSeam(open: LiveScreensOpen | 'throw' = 'ok') {
    const events: string[] = [];
    const live: LiveScreens = {
      observer: {
        async observe() { return { ok: false, reason: 'stubbed' }; },
        async probe() { return { ok: false, reason: 'stubbed' }; },
        async close() {},
      },
    };
    const seam = async (): Promise<LiveScreensOpen> => {
      events.push('open');
      if (open === 'throw') throw new Error('the world exploded');
      if (open === 'ok') return { ok: true, live, async close() { events.push('close'); } };
      return open;
    };
    return { seam, events, live };
  }

  it('opens the screens the first time the run asks, once, and closes them after the run', async () => {
    const r = repo();
    writeHalves(r);
    const { seam, events, live } = liveSeam();
    const { author } = authoring();
    const handed: (LiveScreens | undefined)[] = [];
    const result = await buildInterfacesStep(stubContext().context, {
      author: async (opts) => {
        handed.push(await opts.openLive?.(), await opts.openLive?.());
        return author(opts);
      },
      liveScreens: seam,
    })(stepInput(r));
    expect(result.status).toBe('ok');
    expect(handed).toEqual([live, live]);
    expect(events).toEqual(['open', 'close']);
    expect(result.reason).not.toMatch(/not observed/);
  });

  it('never stands the world up when the run does not ask — every fragment came from the cache', async () => {
    const r = repo();
    writeHalves(r);
    const { seam, events } = liveSeam();
    const { author, calls } = authoring();
    const result = await buildInterfacesStep(stubContext().context, { author, liveScreens: seam })(stepInput(r));
    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it('closes them when the run throws, and still fails the step with the run\'s message', async () => {
    const r = repo();
    writeHalves(r);
    const { seam, events } = liveSeam();
    const result = await buildInterfacesStep(stubContext().context, {
      author: async (opts) => {
        await opts.openLive?.();
        throw new Error('the provider fell over');
      },
      liveScreens: seam,
    })(stepInput(r));
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/the provider fell over/);
    expect(events).toEqual(['open', 'close']);
  });

  it('notes a world that would not come up and runs the authoring on source alone', async () => {
    const r = repo();
    writeHalves(r);
    const { seam, events } = liveSeam({ ok: false, reason: 'the recipe declares no `web` block' });
    const { author } = authoring();
    let handed: LiveScreens | undefined;
    const result = await buildInterfacesStep(stubContext().context, {
      author: async (opts) => {
        handed = await opts.openLive?.();
        return author(opts);
      },
      liveScreens: seam,
    })(stepInput(r));
    expect(result.status).toBe('ok');
    expect(result.reason).toMatch(/screens not observed live: the recipe declares no `web` block/);
    expect(handed).toBeUndefined();
    expect(events).toEqual(['open']);
  });

  it('never stands the world up for a step with zero work', async () => {
    const r = repo();
    writeHalves(r, { authoredPlaces: ['root', 'repos-repoid'] });
    withLedger(r, { root: 'authored', 'repos-repoid': 'authored' });
    const { seam, events } = liveSeam();
    const { author, calls } = authoring();
    const result = await buildInterfacesStep(stubContext().context, { author, liveScreens: seam })(stepInput(r));
    expect(result.reason).toMatch(/zero sessions/);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });
});
