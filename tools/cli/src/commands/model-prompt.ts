import * as p from "@clack/prompts";
import {
  discoverClaudeModels,
  pickDefaultModel,
  type ClaudeModelInfo,
} from "@truecourse/core/services/llm/model-discovery";
import { isInteractive } from "./helpers.js";

export interface ModelPickerOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Shape the discovered models into picker options.
 *
 * Order is preserved as the CLI reported it, so the list reads the same as
 * Claude Code's own `/model` picker.
 */
export function buildModelPickerOptions(models: ClaudeModelInfo[]): {
  options: ModelPickerOption[];
  initialValue: string | undefined;
} {
  return {
    options: models.map((m) => ({
      value: m.value,
      label: m.displayName,
      ...(m.description ? { hint: m.description } : {}),
    })),
    initialValue: pickDefaultModel(models)?.value,
  };
}

/** Seams so the prompt is testable without a TTY or a Claude login. */
export interface PromptModelChoiceOptions {
  discover?: () => Promise<ClaudeModelInfo[] | null>;
  select?: (args: {
    message: string;
    initialValue: string | undefined;
    options: ModelPickerOption[];
  }) => Promise<string | symbol>;
}

const defaultSelect: NonNullable<PromptModelChoiceOptions["select"]> = (args) =>
  p.select(args) as Promise<string | symbol>;

/**
 * Ask which Claude model the LLM rules should run on.
 *
 * Returns the chosen `--model` value, or `undefined` meaning "no explicit
 * choice" — which callers must treat as: pass no `--model` and let Claude Code
 * pick, exactly as analyze behaved before this prompt existed.
 *
 * `undefined` comes back whenever we cannot or should not ask:
 *   - non-interactive (scripts and agents must never block on stdin)
 *   - discovery unavailable (old CLI, protocol drift, not logged in)
 *   - the user cancelled
 *
 * Discovery is skipped entirely when non-interactive, so we never spawn a probe
 * whose answer nobody could act on.
 */
export async function promptModelChoice({
  discover = discoverClaudeModels,
  select = defaultSelect,
}: PromptModelChoiceOptions = {}): Promise<string | undefined> {
  if (!isInteractive()) return undefined;

  // Discovery spawns the CLI, so it is not instant. Say so — without this the
  // terminal just sits there, and on an install that can't answer the probe the
  // silence lasts until the timeout.
  const s = p.spinner();
  s.start("Checking which models you can use");

  let models: ClaudeModelInfo[] | null;
  try {
    models = await discover();
  } catch {
    // Discovery is a convenience, never a gate: a broken probe must not stop an
    // analysis that would otherwise run fine on Claude Code's default model.
    models = null;
  }

  if (!models || models.length === 0) {
    s.stop("Using the model Claude Code picks");
    return undefined;
  }
  s.stop(`${models.length} models available`);

  // Nothing to choose between — take it rather than spend a prompt on the user.
  if (models.length === 1) return models[0].value;

  const { options, initialValue } = buildModelPickerOptions(models);
  const choice = await select({
    message: "Which model should LLM rules use?",
    initialValue,
    options,
  });

  if (p.isCancel(choice)) return undefined;
  return typeof choice === "string" ? choice : undefined;
}
