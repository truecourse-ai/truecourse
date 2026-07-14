/**
 * Output normalizers — deterministic text rewrites applied to captured streams
 * (and file-content comparisons) before matching. The raw bytes are always kept
 * for evidence; only the compared copy is normalized. This is the closed set:
 * timestamps, absolute paths (sandbox + repo roots), version strings, durations.
 */

import type { GuardNormalizer } from '@truecourse/shared'

export interface NormalizerContext {
  sandboxRoot: string
  repoRoot: string
}

/** Canonical apply order — independent of the order the scenario lists them in. */
const CANONICAL_ORDER: readonly GuardNormalizer[] = [
  'abs-paths',
  'timestamps',
  'versions',
  'durations',
]

const ISO_TIMESTAMP =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g
// Semver-ish: 1.2.3 with optional prerelease and/or build-metadata suffixes.
const VERSION = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*/g
// 12ms, 0.5s, 3 m, 2h — a number followed by a time unit at a word boundary.
const DURATION = /\b\d+(?:\.\d+)?\s*(?:ms|s|m|h)\b/g

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyOne(text: string, normalizer: GuardNormalizer, ctx: NormalizerContext): string {
  switch (normalizer) {
    case 'abs-paths': {
      // Replace the longer root first so a repo root nested under tmp can't be
      // partially shadowed by the sandbox replacement.
      const roots: Array<[string, string]> = [
        [ctx.sandboxRoot, '<SANDBOX>'],
        [ctx.repoRoot, '<REPO>'],
      ].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>
      let out = text
      for (const [root, placeholder] of roots) {
        if (!root) continue
        out = out.replace(new RegExp(escapeRegExp(root), 'g'), placeholder)
      }
      return out
    }
    case 'timestamps':
      return text.replace(ISO_TIMESTAMP, '<TIMESTAMP>')
    case 'versions':
      return text.replace(VERSION, '<VERSION>')
    case 'durations':
      return text.replace(DURATION, '<DURATION>')
  }
}

/** Apply the requested normalizers (canonical order) to `text`. */
export function normalize(
  text: string,
  normalizers: readonly GuardNormalizer[],
  ctx: NormalizerContext,
): string {
  const requested = new Set(normalizers)
  let out = text
  for (const n of CANONICAL_ORDER) {
    if (requested.has(n)) out = applyOne(out, n, ctx)
  }
  return out
}
