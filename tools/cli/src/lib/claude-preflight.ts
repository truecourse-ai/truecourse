/**
 * Shared `claude` CLI preflight for every command that shells out to it
 * (`analyze`, `spec scan`, `spec resolve`, `infer`, `verify`,
 * `contracts generate`, …).
 *
 * Extraction/analysis fans out many `claude` subprocesses, so a broken or
 * expired CLI otherwise fails every one of them and the user only finds out at
 * the very end of a long run. This probes the CLI once up front and bails with
 * an actionable message before any real work starts.
 *
 * The check itself (binary resolution, availability, a tiny live auth
 * round-trip, raw-output capture) lives in `@truecourse/core/lib/cli-binary`;
 * this module is just the CLI-facing presentation + exit policy.
 *
 * `preflightLlmOrExit` is the entry every command uses: it picks this probe or
 * the API-config check, depending on the transport the run will use.
 */

import * as p from "@clack/prompts";
import { checkClaudeAuth, type ClaudeAuthResult } from "@truecourse/core/lib/cli-binary";
import {
  LlmApiConfigError,
  createConfiguredApiTransport,
  getConfiguredLlmMode,
  installConfiguredLlmTransport,
} from "@truecourse/core/services/llm/install-transport";

/** The per-run `--llm-transport` override, when one was passed. */
export type LlmTransportFlag = "cli" | "agent" | "api";

/**
 * Preflight for a command that is about to spend on the LLM, branching on the
 * transport it will actually use:
 *
 *   agent  — a filesystem mailbox answers the prompts; nothing to check.
 *   api    — no `claude` binary is involved. Build the transport up front so an
 *            unusable API config fails before any pipeline work or estimate,
 *            and (when the mode comes from the saved selection) install it as
 *            the process-wide default the runners fall back to.
 *   else   — today's `claude` login probe, unchanged.
 */
export async function preflightLlmOrExit(flag?: LlmTransportFlag): Promise<void> {
  if (flag === "agent") return;
  const apiMode = flag === "api" || (flag !== "cli" && getConfiguredLlmMode() === "api");
  if (!apiMode) {
    await preflightClaudeOrExit();
    return;
  }
  // A per-run `--llm-transport api` override is validated only: the command
  // builds its own transport from the same config.
  if (flag === "api") withApiConfigExit(() => void createConfiguredApiTransport());
  else installLlmTransportOrExit();
}

/**
 * Install the saved selection as the process-wide default transport, so a
 * command that runs an LLM pipeline without a preflight (an implicit re-scan,
 * the pre-commit hook) still honors API mode. A no-op in Claude Code mode.
 */
export function installLlmTransportOrExit(): void {
  withApiConfigExit(installConfiguredLlmTransport);
}

/** Turn an unusable API configuration into a one-line exit, not a stack trace. */
function withApiConfigExit(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof LlmApiConfigError) {
      p.log.error(err.message);
      p.cancel("Aborted — fix the API configuration and retry.");
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Probe the `claude` CLI and exit non-zero with an actionable message if it
 * isn't ready. Returns normally when the CLI is installed and its login works.
 */
export async function preflightClaudeOrExit(): Promise<void> {
  const s = p.spinner();
  s.start("Checking the `claude` CLI is logged in");
  const result = await checkClaudeAuth();
  if (result.ok) {
    s.stop("`claude` CLI ready");
    return;
  }
  s.stop("`claude` CLI not ready");
  const { title, hint } = describeClaudePreflightFailure(result);
  p.log.error(title);
  p.log.message(hint);
  p.cancel("Aborted — fix the `claude` CLI and retry.");
  process.exit(1);
}

/**
 * Map a failed `claude` preflight to a headline + body. Pure so the wording is
 * unit-tested without spawning or driving clack.
 *
 * For `not-found` there's nothing `claude` printed (the binary isn't there), so
 * we point at installation. For `failed` we show `claude`'s own output verbatim
 * — the raw answer is more accurate and actionable than any guess we'd make at
 * the cause.
 */
export function describeClaudePreflightFailure(
  result: Extract<ClaudeAuthResult, { ok: false }>,
): { title: string; hint: string } {
  if (result.reason === "not-found") {
    return {
      title: "The `claude` CLI isn't installed or isn't on your PATH.",
      hint: "Install Claude Code (https://docs.anthropic.com/en/docs/claude-code), or set CLAUDE_CODE_BINARY to its name/path, then retry.",
    };
  }
  return {
    title: `The \`claude\` CLI failed (exit ${result.code ?? "null"}). Its output:`,
    hint: result.output || "(no output)",
  };
}
