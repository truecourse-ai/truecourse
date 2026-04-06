/**
 * Secret scanning engine — runs all 222 patterns against a string value.
 * Uses keyword pre-filtering for performance (avoids running all regexes per string).
 */

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
 */
export function scanForSecrets(value: string): SecretMatch | null {
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

    return {
      patternId: rule.id,
      description: rule.description,
      matchedValue: secretValue,
      entropy: shannonEntropy(secretValue),
    }
  }

  return null
}
