/**
 * Tiny helper used by the contract-extractor runners to build the
 * optional `--model` / `--fallback-model` flag pair for `claude -p`.
 *
 * Per-stage resolution lives in `@truecourse/core/config/llm-models`,
 * but core depends on this package so we can't import it from here.
 * The CLI and dashboard server resolve the model at the call site and
 * pass it down to each runner factory.
 */

export function buildModelArgs(model?: string, fallbackModel?: string): string[] {
  const out: string[] = [];
  if (model) out.push('--model', model);
  if (fallbackModel) out.push('--fallback-model', fallbackModel);
  return out;
}
