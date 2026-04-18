import * as p from "@clack/prompts";
import type { LlmEstimate } from "@truecourse/server/analyze";

/**
 * Show a one-line pre-flight LLM estimate and ask the user to confirm.
 *
 * Callers are responsible for pausing any spinner / tracker UI *before*
 * invoking this so the prompt renders cleanly, and for restarting their UI
 * afterwards — the behaviour differs between `analyze` (step tracker) and
 * `analyze --diff` (plain spinner), so the helper stays display-agnostic.
 *
 * Returns `true` if the user confirmed, `false` on decline or cancel.
 */
export async function promptLlmEstimate(estimate: LlmEstimate): Promise<boolean> {
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
  const proceed = await p.confirm({ message: "Run LLM-powered rules?", initialValue: true });
  if (p.isCancel(proceed)) return false;
  if (!proceed) p.log.info("Skipping LLM rules.");
  return !!proceed;
}
