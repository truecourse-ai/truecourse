/**
 * ONE MODEL, whatever the work.
 *
 * Operator mode — this process's own `claude` login — has no Models page to name
 * a model on, so it takes one from the environment: `TRUECOURSE_MODEL`, else
 * `opus`. Every call and every session of every run uses that one model; there
 * is no per-stage tier and no per-stage override, so a variable naming a stage
 * is an ordinary unread variable.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_OPERATOR_MODEL,
  resolveFallbackModel,
  resolveModel,
} from '../../packages/core/src/config/llm-models.js';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('resolveModel — the one operator model', () => {
  it('defaults to opus', () => {
    delete process.env.TRUECOURSE_MODEL;
    expect(resolveModel()).toBe('opus');
    expect(DEFAULT_OPERATOR_MODEL).toBe('opus');
  });

  it('yields to TRUECOURSE_MODEL, trimmed', () => {
    process.env.TRUECOURSE_MODEL = '  claude-sonnet-4-6 ';
    expect(resolveModel()).toBe('claude-sonnet-4-6');
  });

  it('treats a blank TRUECOURSE_MODEL as unset', () => {
    process.env.TRUECOURSE_MODEL = '   ';
    expect(resolveModel()).toBe(DEFAULT_OPERATOR_MODEL);
  });

  it('answers the same model for every stage there is', () => {
    process.env.TRUECOURSE_MODEL = 'opus-of-the-day';
    // The stages that used to hold tiers of their own: the realization match,
    // the claim diff, the recipe proposal, the seed, the state reconcile and
    // the visual judge. One resolution answers all of them.
    expect(new Set([resolveModel(), resolveModel(), resolveModel()])).toEqual(
      new Set(['opus-of-the-day']),
    );
  });

  it('reads no per-stage variable', () => {
    process.env.TRUECOURSE_MODEL_GUARD_MATCH = 'haiku';
    process.env.TRUECOURSE_MODEL_GUARD_SEED = 'haiku';
    expect(resolveModel()).toBe(DEFAULT_OPERATOR_MODEL);
  });

  it('no longer honours CLAUDE_CODE_MODEL', () => {
    process.env.CLAUDE_CODE_MODEL = 'haiku';
    expect(resolveModel()).toBe(DEFAULT_OPERATOR_MODEL);
  });
});

describe('resolveFallbackModel — the retry model, a separate question', () => {
  it('is null when unset', () => {
    delete process.env.TRUECOURSE_FALLBACK_MODEL;
    expect(resolveFallbackModel()).toBeNull();
  });

  it('reads TRUECOURSE_FALLBACK_MODEL, trimmed', () => {
    process.env.TRUECOURSE_FALLBACK_MODEL = ' sonnet ';
    expect(resolveFallbackModel()).toBe('sonnet');
  });

  it('is not moved by TRUECOURSE_MODEL', () => {
    process.env.TRUECOURSE_MODEL = 'opus';
    delete process.env.TRUECOURSE_FALLBACK_MODEL;
    expect(resolveFallbackModel()).toBeNull();
  });
});
