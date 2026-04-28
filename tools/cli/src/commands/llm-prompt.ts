import * as p from "@clack/prompts";
import type { LlmEstimate } from "@truecourse/core/commands/analyze-in-process";
import { isInteractive } from "./helpers.js";

/**
 * Show a one-line pre-flight LLM estimate and ask the user to confirm.
 *
 * Two `subject` modes:
 *   - `'rules'` (default) — prompts about LLM-powered static rules
 *   - `'invariants'`      — prompts about invariant enforcement (called as
 *                           a separate prompt after the rule prompt so the
 *                           user sees its cost in isolation)
 *
 * Callers pause any spinner/tracker UI before invoking and restart afterwards.
 *
 * Decision precedence:
 *   1. `autoApprove === true`  → log the estimate and return true (no prompt)
 *   2. interactive TTY         → prompt the user
 *   3. non-interactive         → caller must have passed a decision upfront;
 *                                we return false and the caller is expected
 *                                to have guarded against this case. Agents
 *                                should always pass --llm or --no-llm.
 */
export async function promptLlmEstimate(
  estimate: LlmEstimate,
  {
    autoApprove,
    subject = 'rules',
  }: { autoApprove?: boolean; subject?: 'rules' | 'invariants' } = {},
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

  if (subject === 'invariants') {
    p.log.step(
      `Invariant enforcement: ${totalFiles} file(s) × ${totalRules} invariant(s) (${tokenStr})`,
    );
  } else {
    p.log.step(`LLM will analyze ${totalFiles} files with ${totalRules} rules (${tokenStr})`);
  }

  if (autoApprove) return true;

  if (!isInteractive()) {
    p.log.error(
      `Cannot prompt for LLM confirmation non-interactively. Pass --llm to approve the estimate or --no-llm to skip LLM ${subject}.`,
    );
    return false;
  }

  const message =
    subject === 'invariants' ? 'Run LLM-powered invariants?' : 'Run LLM-powered rules?';
  const proceed = await p.confirm({ message, initialValue: true });
  if (p.isCancel(proceed)) return false;
  if (!proceed) p.log.info(`Skipping LLM ${subject}.`);
  return !!proceed;
}
