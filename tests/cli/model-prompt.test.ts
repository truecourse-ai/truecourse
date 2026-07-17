import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  promptModelChoice,
  buildModelPickerOptions,
} from '../../tools/cli/src/commands/model-prompt.js';
import type { ClaudeModelInfo } from '@truecourse/core/services/llm/model-discovery';

const MODELS: ClaudeModelInfo[] = [
  { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-4-8[1m]' },
  { value: 'opus[1m]', displayName: 'Opus', description: 'Opus 4.8' },
  { value: 'claude-fable-5[1m]', displayName: 'Fable', description: 'Fable 5' },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' },
];

const originalTTY = process.stdin.isTTY;

beforeEach(() => {
  process.stdin.isTTY = true;
});

afterEach(() => {
  process.stdin.isTTY = originalTTY;
});

describe('buildModelPickerOptions', () => {
  it('offers every discovered model, in the order the CLI reported them', () => {
    const { options } = buildModelPickerOptions(MODELS);
    expect(options.map((o) => o.value)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'haiku',
    ]);
  });

  it('pre-selects an Opus model', () => {
    expect(buildModelPickerOptions(MODELS).initialValue).toBe('opus[1m]');
  });

  it('does not pre-select Fable even when it is the only premium option', () => {
    const { initialValue } = buildModelPickerOptions([
      { value: 'claude-fable-5[1m]', displayName: 'Fable' },
      { value: 'haiku', displayName: 'Haiku' },
    ]);
    expect(initialValue).toBe('haiku');
  });

  it('carries the description through as the option hint', () => {
    const opus = buildModelPickerOptions(MODELS).options.find((o) => o.value === 'opus[1m]');
    expect(opus?.hint).toBe('Opus 4.8');
  });

  it('omits the hint when a model has no description', () => {
    const dflt = buildModelPickerOptions(MODELS).options.find((o) => o.value === 'default');
    expect(dflt).not.toHaveProperty('hint');
  });
});

describe('promptModelChoice', () => {
  it('returns the model the user picked', async () => {
    const chosen = await promptModelChoice({
      discover: async () => MODELS,
      select: async () => 'haiku',
    });
    expect(chosen).toBe('haiku');
  });

  it('offers the picker with Opus pre-selected', async () => {
    const select = vi.fn(async () => 'opus[1m]');

    await promptModelChoice({ discover: async () => MODELS, select });

    expect(select.mock.calls[0][0].initialValue).toBe('opus[1m]');
    expect(select.mock.calls[0][0].options).toHaveLength(4);
  });

  it('returns undefined when discovery fails, keeping the pre-picker default', async () => {
    const select = vi.fn(async () => 'haiku');

    const chosen = await promptModelChoice({ discover: async () => null, select });

    expect(chosen).toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it('does not prompt or probe when non-interactive', async () => {
    process.stdin.isTTY = false;
    const discover = vi.fn(async () => MODELS);
    const select = vi.fn(async () => 'haiku');

    const chosen = await promptModelChoice({ discover, select });

    expect(chosen).toBeUndefined();
    expect(discover).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('returns undefined when the user cancels, so the caller keeps its default', async () => {
    const chosen = await promptModelChoice({
      discover: async () => MODELS,
      select: async () => Symbol.for('clack:cancel'),
    });
    expect(chosen).toBeUndefined();
  });

  it('returns undefined when discovery throws rather than failing the run', async () => {
    const chosen = await promptModelChoice({
      discover: async () => {
        throw new Error('claude exploded');
      },
    });
    expect(chosen).toBeUndefined();
  });

  it('skips the prompt when only one model is available and uses it', async () => {
    const select = vi.fn(async () => 'unused');

    const chosen = await promptModelChoice({
      discover: async () => [{ value: 'sonnet', displayName: 'Sonnet' }],
      select,
    });

    expect(chosen).toBe('sonnet');
    expect(select).not.toHaveBeenCalled();
  });

  it('returns undefined when discovery reports an empty list', async () => {
    expect(await promptModelChoice({ discover: async () => [] })).toBeUndefined();
  });
});
