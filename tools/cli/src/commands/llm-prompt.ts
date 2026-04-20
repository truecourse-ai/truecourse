import * as p from "@clack/prompts";
import type { LlmEstimate } from "@truecourse/server/analyze";
import { isInteractive } from "./helpers.js";

/**
 * Show a one-line pre-flight LLM estimate and ask the user to confirm.
 *
 * Callers are responsible for pausing any spinner / tracker UI *before*
 * invoking this so the prompt renders cleanly, and for restarting their UI
 * afterwards — the behaviour differs between `analyze` (step tracker) and
 * `analyze --diff` (plain spinner), so the helper stays display-agnostic.
 *
 * Decision precedence:
 *   1. `autoApprove === true`  → log the estimate and return true (no prompt)
 *   2. interactive TTY         → prompt the user
 *   3. non-interactive         → caller must have passed a decision upfront;
 *                                we return false and the caller is expected
 *                                to have guarded against this case. Agents
 *                                should always pass --llm or --no-llm.
 *
 * Returns `true` if the user confirmed (or auto-approval was set),
 * `false` on decline, cancel, or non-interactive without auto-approval.
 */
export async function promptLlmEstimate(
  estimate: LlmEstimate,
  { autoApprove }: { autoApprove?: boolean } = {},
): Promise<boolean> {
  const totalRules =
    estimate.uniqueRuleCount ?? estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
  const totalFiles =
    estimate.uniqueFileCount ?? estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
  const tokens = estimate.totalEstimatedTokens;
  const tokenStr =
    tokens >= 1_000_000
      ? `~${(tokens / 1_000_000).toFixed(1)}M tokens`
      : `~${Math.round(tokens / 1000)}k tokens`;

  p.log.step(`LLM will analyze ${totalFiles} files with ${totalRules} rules (${tokenStr})`);

  if (autoApprove) return true;

  if (!isInteractive()) {
    // Upstream should have short-circuited before reaching here — belt-and-
    // suspenders fallback so we don't hang on a prompt that can't be answered.
    p.log.error(
      "Cannot prompt for LLM-rule confirmation non-interactively. Pass --llm to approve the estimate or --no-llm to skip LLM rules.",
    );
    return false;
  }

  const proceed = await p.confirm({ message: "Run LLM-powered rules?", initialValue: true });
  if (p.isCancel(proceed)) return false;
  if (!proceed) p.log.info("Skipping LLM rules.");
  return !!proceed;
}
