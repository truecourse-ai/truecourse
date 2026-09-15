/**
 * MODEL RESOLUTION after the one-shot retirement.
 *
 * `resolveGuardModels` shrank to the two stages that still ride the transport —
 * `{ match, recipe, fallback }`. Every other guard-generate stage is an agent
 * SESSION on the ONE model its run's driver names, so the per-stage table can
 * no longer influence them: the retired ids (`guard.extract`, `guard.generate`,
 * `guard.fidelity`, `guard.triage`, …) are simply not in the table.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { GuardGenerateModels } from '@truecourse/guard-generator';
import { STAGE_DEFAULTS, resolveModel } from '../../packages/core/src/config/llm-models.js';

/** Stage ids the session retirement removed — nothing may resolve them. */
const RETIRED_STAGE_IDS = [
  'guard.extract',
  'guard.flows',
  'guard.generate',
  'guard.retry',
  'guard.fidelity',
  'guard.triage',
];

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('GuardGenerateModels — the shape the retirement left', () => {
  it('accepts only the two surviving one-shots plus the fallback', () => {
    const models: GuardGenerateModels = { match: 'sonnet', recipe: 'sonnet', fallback: 'sonnet' };
    expect(Object.keys(models).sort()).toEqual(['fallback', 'match', 'recipe']);
  });

  it('no longer admits a retired session stage', () => {
    // @ts-expect-error — `extract` and `triage` became agent sessions; they have
    // no per-stage tier, so naming one here must not compile.
    const stale: GuardGenerateModels = { match: 'sonnet', extract: 'opus', triage: 'opus' };
    expect(stale.match).toBe('sonnet');
  });
});

describe('the per-stage table', () => {
  it('holds no retired id', () => {
    for (const id of RETIRED_STAGE_IDS) {
      expect(Object.keys(STAGE_DEFAULTS)).not.toContain(id);
    }
  });

  it('answers a live one-shot with its tier, and yields to its env override', () => {
    expect(resolveModel('guard.match')).toBe('sonnet');
    expect(STAGE_DEFAULTS['guard.match']).toBe('sonnet');

    process.env.TRUECOURSE_MODEL_GUARD_MATCH = 'haiku';
    expect(resolveModel('guard.match')).toBe('haiku');
    // The override is per stage: its neighbour is untouched.
    expect(resolveModel('guard.recipe')).toBe(STAGE_DEFAULTS['guard.recipe']);
  });
});
