/**
 * WORLD SETUP — what setup does when the product runs from world scripts:
 * make sure the tree has three scripts that really bring the product up.
 *
 * Scripts that already hold are kept: the engine builds and boots them, and a
 * pass costs no session. Only a tree with no scripts, or with scripts that no
 * longer work, gets the world session (`world-session.ts`), which writes them
 * and is held to that same build and boot. Scripts that stopped working are
 * handed to that session with where they failed and what they printed, so it
 * starts from them and not from nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionDriver, SessionEvent, SessionPersistence } from '@truecourse/agent-loop';
import {
  bootProductWorld,
  buildProductWorld,
  corpusKeptDocs,
  missingWorldScripts,
  releaseWorldSlot,
  reserveWorldSlot,
  type WorldSlot,
} from '@truecourse/guard-runner';
import type { ProductWorld } from '@truecourse/shared';
import { runSessionPool } from '../agent/session-pool.js';
import { describeSessionFailure } from '../guard-setup/session-context.js';
import {
  WORLD_SESSION_TIMEOUT_MS,
  worldSessionBriefing,
  worldSessionDef,
  type WorldScriptsFailure,
  type WorldSessionInput,
  type WorldSessionOutcome,
} from './world-session.js';

export interface WorldSetupInput {
  repoRoot: string;
  /** The world's identity on this host (the compose project name). */
  worldId: string;
  /** The run's driver and transcript store, built only when a session is needed. */
  acquire: () => Promise<{ driver: SessionDriver; persistence: SessionPersistence }>;
  /** Write the scripts afresh even when the ones in the tree still work. */
  refresh?: boolean;
  signal?: AbortSignal;
  onPhase?: (phase: 'checking' | 'session') => void;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

export type WorldSetupResult =
  | {
      status: 'ok';
      /** `kept`: the tree's scripts held. `written`: a session wrote them. */
      outcome: 'kept' | 'written';
      world: ProductWorld;
      summary?: string;
      notRunning: string[];
      spent: { sessions: number; turns: number; tokens: number; costUsd: number };
    }
  | { status: 'failed'; reason: string; spent: { sessions: number; turns: number; tokens: number; costUsd: number } };

export async function runWorldSetup(input: WorldSetupInput): Promise<WorldSetupResult> {
  const { repoRoot } = input;
  const slot = await reserveWorldSlot(input.worldId);
  const spent = { sessions: 0, turns: 0, tokens: 0, costUsd: 0 };
  try {
    let failed: WorldScriptsFailure | undefined;
    if (!input.refresh && missingWorldScripts(repoRoot).length === 0) {
      input.onPhase?.('checking');
      const standing = await proveWorld(repoRoot, slot, input.signal);
      if (standing.ok) return { status: 'ok', outcome: 'kept', world: standing.world, notRunning: [], spent };
      failed = standing.failure;
    }

    input.onPhase?.('session');
    const sessionInput: WorldSessionInput = {
      repoRoot,
      slot,
      documents: documentList(repoRoot),
      ...(failed ? { failed } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    };
    const { def, state } = worldSessionDef(sessionInput);
    const { driver, persistence } = await input.acquire();
    const results = await runSessionPool<WorldSessionInput, WorldSessionOutcome>({
      items: [sessionInput],
      workItem: () => 'world',
      session: () => def,
      briefing: (item) => [worldSessionBriefing(item)],
      driver,
      persistence,
      concurrency: 1,
      timeoutMs: WORLD_SESSION_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      fold: () => {
        /* one item; folded below */
      },
    });
    const outcome = results[0]?.outcome;
    if (!outcome) return { status: 'failed', reason: 'cancelled before the world session started', spent };
    spent.sessions = 1;
    spent.turns = outcome.spent.turns;
    spent.tokens = outcome.spent.tokens;
    spent.costUsd = outcome.spent.costUsd;
    if (outcome.status === 'failed') {
      return { status: 'failed', reason: `the product was not brought up: ${describeSessionFailure(outcome.failure)}`, spent };
    }
    const world = state.verified();
    // The outcome check already refused anything else; this is the type saying so.
    if (!world) return { status: 'failed', reason: 'the world session ended without scripts the engine had verified', spent };
    return { status: 'ok', outcome: 'written', world, summary: outcome.output.summary, notRunning: outcome.output.notRunning, spent };
  } finally {
    releaseWorldSlot(slot);
  }
}

/** The engine's own build and boot of the tree's scripts: the world they bring up, or where they failed. */
async function proveWorld(
  repoRoot: string,
  slot: WorldSlot,
  signal?: AbortSignal,
): Promise<{ ok: true; world: ProductWorld } | { ok: false; failure: WorldScriptsFailure }> {
  const run = { slot, ...(signal ? { signal } : {}) };
  const exited = (script: string, result: { timedOut?: boolean; exitCode: number | null; output: string }): string =>
    `world/${script}.sh ${result.timedOut ? 'did not finish in time' : `exited ${result.exitCode ?? 'without a code'}`}:\n${result.output}`;
  const build = await buildProductWorld(repoRoot, run);
  if (!build.ok) return { ok: false, failure: { stage: 'build', output: exited('build', build) } };
  const boot = await bootProductWorld(repoRoot, run);
  if (!boot.ok) return { ok: false, failure: { stage: boot.stage, output: boot.reason } };
  const down = await boot.running.down();
  if (!down.ok) return { ok: false, failure: { stage: 'down', output: exited('down', down) } };
  return { ok: true, world: boot.running.world };
}

/** The corpus documents, each with its first heading as a title. */
function documentList(repoRoot: string): Array<{ path: string; title: string }> {
  return corpusKeptDocs(repoRoot).map((doc) => {
    let title = path.basename(doc);
    try {
      const heading = fs
        .readFileSync(path.resolve(repoRoot, doc), 'utf-8')
        .split('\n', 80)
        .find((line) => /^#{1,3}\s+\S/.test(line));
      if (heading) title = heading.replace(/^#+\s+/, '').trim();
    } catch {
      /* a document that is not in the tree keeps its file name */
    }
    return { path: doc, title };
  });
}
