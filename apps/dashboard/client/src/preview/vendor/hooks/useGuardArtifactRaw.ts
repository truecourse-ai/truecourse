// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardArtifactRaw.ts; delete with the preview.
/**
 * The stored artifact behind ONE guard entity, the raw half of the two readings
 * every artifact-backed detail offers.
 *
 * Fetched LAZILY: `enabled` is the mode switch, so a reader who never leaves the
 * View mode never pays for the file. Once read it stays in state, so flipping back
 * and forth costs one request per entity.
 *
 * The result is one string the pane renders verbatim, a missing store, a missing
 * entry, and a failed read all resolve to a sentence rather than an error boundary:
 * the raw mode is a second reading of the page, never a way to break it.
 */

import { useEffect, useState } from 'react';
import * as api from '@/preview/vendor/lib/api';
import type { GuardArtifactKind } from '@/preview/vendor/lib/api';

/** What the pane shows when the store has nothing to show for this entity. */
const NO_ENTRY = 'Not in the store, nothing has written this entry yet.';

/**
 * Kinds there is exactly ONE of per repo. A null id is their ADDRESS (there is
 * nothing to select), not "nothing selected", so they read without one.
 */
const SINGLETON: ReadonlySet<GuardArtifactKind> = new Set<GuardArtifactKind>(['recipe']);

export function useGuardArtifactRaw(
  repoId: string | undefined,
  kind: GuardArtifactKind,
  id: string | null,
  enabled: boolean,
  ref?: string,
): { content: string | null } {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    if (!enabled || !repoId) return;
    if (!id && !SINGLETON.has(kind)) return;
    let cancelled = false;
    api
      .getGuardArtifactRaw(repoId, kind, id ?? '', ref)
      .then((source) => {
        if (!cancelled) setContent(source?.content ?? NO_ENTRY);
      })
      .catch((e: unknown) => {
        if (!cancelled) setContent(e instanceof Error ? e.message : 'The stored file could not be read.');
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, kind, id, enabled, ref]);

  return { content };
}
