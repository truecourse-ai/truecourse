/**
 * Tiny helper used by every LLM runner in this package to construct
 * the optional `--model` / `--fallback-model` flag pair for `claude -p`.
 *
 * Resolution of which model to use per stage lives in
 * `@truecourse/core/config/llm-models` — but core can't be imported
 * here (core depends on this package). The CLI and dashboard server
 * resolve the model string at the orchestrator-call boundary and pass
 * it down to each runner factory.
 */

export function buildModelArgs(model?: string, fallbackModel?: string): string[] {
  const out: string[] = [];
  if (model) out.push('--model', model);
  if (fallbackModel) out.push('--fallback-model', fallbackModel);
  return out;
}
