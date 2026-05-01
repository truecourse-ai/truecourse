import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { InvariantResponse, InvariantDraftResponse } from '@/lib/api';

// Mirrors @truecourse/analyzer's `ProgressEvent` discriminated union, kept in
// sync with packages/analyzer/src/plugins/types.ts. Duplicated here (rather
// than imported) so the client stays decoupled from server-only packages.
export type InvariantsProgressEvent =
  | { kind: 'start'; mode: 'full' | 'diff' }
  | { kind: 'spec-loaded'; sections: number; empty: boolean; searchedPaths: string[] }
  | { kind: 'files-analyzed'; count: number }
  | { kind: 'plugin-start'; plugin: string }
  | { kind: 'plugin-progress'; plugin: string; current: number; total: number; label: string }
  | { kind: 'plugin-end'; plugin: string; drafts: number; durationMs: number }
  | { kind: 'plugin-failed'; plugin: string; error: string }
  | { kind: 'done'; drafts: number; durationMs: number };

export type InvariantsRunState =
  | { status: 'idle' }
  | { status: 'running'; lastEvent: InvariantsProgressEvent | null }
  | { status: 'done'; drafts: number; pluginsRun: string[]; pluginsSkipped: string[] }
  | { status: 'failed'; error: string };

interface UseInvariantsOpts {
  repoId: string;
  onEvent: (event: string, handler: (data: unknown) => void) => () => void;
  enabled?: boolean;
}

export function useInvariants({ repoId, onEvent, enabled = true }: UseInvariantsOpts) {
  const [active, setActive] = useState<InvariantResponse[]>([]);
  const [drafts, setDrafts] = useState<InvariantDraftResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<InvariantsRunState>({ status: 'idle' });

  const refresh = useCallback(async () => {
    if (!repoId || !enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const [a, d] = await Promise.all([
        api.getInvariants(repoId),
        api.getInvariantDrafts(repoId),
      ]);
      setActive(a);
      setDrafts(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [repoId, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to socket events
  useEffect(() => {
    const offProgress = onEvent('invariants:progress', (data: unknown) => {
      const payload = data as { repoId: string; event: InvariantsProgressEvent };
      if (payload.repoId !== repoId) return;
      setRun({ status: 'running', lastEvent: payload.event });
    });
    const offComplete = onEvent('invariants:complete', (data: unknown) => {
      const payload = data as {
        repoId: string;
        drafts: number;
        pluginsRun: string[];
        pluginsSkipped: string[];
      };
      if (payload.repoId !== repoId) return;
      setRun({
        status: 'done',
        drafts: payload.drafts,
        pluginsRun: payload.pluginsRun,
        pluginsSkipped: payload.pluginsSkipped,
      });
      // Refetch to pick up new drafts.
      refresh();
    });
    const offFailed = onEvent('invariants:failed', (data: unknown) => {
      const payload = data as { repoId: string; error: string };
      if (payload.repoId !== repoId) return;
      setRun({ status: 'failed', error: payload.error });
    });
    return () => {
      offProgress();
      offComplete();
      offFailed();
    };
  }, [repoId, onEvent, refresh]);

  const trigger = useCallback(
    async (mode: 'full' | 'diff' = 'full') => {
      setRun({ status: 'running', lastEvent: null });
      try {
        await api.runInvariantsSuggest(repoId, mode);
      } catch (err) {
        setRun({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [repoId],
  );

  const accept = useCallback(
    async (draftId: string) => {
      await api.acceptInvariantDraft(repoId, draftId);
      await refresh();
    },
    [repoId, refresh],
  );

  const reject = useCallback(
    async (draftId: string) => {
      await api.rejectInvariantDraft(repoId, draftId);
      await refresh();
    },
    [repoId, refresh],
  );

  const retire = useCallback(
    async (slug: string) => {
      await api.retireInvariant(repoId, slug);
      await refresh();
    },
    [repoId, refresh],
  );

  return { active, drafts, isLoading, error, run, refresh, trigger, accept, reject, retire };
}
