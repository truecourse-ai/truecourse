import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  promptModelChoice,
  buildModelPickerOptions,
} from '../../tools/cli/src/commands/model-prompt.js';
import type { ClaudeModelInfo } from '@truecourse/core/services/llm/model-discovery';

/** Mirrors what a real `claude` reports, `default` included. */
const MODELS: ClaudeModelInfo[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
    resolvedModel: 'claude-opus-4-8[1m]',
  },
  {
    value: 'opus[1m]',
    displayName: 'Opus',
    description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
    resolvedModel: 'claude-opus-4-8[1m]',
  },
  {
    value: 'claude-fable-5[1m]',
    displayName: 'Fable',
    description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
    resolvedModel: 'claude-fable-5',
  },
  {
    value: 'sonnet',
    displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    resolvedModel: 'claude-sonnet-5',
  },
  {
    value: 'haiku',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
    resolvedModel: 'claude-haiku-4-5-20251001',
  },
];

const originalTTY = process.stdin.isTTY;

beforeEach(() => {
  process.stdin.isTTY = true;
});

afterEach(() => {
  process.stdin.isTTY = originalTTY;
});

describe('buildModelPickerOptions', () => {
  it('labels every model with its description, so each row names its model', () => {
    // Not clack's `hint`: that renders only on the focused row, leaving the
    // rest as bare names.
    const { options } = buildModelPickerOptions(MODELS);
    expect(options.map((o) => o.label)).toEqual([
      'Opus 4.8 with 1M context · Best for everyday, complex tasks',
      'Opus 4.8 with 1M context · Best for everyday, complex tasks',
      'Fable 5 · Most capable for your hardest and longest-running tasks',
      'Sonnet 5 · Efficient for routine tasks',
      'Haiku 4.5 · Fastest for quick answers',
    ]);
  });

  it('never sets a hint, which clack would parenthesize and show on one row only', () => {
    for (const option of buildModelPickerOptions(MODELS).options) {
      expect(option).not.toHaveProperty('hint');
    }
  });

  it('falls back to the display name when a model has no description', () => {
    const { options } = buildModelPickerOptions([{ value: 'sonnet', displayName: 'Sonnet' }]);
    expect(options[0].label).toBe('Sonnet');
  });

  it('preserves the order the CLI reported', () => {
    const { options } = buildModelPickerOptions(MODELS);
    expect(options.map((o) => o.value)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
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
  });

  it('does not offer `default` — it names no model', async () => {
    const select = vi.fn(async () => 'opus[1m]');

    await promptModelChoice({ discover: async () => MODELS, select });

    expect(select.mock.calls[0][0].options.map((o) => o.value)).toEqual([
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku',
    ]);
  });

  it('falls back when the only model on offer is an opaque alias', async () => {
    const select = vi.fn(async () => 'default');

    const chosen = await promptModelChoice({
      discover: async () => [MODELS[0]],
      select,
    });

    expect(chosen).toBeUndefined();
    expect(select).not.toHaveBeenCalled();
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
