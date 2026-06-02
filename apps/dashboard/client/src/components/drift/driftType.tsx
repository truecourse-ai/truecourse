/**
 * A drift's "type" is the IL artifact kind that produced it
 * (`artifactRef.type` — e.g. Operation, Entity, AuthRequirement). It's
 * the categorical dimension the Verify sidebar filters by and the badge
 * shown on each drift, mirroring how the Analysis tab groups violations
 * by category.
 */

import type { ContractDrift } from '@/lib/api';

/** The artifact kind a drift belongs to; 'Unknown' when it carries no ref. */
export function driftType(drift: ContractDrift): string {
  return drift.artifactRef?.type ?? 'Unknown';
}

/** "AuthRequirement" → "Auth Requirement"; single words pass through. */
export function humanizeKind(kind: string): string {
  return kind.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Blue badge for a drift's artifact kind — distinct from the severity tones. */
export function DriftTypeBadge({ kind, className = '' }: { kind: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] tracking-wide text-blue-700 dark:text-blue-300 ${className}`}
    >
      {humanizeKind(kind)}
    </span>
  );
}
