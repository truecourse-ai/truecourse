/**
 * Secret scanning engine — runs all 222 patterns against a string value.
 * Uses keyword pre-filtering for performance (avoids running all regexes per string).
 */

import path from 'node:path'
import { shannonEntropy } from './entropy.js'
import { STOPWORDS } from './stopwords.js'
import { GLOBAL_ALLOWLIST } from './exclusions.js'
import { SECRET_PATTERNS, type SecretPattern } from './secret-rules.js'

export interface SecretMatch {
  patternId: string
  description: string
  matchedValue: string
  entropy: number
}

// ─── Gap 1: Sensitive file extensions (path-only rules) ───────────────

export const SENSITIVE_FILE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore',
  '.pkcs12', '.cer', '.der', '.crt', '.pub',
  '.env', '.env.local', '.env.production', '.env.staging',
  '.htpasswd', '.pgpass', '.netrc', '.npmrc',
  '.pypirc', '.s3cfg', '.boto', '.credentials',
])

export function isSensitiveFile(filePath: string): { isSensitive: boolean; description: string } | null {
  const basename = path.basename(filePath)
  const ext = path.extname(filePath)

  // Check exact basename for dotfiles without a "real" extension (e.g. .env, .env.local)
  // .env.local has ext=".local" so also check if basename starts with ".env"
  if (basename.startsWith('.env')) {
    const envVariant = basename // e.g. ".env", ".env.local", ".env.production"
    if (SENSITIVE_FILE_EXTENSIONS.has(envVariant)) {
      return { isSensitive: true, description: `Sensitive file: ${envVariant} files may contain secrets` }
    }
  }

  // Check basename matches (e.g. ".htpasswd", ".pgpass", ".netrc", etc.)
  if (SENSITIVE_FILE_EXTENSIONS.has(basename)) {
    return { isSensitive: true, description: `Sensitive file: ${basename} may contain credentials` }
  }

  // Check extension (e.g. ".pem", ".key", ".p12", ".pfx", ".jks")
  if (ext && SENSITIVE_FILE_EXTENSIONS.has(ext)) {
    return { isSensitive: true, description: `Sensitive file: ${ext} files may contain private keys or certificates` }
  }

  return null
}

// ─── Gap 2: Nearby-pattern context for composite rules ────────────────

export interface ScanContext {
  /** Full source code of the file (needed for nearby-pattern checks) */
  sourceCode?: string
  /** 1-based line number where the value appears */
  lineNumber?: number
}

/**
 * Build a keyword → pattern index for fast pre-filtering.
 * Patterns without keywords go into a "no keyword" bucket that always runs.
 */
const keywordIndex = new Map<string, SecretPattern[]>()
const noKeywordPatterns: SecretPattern[] = []

for (const rule of SECRET_PATTERNS) {
  if (rule.keywords && rule.keywords.length > 0) {
    for (const kw of rule.keywords) {
      const lower = kw.toLowerCase()
      let list = keywordIndex.get(lower)
      if (!list) {
        list = []
        keywordIndex.set(lower, list)
      }
      list.push(rule)
    }
  } else {
    noKeywordPatterns.push(rule)
  }
}

/**
 * Scan a string value for secrets.
 * Returns the first match found (highest-priority patterns are listed first), or null.
 *
 * @param context Optional context for composite (nearby-pattern) rules.
 */
export function scanForSecrets(value: string, context?: ScanContext): SecretMatch | null {
  // 1. Check global allowlist — skip templates, env vars, paths, URLs
  for (const pattern of GLOBAL_ALLOWLIST) {
    if (pattern.test(value)) return null
  }

  // 2. Build candidate list using keyword pre-filter
  const valueLower = value.toLowerCase()
  const candidates = new Set<SecretPattern>()

  // Add patterns whose keywords appear in the value
  for (const [keyword, patterns] of keywordIndex) {
    if (valueLower.includes(keyword)) {
      for (const p of patterns) candidates.add(p)
    }
  }

  // Always include no-keyword patterns
  for (const p of noKeywordPatterns) candidates.add(p)

  // 3. Try each candidate pattern
  for (const rule of candidates) {
    // Reset regex lastIndex in case it has global flag
    rule.regex.lastIndex = 0
    const match = rule.regex.exec(value)
    if (!match) continue

    // Extract secret value from capture group
    const secretValue = (rule.secretGroup != null ? match[rule.secretGroup] : match[1]) ?? match[0]

    // Entropy check
    if (rule.entropy != null) {
      const ent = shannonEntropy(secretValue)
      if (ent < rule.entropy) continue
    }

    // Stopwords check
    if (rule.useStopwords) {
      const secretLower = secretValue.toLowerCase()
      if (STOPWORDS.some(sw => secretLower.includes(sw))) continue
    }

    // Per-rule allowlist
    if (rule.allowlist) {
      if (rule.allowlist.some(al => al.test(secretValue))) continue
    }

    // Composite rule: require a second pattern nearby
    if (rule.requireNearby && context?.sourceCode && context.lineNumber) {
      const withinLines = rule.requireNearby.withinLines ?? 5
      const lines = context.sourceCode.split('\n')
      const startLine = Math.max(0, context.lineNumber - 1 - withinLines)
      const endLine = Math.min(lines.length, context.lineNumber + withinLines)
      const nearbyText = lines.slice(startLine, endLine).join('\n')
      rule.requireNearby.pattern.lastIndex = 0
      if (!rule.requireNearby.pattern.test(nearbyText)) continue
    }

    return {
      patternId: rule.id,
      description: rule.description,
      matchedValue: secretValue,
      entropy: shannonEntropy(secretValue),
    }
  }

  return null
}
