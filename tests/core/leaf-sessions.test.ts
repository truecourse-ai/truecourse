/**
 * THE LEAF JUDGEMENTS, as one-turn sessions.
 *
 * Every LLM call the product makes is now a turn of a session, including the
 * ones that used to be a single prompt in and raw text out. What these cases
 * pin is that the collapse kept what a one-shot call gave its caller:
 *
 *  - ONE session per ask, with no tools and one turn (plus the single
 *    corrective re-ask a leaf judgement has always had);
 *  - the model's structured answer returned to the deterministic engine, which
 *    still owns every loop, cache and fail-open rule around it;
 *  - a lost ask surfacing as a THROW naming why — the shape the transport's
 *    failure had — while the run's per-kind tally records the loss, so a
 *    provider that lost everything still stops the run before it writes;
 *  - an empty credit balance travelling as `CreditsExhaustedError`, not as a
 *    lost call.
 */

import { describe, it, expect } from 'vitest';
import { CreditsExhaustedError } from '@truecourse/shared';
import {
  MATCH_SESSION_KIND,
  RECIPE_PROPOSE_SESSION_KIND,
  WORLD_CLASSIFY_SESSION_KIND,
  isSystemicSessionLoss,
} from '@truecourse/guard-generator';
import { CREDITS_PAUSE_FAILURE } from '@truecourse/shared';
import { createGuardGenerateLeafSessions } from '../../packages/core/src/services/guard-generate/leaf-sessions.js';
import { createRecipeProposeSession } from '../../packages/core/src/services/guard-setup/recipe-propose.js';
import { createLeafSessionSeam } from '../../packages/core/src/services/agent/leaf-session.js';
import { oneTurnSessionDef } from '../../packages/core/src/services/agent/one-turn.js';
import { z } from 'zod';
import {
  memoryPersistence,
  outcome,
  stubDriver,
  transportFailure,
  malformedFailure,
  type StubDriver,
} from './spec-scan-session-stub.js';
import type { DriverResult } from '../../packages/agent-loop/src/index.js';

/** The engine's own inputs, cut to what each briefing builder reads. */
const MATCH_CTX = {
  flow: { id: 'flow-1', goal: 'sign in', fingerprint: 'fp' },
  milestones: [{ index: 1, claim: 'the user can sign in', section: 'docs/auth.md#signin' }],
  surface: 'cli' as const,
  interfaces: [],
  capabilities: [],
} as never;

const WORLD_FLOWS = [{ id: 'flow-1', goal: 'sign in', milestones: ['the user can sign in'] }] as never;

const RECIPE_INPUT = { packageJson: '{}', presentInputs: ['package.json'] } as never;

function seams(script: (kind: string) => DriverResult): {
  stub: StubDriver;
  leaves: ReturnType<typeof createGuardGenerateLeafSessions>;
  recipe: ReturnType<typeof createRecipeProposeSession>;
} {
  const stub = stubDriver((call) => script(call.kind));
  const { persistence } = memoryPersistence();
  const acquire = async () => ({ driver: stub.driver, persistence });
  return {
    stub,
    leaves: createGuardGenerateLeafSessions({ acquire }),
    recipe: createRecipeProposeSession({ acquire }),
  };
}

const ANSWERS: Record<string, unknown> = {
  [MATCH_SESSION_KIND]: { plan: [{ interfaceId: 'cli:login', milestone: 1 }] },
  [WORLD_CLASSIFY_SESSION_KIND]: { mutators: [] },
  [RECIPE_PROPOSE_SESSION_KIND]: { build: 'pnpm build', entry: ['node', 'dist/cli.js'] },
};

describe('a leaf judgement is one session, with no tools and one turn', () => {
  it('a leaf whose engine re-asks itself takes ONE turn and hands the raw answer over', async () => {
    // The match and the recipe proposal quote an invalid answer back with
    // their own correction: a shell repair under that would double the spend
    // and hide the output they quote, so the session repairs nothing.
    const invalid = { nonsense: true };
    const { stub, leaves, recipe } = seams(() => outcome(invalid));

    await expect(leaves.matchRunner(MATCH_CTX)).resolves.toEqual(invalid);
    await expect(recipe.runner(RECIPE_INPUT)).resolves.toEqual(invalid);

    for (const call of stub.calls) {
      expect(call.def.budget).toMatchObject({ turns: 1, maxResumes: 0 });
      expect(call.def.outcomeSchemaRepairs).toBe(0);
      // The model is still asked for the engine's shape.
      expect(call.def.outcomeInputSchema).toBeDefined();
    }
  });

  it('shares the catalog at the system cache boundary across flows and corrections', async () => {
    const { stub, leaves } = seams((kind) => outcome(ANSWERS[kind]));
    const base = {
      surface: 'web',
      interfaces: [{ id: 'web:login', title: 'Sign in', entry: '/login', steps: ['click Sign in'], context: ['requires state: anonymous'] }],
      capabilities: ['browser'],
      flow: { id: 'login', title: 'Log in', goal: 'Access the account' },
      milestones: [{ order: 1, claim: 'Users can log in' }],
    };
    await leaves.matchRunner(base);
    await leaves.matchRunner({ ...base, flow: { id: 'logout', title: 'Log out', goal: 'End the session' },
      milestones: [{ order: 1, claim: 'Users can log out' }],
      correction: { invalidOutput: 'invalid previous reply' } });

    expect(stub.calls[0].def.systemPrompt).toBe(stub.calls[1].def.systemPrompt);
    expect(stub.calls[0].def.systemPrompt).toContain('requires state: anonymous');
    expect(stub.calls[0].def.systemPrompt).toContain('click Sign in');
    expect(stub.calls[0].def.systemPrompt).not.toContain('Users can log in');
    expect(stub.calls[0].briefing).toContain('Users can log in');
    expect(stub.calls[1].briefing).toContain('Users can log out');
    expect(stub.calls[1].briefing).toContain('invalid previous reply');
    expect(stub.calls[0].briefing).not.toContain('INTERFACE CATALOG');

    await leaves.matchRunner({ ...base, interfaces: [{ ...base.interfaces[0], entry: '/sign-in' }] });
    expect(stub.calls[2].def.systemPrompt).not.toBe(stub.calls[0].def.systemPrompt);
  });
});

describe('a lost ask', () => {
  it('throws naming why, as a failed call did', async () => {
    const { leaves } = seams(() => transportFailure());
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toThrow(/the provider failed/);
  });

  it('is tallied per kind, and a kind that lost EVERY ask is a systemic loss', async () => {
    const { leaves } = seams(() => transportFailure());
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toThrow();
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toThrow();

    const match = leaves.summaries().find((s) => s.kind === MATCH_SESSION_KIND)!;
    expect(match).toMatchObject({ ran: 2, failed: 2, allTransport: true });
    expect(match.firstError).toMatch(/the provider failed/);
    expect(isSystemicSessionLoss(match)).toBe(true);
  });

  it('a MALFORMED loss is not the provider’s, so it is not a systemic one', async () => {
    const { leaves } = seams(() => malformedFailure());
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toThrow(/malformed/);
    const match = leaves.summaries().find((s) => s.kind === MATCH_SESSION_KIND)!;
    expect(match).toMatchObject({ ran: 1, failed: 1, allTransport: false });
    expect(isSystemicSessionLoss(match)).toBe(false);
  });

  it('an EMPTY BALANCE stops the run rather than counting as a lost ask', async () => {
    const { leaves } = seams(() => ({ kind: 'failure', failure: CREDITS_PAUSE_FAILURE }));
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toBeInstanceOf(CreditsExhaustedError);
  });

  it('a driver that cannot even be built is the provider being unusable', async () => {
    const leaves = createGuardGenerateLeafSessions({
      acquire: async () => {
        throw new Error('No API key for provider `openai`');
      },
    });
    await expect(leaves.matchRunner(MATCH_CTX)).rejects.toThrow(/No API key/);
    const match = leaves.summaries().find((s) => s.kind === MATCH_SESSION_KIND)!;
    expect(match).toMatchObject({ ran: 1, failed: 1, allTransport: true });
  });
});

describe('what a leaf session spends', () => {
  it('reports every settled session to the run that totals its own spend', async () => {
    const spent: { turns: number; tokens: number; costUsd: number }[] = [];
    const stub = stubDriver(() => outcome({ ok: true }));
    const { persistence } = memoryPersistence();
    const seam = createLeafSessionSeam({
      kind: 'test.leaf',
      acquire: async () => ({ driver: stub.driver, persistence }),
      onSpend: (s) => spent.push(s),
    });
    await seam.ask({
      session: {
        kind: 'test.leaf',
        title: 'Test leaf',
        systemPrompt: 'answer',
        outcomeSchema: z.object({ ok: z.boolean() }),
        tokenCeiling: 1000,
      },
      workItem: 'one',
      briefing: 'the question',
    });
    expect(spent).toHaveLength(1);
    expect(seam.summary()).toMatchObject({ ran: 1, failed: 0, fromCache: 0 });
  });
});

describe('oneTurnSessionDef', () => {
  it('spends nothing on a re-ask when its caller asked for none', () => {
    const def = oneTurnSessionDef({
      kind: 'test.leaf',
      title: 'Test leaf',
      systemPrompt: 'answer',
      outcomeSchema: z.object({ ok: z.boolean() }),
      tokenCeiling: 1000,
      reasks: 0,
    });
    expect(def.budget).toMatchObject({ turns: 1, maxResumes: 0, tokenCeiling: 1000 });
    expect(def.outcomeSchemaRepairs).toBe(0);
  });
});
