
import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { RepoResponse } from '@/lib/api';

export function useRepo() {
  const [repos, setRepos] = useState<RepoResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getRepos();
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repos');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const addRepo = useCallback(async (path: string) => {
    try {
      const repo = await api.addRepo(path);
      setRepos((prev) => [...prev, repo]);
      return repo;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add repo';
      setError(message);
      throw err;
    }
  }, []);

  const deleteRepo = useCallback(async (id: string) => {
    try {
      await api.deleteRepo(id);
      setRepos((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete repo';
      setError(message);
      throw err;
    }
  }, []);

  const analyzeRepo = useCallback(async (id: string, options?: { branch?: string }) => {
    try {
      return await api.analyzeRepo(id, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start analysis';
      setError(message);
      throw err;
    }
  }, []);

  return {
    repos,
    isLoading,
    error,
    addRepo,
    deleteRepo,
    analyzeRepo,
    refetch: fetchRepos,
  };
}
