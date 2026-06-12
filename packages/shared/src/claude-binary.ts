/**
 * Single source of truth for which `claude` binary the whole app invokes.
 *
 * Every command, the LLM provider, and each extraction/repair runner resolve
 * the binary through this one function, so they always agree on the same target
 * — which is what lets the up-front CLI preflight test the *same* binary the
 * real work will spawn.
 *
 * Precedence: `CLAUDE_CODE_BINARY` (canonical) → `CLAUDE_CODE_BIN` (legacy
 * alias, kept for back-compat) → `claude` on PATH. Empty values fall through.
 *
 * To add another source or change precedence, edit it here and nowhere else.
 */
export function resolveClaudeBinary(): string {
  return process.env.CLAUDE_CODE_BINARY || process.env.CLAUDE_CODE_BIN || 'claude';
}
