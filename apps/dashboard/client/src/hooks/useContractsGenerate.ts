/**
 * Hook owning the IL-extraction (`POST /contracts/generate`) state.
 * Lives at RepoPage level so the result banner and the running
 * spinner survive sidebar/tab switches.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import * as api from '@/lib/api';
import type { ContractsGenerateResponse } from '@/lib/api';

export function useContractsGenerate(repoId: string | undefined) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ContractsGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!repoId) return;
    setGenerating(true);
    setError(null);
    try {
      const r = await api.postContractsGenerate(repoId);
      setResult(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generate failed';
      setError(message);
      toast.error('Generate failed', { description: message });
    } finally {
      setGenerating(false);
    }
  }, [repoId]);

  return { generating, result, error, run };
}
