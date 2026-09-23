/**
 * Operator mode's session driver runs on the one operator model, and retries
 * on the fallback when the environment names one — the variable is read by
 * `resolveFallbackModel`, and THIS is what proves it reaches the driver: the
 * driver declares what it will run on, fallback included, as its attribution.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createClaudeCodeSessionDriver } from '../../packages/core/src/services/llm/session-driver.js';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('the claude-code session driver', () => {
  it('runs on the operator model and retries on TRUECOURSE_FALLBACK_MODEL', () => {
    process.env.TRUECOURSE_MODEL = 'opus';
    process.env.TRUECOURSE_FALLBACK_MODEL = 'sonnet';

    expect(createClaudeCodeSessionDriver().attribution).toEqual({
      provider: 'claude-code',
      model: 'opus',
      fallbackModel: 'sonnet',
    });
  });

  it('names no fallback when the environment names none', () => {
    process.env.TRUECOURSE_MODEL = 'opus';
    delete process.env.TRUECOURSE_FALLBACK_MODEL;

    expect(createClaudeCodeSessionDriver().attribution).toEqual({ provider: 'claude-code', model: 'opus' });
  });
});
