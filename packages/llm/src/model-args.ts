/**
 * Build the optional `--model` / `--fallback-model` flag pair for `claude -p`.
 * Which model to use per stage is resolved by the caller (the CLI / dashboard
 * server, via `@truecourse/core/config/llm-models`) and passed down.
 */
export function buildModelArgs(model?: string, fallbackModel?: string): string[] {
  const out: string[] = [];
  if (model) out.push('--model', model);
  if (fallbackModel) out.push('--fallback-model', fallbackModel);
  return out;
}
