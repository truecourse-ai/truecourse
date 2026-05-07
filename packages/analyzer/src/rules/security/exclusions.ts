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

  // Public-by-design API keys. PostHog's `phc_` prefix denotes a
  // project API key explicitly designed to ship in browser bundles
  // (publicly documented). Flagging it as a secret is wrong — the
  // documented usage is to expose it. Other public-by-design vendor
  // prefixes (Stripe pk_test/pk_live, Mapbox pk., Google AIza) are
  // intentionally NOT in this allowlist because the existing
  // secret-scanner tests treat them as secrets per maintainer policy
  // (test keys shouldn't appear in production code, browser-restricted
  // keys still leak quota/abuse, etc.).
  /^phc_[A-Za-z0-9_-]+$/,        // PostHog project API key (browser-shipped)

  // Filenames with a recognized document / media / archive / data
  // extension. Composed object keys like `<hash>__<date>__<batch>.pdf`
  // look like high-entropy tokens to pattern detectors, but the
  // trailing extension makes them clearly filenames. The optional
  // trailing slash matches S3 path prefixes that act as directories
  // (`processed/.../<file>.pdf/source_pdfs/...`).
  /\.(pdf|csv|tsv|json|jsonl|ndjson|parquet|xml|html?|md|rst|txt|log|zip|tar|gz|tgz|bz2|7z|rar|png|jpe?g|gif|webp|svg|ico|bmp|tiff?|mp[34]|wav|flac|ogg|webm|avi|mov|mkv|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|yaml|yml|toml|ini|cfg|conf|sql)\/?$/i,
]
