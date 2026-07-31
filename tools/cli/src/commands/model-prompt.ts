import * as p from "@clack/prompts";
import {
  discoverClaudeModels,
  pickDefaultModel,
  selectableModels,
  type ClaudeModelInfo,
} from "@truecourse/core/services/llm/model-discovery";
import { isInteractive } from "./helpers.js";

export interface ModelPickerOption {
  value: string;
  label: string;
}

/**
 * The model half of a description: everything before the pitch.
 *
 * Claude Code's descriptions are `"<model> · <pitch>"` — "Opus 4.8 with 1M
 * context · Best for everyday, complex tasks". Only the model half earns a
 * place in the list: anyone choosing a model already has Claude Code and knows
 * what Opus is, so the pitch is noise repeated on every row.
 *
 * Falls back to `displayName` when there's no description, or when cutting the
 * pitch leaves nothing behind.
 */
function modelHalf(model: ClaudeModelInfo): string {
  return model.description?.split('·')[0]?.trim() || model.displayName;
}

/**
 * Drop a trailing context-window note: "Opus 4.8 with 1M context" → "Opus 4.8".
 *
 * 1M is not a distinguishing fact — Opus 4.8, Fable 5, and Sonnet 5 all offer
 * it — so noting it on one row and not the others says nothing about the
 * choice. Matched narrowly (`with … context`) so unrelated qualifiers survive.
 */
function withoutContextNote(label: string): string {
  return label.replace(/\s+with\s+\S+\s+context$/i, '');
}

/**
 * Label every row with its model, shortest form that stays unambiguous.
 *
 * The context note is dropped — except where it is the only thing telling two
 * rows apart. Some installs list a model once per context window (`sonnet` and
 * `sonnet[1m]`, whose descriptions differ only by "with 1M context"); stripping
 * it there would render two identical rows and no way to pick between them.
 */
function labelsFor(models: ClaudeModelInfo[]): string[] {
  const short = models.map((m) => withoutContextNote(modelHalf(m)));
  const collisions = new Set(short.filter((l, i) => short.indexOf(l) !== i));
  return models.map((m, i) => (collisions.has(short[i]) ? modelHalf(m) : short[i]));
}

/**
 * Shape the discovered models into picker options.
 *
 * The label carries the model's identity rather than clack's `hint`, because
 * clack renders a hint only for the row the cursor is on — so exactly one model
 * would name itself and the rest would show a bare alias. Every row should say
 * which model it is. (clack also hardcodes parentheses around hints.)
 *
 * Order is preserved as the CLI reported it, so the list reads like Claude
 * Code's own `/model` picker.
 */
export function buildModelPickerOptions(models: ClaudeModelInfo[]): {
  options: ModelPickerOption[];
  initialValue: string | undefined;
} {
  const labels = labelsFor(models);
  return {
    options: models.map((m, i) => ({ value: m.value, label: labels[i] })),
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

  let discovered: ClaudeModelInfo[] | null;
  try {
    discovered = await discover();
  } catch {
    // Discovery is a convenience, never a gate: a broken probe must not stop an
    // analysis that would otherwise run fine on Claude Code's default model.
    discovered = null;
  }

  const models = discovered ? selectableModels(discovered) : [];

  if (models.length === 0) {
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
