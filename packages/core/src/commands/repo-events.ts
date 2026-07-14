/**
 * Home-page "latest event" driver. Each per-repo feature store stamps its own
 * timestamp; this composes them into the single most-recent lifecycle event
 * (verb + ISO time) for a repo card. Route→driver: the Express `/api/repos`
 * adapter stays thin and all cross-store composition lives here.
 *
 * Every read is isolated and tolerant: a missing/corrupt file or an unreadable
 * repo path skips only that source (never throws). When no store yields a
 * timestamp we fall back to the registry's `lastAnalyzed` as an `analyzed`
 * event; when even that is absent the event is `null`.
 */

import { readGuardLatest, readGuardResult } from '@truecourse/guard-runner';
import { readLatest } from '../lib/analysis-store.js';
import { loadLatestSpec } from '../lib/spec-store.js';

/**
 * The lifecycle verbs a repo card can show. `generated` is `guard generate` (the
 * scenario set); `guarded` is a `guard run`.
 */
export type LatestEventKind = 'analyzed' | 'scanned' | 'generated' | 'guarded';

export interface LatestEvent {
  kind: LatestEventKind;
  /** ISO-8601 timestamp the event's own store stamped. */
  at: string;
}

/** A candidate before newest-wins selection; `at` may be absent/invalid. */
interface EventCandidate {
  kind: LatestEventKind;
  at: string | null | undefined;
}

/**
 * Newest valid-timestamped candidate wins. Candidates with a missing or
 * unparseable `at` are ignored. With no valid candidate, fall back to the
 * registry's `lastAnalyzed` as an `analyzed` event; with none, `null`. Pure (no
 * I/O), so newest-wins is unit-testable directly. On an exact timestamp tie the
 * earlier candidate in the passed order wins.
 */
export function pickLatestEvent(
  candidates: readonly EventCandidate[],
  registryLastAnalyzed?: string | null,
): LatestEvent | null {
  let best: LatestEvent | null = null;
  let bestMs = -Infinity;
  for (const c of candidates) {
    const ms = toEpochMs(c.at);
    if (ms === null) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = { kind: c.kind, at: c.at as string };
    }
  }
  if (best) return best;
  if (toEpochMs(registryLastAnalyzed) !== null) {
    return { kind: 'analyzed', at: registryLastAnalyzed as string };
  }
  return null;
}

function toEpochMs(at: string | null | undefined): number | null {
  if (typeof at !== 'string' || at.length === 0) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Read every per-repo store's own timestamp tolerantly and return the newest
 * lifecycle event, or `null`. Never throws — each source is wrapped so a
 * corrupt file or an unreadable repo path skips just that source.
 */
export async function resolveLatestEvent(
  repoPath: string,
  registryLastAnalyzed?: string | null,
): Promise<LatestEvent | null> {
  const candidates: EventCandidate[] = [
    { kind: 'analyzed', at: await safe(async () => (await readLatest(repoPath))?.analysis.createdAt) },
    {
      kind: 'scanned',
      at: await safe(async () => (await loadLatestSpec<{ generatedAt?: string }>(repoPath, 'corpus'))?.generatedAt),
    },
    { kind: 'generated', at: safeSync(() => readGuardResult(repoPath)?.generatedAt) },
    { kind: 'guarded', at: safeSync(() => readGuardLatest(repoPath)?.run.ranAt) },
  ];
  return pickLatestEvent(candidates, registryLastAnalyzed);
}

async function safe(fn: () => Promise<string | null | undefined>): Promise<string | null> {
  try {
    return (await fn()) ?? null;
  } catch {
    return null;
  }
}

function safeSync(fn: () => string | null | undefined): string | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}
