/**
 * Discovery of the Claude Code models available to the current user.
 *
 * Speaks the stdio control protocol the Claude Agent SDK uses, so we get the
 * exact list the interactive `/model` picker shows — scoped to this account,
 * subscription, org policy, and CLI version — without taking a dependency on
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * Costs nothing: the CLI answers `initialize` from local state. We never send
 * a user message, so no prompt reaches the API.
 *
 * The protocol is an internal SDK surface, not a documented CLI contract, so it
 * may change between Claude Code releases. Every failure here is therefore
 * non-fatal: `discoverClaudeModels` returns `null` and callers fall back to
 * letting Claude Code pick the model, exactly as before this module existed.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import readline from 'node:readline';
import { config } from '../../config/index.js';

/** One entry of the CLI's `/model` picker. Mirrors the SDK's `ModelInfo`. */
export interface ClaudeModelInfo {
  /** The value to pass to `--model` (an alias like `opus[1m]`, or a full ID). */
  value: string;
  /**
   * The concrete model an alias resolves to (e.g. `default` →
   * `claude-opus-4-8[1m]`). Absent on entries that are already concrete.
   * Undocumented in the SDK's typedef but present on the wire — treat as
   * best-effort.
   */
  resolvedModel?: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
}

export interface DiscoverClaudeModelsOptions {
  /** Defaults to the binary every other Claude Code call site uses. */
  binary?: string;
  timeoutMs?: number;
}

/**
 * A healthy CLI answers `initialize` from local state in ~1s. This is the
 * budget for one that won't answer at all (too old to know the request,
 * protocol drift): we wait a few multiples of the happy path, then fall back to
 * letting Claude Code choose. Every second here is a second the user stares at
 * a prompt that hasn't appeared yet, so it is deliberately not generous.
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Ask the CLI which models this user can run.
 *
 * Returns `null` — never throws — when the binary is missing, the handshake
 * fails, the protocol has drifted, or the CLI is too old to answer.
 */
export async function discoverClaudeModels(
  options: DiscoverClaudeModelsOptions = {},
): Promise<ClaudeModelInfo[] | null> {
  const binary = options.binary ?? config.claudeCodeBinary ?? 'claude';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        binary,
        ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json'],
        {
          // Probe from an empty cwd: we want the account's model list, not one
          // coloured by this repo's CLAUDE.md or .claude/settings.json.
          cwd: os.tmpdir(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (models: ClaudeModelInfo[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(models);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();

    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
    // Drain stderr so a chatty CLI can't fill the pipe buffer and wedge.
    child.stderr?.resume();

    const requestId = `tc_${Math.random().toString(36).slice(2, 15)}`;

    if (!child.stdout) {
      finish(null);
      return;
    }

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;

      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // Banner noise — not every stdout line is protocol traffic.
      }

      const envelope = msg as { type?: string; response?: Record<string, unknown> };
      if (envelope.type !== 'control_response') return;

      const res = envelope.response;
      if (!res || res.request_id !== requestId) return;
      if (res.subtype !== 'success') {
        finish(null);
        return;
      }

      const models = (res.response as { models?: unknown } | undefined)?.models;
      if (!Array.isArray(models) || models.length === 0) {
        finish(null);
        return;
      }

      const parsed = models.filter(
        (m): m is ClaudeModelInfo =>
          !!m &&
          typeof (m as ClaudeModelInfo).value === 'string' &&
          typeof (m as ClaudeModelInfo).displayName === 'string',
      );
      finish(parsed.length > 0 ? parsed : null);
    });

    child.stdin?.on('error', () => finish(null));
    child.stdin?.write(
      `${JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'initialize' },
      })}\n`,
    );
  });
}

/** Model families we can recognize by name in an id or label. */
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** Fable bills well above the Opus tier — never auto-select it. */
function isFable(model: ClaudeModelInfo): boolean {
  return /fable/i.test(`${model.value} ${model.displayName} ${model.resolvedModel ?? ''}`);
}

/**
 * Whether this entry *names* Opus.
 *
 * Matches identity fields only. Descriptions are marketing prose that name
 * other tiers ("more capable than Opus 4.8"), so they are not evidence.
 */
function isExplicitOpus(model: ClaudeModelInfo): boolean {
  return /opus/i.test(`${model.value} ${model.displayName}`);
}

/**
 * Whether an entry tells you which model you'd actually get.
 *
 * `default` ("Default (recommended)" → `claude-opus-4-8[1m]`) does not: it is a
 * moving alias for whatever Claude Code currently prefers. Offering it as a
 * choice would be offering "surprise me", which is the behavior the picker
 * exists to replace — and it is exactly how analysis silently ended up on a
 * premium tier before it existed.
 *
 * The test is whether the entry names the family it resolves to. That covers
 * `best` and `opusplan` too, without hardcoding a list of alias names. Entries
 * with no `resolvedModel`, or one from a family we don't recognize, are kept —
 * we only drop an entry when we have positive evidence it hides its model.
 */
function namesItsModel(model: ClaudeModelInfo): boolean {
  const resolved = model.resolvedModel?.toLowerCase();
  if (!resolved) return true;
  const family = FAMILIES.find((f) => resolved.includes(f));
  if (!family) return true;
  return `${model.value} ${model.displayName}`.toLowerCase().includes(family);
}

/**
 * The models worth offering: every entry whose label tells the user which model
 * they are choosing. Order is preserved.
 */
export function selectableModels(models: ClaudeModelInfo[]): ClaudeModelInfo[] {
  return models.filter(namesItsModel);
}

/**
 * The model to pre-select when offering the picker. Expects an already
 * `selectableModels`-filtered list. Returns `null` for an empty list.
 *
 * Opus is the deliberate default for analysis — the strongest tier we are
 * willing to spend on a user's behalf without being asked. Failing that, the
 * first model offered.
 *
 * Fable is never auto-selected — it bills well above Opus, and a user should
 * reach that tier by choosing it, not by accepting a default.
 */
export function pickDefaultModel(models: ClaudeModelInfo[]): ClaudeModelInfo | null {
  if (models.length === 0) return null;
  const candidates = models.filter((m) => !isFable(m));
  return candidates.find(isExplicitOpus) ?? candidates[0] ?? null;
}
