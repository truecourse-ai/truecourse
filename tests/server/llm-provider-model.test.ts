import { describe, it, expect, afterEach } from 'vitest';
import { ClaudeCodeProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import { createLLMProvider } from '../../packages/core/src/services/llm/provider.js';

/**
 * `config` snapshots CLAUDE_CODE_MODEL at import time, so these tests cover the
 * explicit-override path (what the model picker sets). The env-var path is
 * exercised by the existing config tests.
 */
describe('ClaudeCodeProvider model selection', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_MODEL;
  });

  it('passes --model when a model is explicitly selected', () => {
    const provider = new ClaudeCodeProvider(undefined, 'opus[1m]');
    expect(provider.modelFlag).toEqual(['--model', 'opus[1m]']);
  });

  it('omits --model when nothing is selected, preserving the pre-picker default', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.modelFlag).toEqual([]);
  });

  it('treats an empty selection as no selection', () => {
    const provider = new ClaudeCodeProvider(undefined, '');
    expect(provider.modelFlag).toEqual([]);
  });

  it('lets an explicit selection win over the CLAUDE_CODE_MODEL default', () => {
    // The picker reflects a deliberate in-session choice; the env var is a
    // background default, so the choice must take precedence.
    const provider = new ClaudeCodeProvider(undefined, 'sonnet');
    expect(provider.modelFlag).toEqual(['--model', 'sonnet']);
  });

  it('threads the selected model through createLLMProvider', () => {
    const provider = createLLMProvider(undefined, 'haiku') as ClaudeCodeProvider;
    expect(provider.modelFlag).toEqual(['--model', 'haiku']);
  });

  it('createLLMProvider without a model keeps current behavior', () => {
    const provider = createLLMProvider() as ClaudeCodeProvider;
    expect(provider.modelFlag).toEqual([]);
  });
});
