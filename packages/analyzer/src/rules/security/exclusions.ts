/**
 * Global allowlist patterns for secret scanning.
 * Values matching any of these patterns are never flagged as secrets.
 */

export const GLOBAL_ALLOWLIST: RegExp[] = [
  // Literals
  /^(true|false|null|undefined|none|nil|nan|inf)$/i,

  // Positional params ($1, $2)
  /^\$\d+$/,

  // Environment variable references ($MY_VAR)
  /^\$[A-Z_][A-Z0-9_]*$/,

  // Template variable references (${MY_VAR})
  /^\$\{[A-Z_][A-Z0-9_]*\}$/,

  // Template expressions ({{ template }})
  /^\{\{[\w ().|]+\}\}$/,

  // GitHub Actions expressions (${{ ... }})
  /^\$\{\{.*\}\}$/,

  // Windows environment variables (%MY_VAR%)
  /^%[A-Z_][A-Z0-9_]*%$/,

  // Autoconf variables (@MY_VAR@)
  /^@[A-Z_][A-Z0-9_]*@$/,

  // Unix paths
  /^\/(?:Users|home|opt|tmp|usr|var|bin|etc|lib|srv|dev|proc|sys|mnt|media|run|snap)\//,

  // URLs (handled by other rules like clear-text-protocol)
  // Exception: webhook URLs are still checked (Slack, Teams, etc.)
  /^https?:\/\/(?!hooks\.slack\.com|[a-z0-9]+\.webhook\.office\.com)/,

  // Docker / container image references
  /^(?:docker|ghcr|quay|gcr|ecr)\.io\//,

  // Common config patterns that aren't secrets
  /^\*+$/, // All asterisks (masked values)
  /^x+$/i, // All x's (placeholder)
  /^\.{3,}$/, // Ellipsis placeholders
]
