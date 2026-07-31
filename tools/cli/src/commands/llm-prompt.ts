import * as p from "@clack/prompts";
import type { LlmEstimate } from "@truecourse/core/commands/analyze-in-process";
import type { EstimatePhase } from "@truecourse/core/progress";
import { isInteractive } from "./helpers.js";

/**
 * Terminal presentation of the pre-flight estimate phase: a spinner that resolves
 * into a standalone line ABOVE the estimate panel — the same shape as the `claude`
 * preflight. Kept OFF the run checklist on purpose: the checklist is redrawn in
 * place, so an estimate step painted the whole list once while estimating and
 * again after the confirm. The checklist now starts with the run itself.
 */
export function estimateSpinnerPhase(): EstimatePhase {
  const s = p.spinner();
  return {
    start() {
      s.start("Estimating cost");
    },
    done(subject) {
      s.stop(subject ? `Cost estimated — ${subject}` : "Cost estimated");
    },
    // The marker alone, never the reason: the reason belongs to the command's
    // closing line (`p.cancel("Failed: …")`), which would otherwise print twice.
    error() {
      s.error("Cost estimate failed");
    },
  };
}

/** USD for the estimate breakdown: `<$0.01`, `$0.42`, `$3.10`. */
function fmtUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export interface PromptLlmEstimateOptions {
  autoApprove?: boolean;
  /**
   * Wording for the staged pipelines (spec scan / contracts generate). When set
   * (and the estimate carries `stages`), the prompt renders a per-stage call
   * breakdown and a `Proceed with <verb>?` confirm instead of analyze's
   * rules×files line. Omit for analyze (unchanged behavior).
   */
  nouns?: { verb: string };
}

/**
 * Show a pre-flight LLM TOKEN estimate and ask the user to confirm.
 *
 * Callers pause any spinner / tracker UI *before* invoking this (analyze) — the
 * staged pipelines fire it before the first tracker event, so nothing is drawn yet.
 *
 * Decision precedence:
 *   1. `autoApprove === true`  → log the estimate and return true (no prompt)
 *   2. interactive TTY         → prompt the user
 *   3. non-interactive         → return false (caller should have passed a flag)
 *
 * Returns `true` if confirmed (or auto-approved), `false` on decline/cancel/
 * non-interactive-without-approval.
 */
export async function promptLlmEstimate(
  estimate: LlmEstimate,
  { autoApprove, nouns }: PromptLlmEstimateOptions = {},
): Promise<boolean> {
  const tokens = estimate.totalEstimatedTokens;
  const tokenStr =
    tokens >= 1_000_000
      ? `~${(tokens / 1_000_000).toFixed(1)}M tokens`
      : `~${Math.round(tokens / 1000)}k tokens`;

  const staged = estimate.stages && estimate.stages.length > 0;
  if (staged) {
    const stages = estimate.stages!;
    const totalCalls = stages.reduce((s, st) => s + st.calls, 0);
    const subject = estimate.subjectLabel ?? `${stages.length} stages`;
    const verb = nouns?.verb ?? "This";
    const costStr =
      estimate.estimatedCostUsd != null
        ? estimate.expectedCostUsd != null
          ? ` · ~${fmtUsd(estimate.expectedCostUsd)} expected · up to ${fmtUsd(estimate.estimatedCostUsd)}`
          : ` · up to ${fmtUsd(estimate.estimatedCostUsd)}`
        : "";
    p.log.step(`${verb} will make ~${totalCalls} LLM calls over ${subject} (${tokenStr}${costStr})`);
    for (const st of stages) {
      if (st.expectedCalls != null) {
        // Ceiling overstates likely spend (e.g. verify's flagged fraction): lead
        // with the expected count/cost, keep the ceiling in parens.
        const ceilingCalls = st.callsRange?.high ?? st.calls;
        const callsStr = `~${st.expectedCalls} calls expected (up to ${ceilingCalls})`;
        const cost =
          st.expectedCostUsd != null && st.estimatedCostUsd != null
            ? ` · ~${fmtUsd(st.expectedCostUsd)} (max ${fmtUsd(st.estimatedCostUsd)})`
            : st.estimatedCostUsd != null
              ? ` · ${fmtUsd(st.estimatedCostUsd)}`
              : "";
        p.log.message(
          `  ${(st.label ?? st.stage).padEnd(22)} ${callsStr.padEnd(32)} ${st.model}${cost}`,
        );
      } else {
        const calls =
          st.callsRange && st.callsRange.high !== st.calls
            ? `${st.callsRange.low}–${st.callsRange.high}`
            : `${st.calls}`;
        const cost = st.estimatedCostUsd != null ? ` · ${fmtUsd(st.estimatedCostUsd)}` : "";
        p.log.message(
          `  ${(st.label ?? st.stage).padEnd(22)} ${`${calls} calls`.padEnd(14)} ${st.model}${cost}`,
        );
      }
      // A stage whose work count is an earlier stage's OUTPUT (guard flow synthesis:
      // the flow count isn't knowable before the call) states its honest bound
      // instead of a number the run could exceed.
      if (st.bound) p.log.message(`  ${" ".repeat(22)} ↳ ${st.bound}`);
    }
    if (estimate.estimatedCostUsd != null) {
      const approx = estimate.costSource === "bundled" ? " (approx prices)" : "";
      const ceilingCopy =
        estimate.expectedCostUsd != null
          ? `Ranges = fewest–most calls; "expected" is the likely spend and the max a ceiling — prompt caching may lower it.${approx}`
          : `Ranges = fewest–most calls; cost is a ceiling — prompt caching may lower it.${approx}`;
      p.log.message(`  ${ceilingCopy}`);
    }
  } else {
    const totalRules =
      estimate.uniqueRuleCount ?? estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
    const totalFiles =
      estimate.uniqueFileCount ?? estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
    p.log.step(`LLM will analyze ${totalFiles} files with ${totalRules} rules (${tokenStr})`);
  }

  if (autoApprove) return true;

  if (!isInteractive()) {
    p.log.error(
      nouns
        ? `Cannot prompt for confirmation non-interactively. Pass --yes to approve the estimate.`
        : `Cannot prompt for LLM-rule confirmation non-interactively. Pass --llm to approve the estimate or --no-llm to skip LLM rules.`,
    );
    return false;
  }

  const message = nouns ? `Proceed with ${nouns.verb.toLowerCase()}?` : "Run LLM-powered rules?";
  const proceed = await p.confirm({ message, initialValue: true });
  if (p.isCancel(proceed)) return false;
  if (!proceed) p.log.info(nouns ? "Cancelled." : "Skipping LLM rules.");
  return !!proceed;
}
