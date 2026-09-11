import { useEffect, useState } from 'react';
import { getSpecCorpus, type SpecCorpusResponse } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { getGuardStatus } from '@/preview/vendor/lib/api';
import type { GuardStatusSummary } from '@/preview/vendor/shared';
import type { Repo } from '@/preview/data/types';

export interface HomeSummary {
  status?: GuardStatusSummary;
  corpus?: SpecCorpusResponse | null;
  statusError: boolean;
  corpusError: boolean;
}

/** Read each connected repository independently. The shell owns socket rooms. */
export function useHomeSummaries(repos: readonly Repo[]): ReadonlyMap<string, HomeSummary> {
  const idsKey = JSON.stringify(repos.filter((repo) => repo.real).map((repo) => repo.id).sort());
  const [summaries, setSummaries] = useState<ReadonlyMap<string, HomeSummary>>(new Map());

  useEffect(() => {
    const ids = new Set<string>(JSON.parse(idsKey));
    let live = true;
    const versions = new Map<string, number>();
    const refresh = async (id: string) => {
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      const [status, corpus] = await Promise.allSettled([getGuardStatus(id), getSpecCorpus(id)]);
      if (!live || versions.get(id) !== version) return;
      setSummaries((previous) => {
        const next = new Map(previous);
        next.set(id, {
          status: status.status === 'fulfilled' ? status.value : undefined,
          corpus: corpus.status === 'fulfilled' ? corpus.value : undefined,
          statusError: status.status === 'rejected',
          corpusError: corpus.status === 'rejected',
        });
        return next;
      });
    };
    const refreshAll = () => { for (const id of ids) void refresh(id); };
    const onComplete = ({ repoId }: { repoId?: string }) => {
      if (repoId && ids.has(repoId)) void refresh(repoId);
    };
    refreshAll();
    if (ids.size === 0) return () => { live = false; };
    let socket: ReturnType<typeof connectSocket> | undefined;
    try {
      socket = connectSocket();
      socket.on('spec:complete', onComplete);
      socket.on('connect', refreshAll);
    } catch {
      // Reads also work without a socket transport, including static previews.
    }
    return () => {
      live = false;
      socket?.off('spec:complete', onComplete);
      socket?.off('connect', refreshAll);
    };
  }, [idsKey]);

  return summaries;
}
