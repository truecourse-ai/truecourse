/**
 * The shell's session state: the workspace, its connected repositories, and
 * what their runs are doing right now.
 *
 * Everything here is the server's. The WORKSPACE is the organization the
 * session is in (its name and initial come from the auth user, and there is no
 * workspace at all until one answers). The REPOSITORIES are the registry's, read
 * from `GET /api/repos` on mount; unlinking one really disconnects it. Their
 * WORK rides `useRealRunStream`, which follows every repository's agent runs
 * over the shell's one socket: a run in flight is a job (a toast, an in-flight
 * chain whose steps are the run's own phase checklist), a run that ended badly
 * is an announcement, and both feed the `onboarding` marker and the last check
 * on the repository's row. The NOTIFICATION FEED is the server's own store,
 * read by `useNotifications`.
 *
 * Nothing is persisted here: no localStorage, and the socket only listens.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { disconnectRealRepo, fetchRealRepos } from '@/preview/data/real-repos';
import { fetchLlmConfig } from '@/preview/data/llm-config';
import { useAuth } from '@/ee/AuthContext';
import { useRealRunStream, type RunFailure } from './real-runs';
import { useNotifications } from './use-notifications';
import type { NotificationView } from '@truecourse/shared';
import type { JobChain, Repo, Workspace } from '@/preview/data/types';

interface PreviewStateValue {
  /** The organization of the session. Null until the session probe answers. */
  workspace: Workspace | null;
  /**
   * The connected repositories. A row carries what its runs say: onboarding
   * while its first scan is up, and the settled run's own words afterwards.
   */
  repos: Repo[];
  unlinkRepo: (id: string) => void;
  /**
   * Re-read the registry, and ANSWER with what it holds now. Called once a
   * repository is linked through the GitHub App — the caller needs the fresh
   * rows (a newly linked repository's registry id) before the state it just set
   * has reached a render.
   */
  refreshRealRepos: () => Promise<Repo[]>;
  /** The workspace's stored notification feed, newest first. */
  notifications: NotificationView[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** The runs in flight. */
  jobs: JobChain[];
  /**
   * The initial reads behind `jobs` are in (repo list + each repo's runs).
   * Until then `jobs` is provably incomplete, and "already in flight when the
   * page loaded" cannot be told apart from "just started" — the toast surface
   * waits on this before it snapshots what to stay silent about.
   */
  jobsReady: boolean;
  /** The runs that ended badly, newest first. */
  runFailures: RunFailure[];
  /**
   * What the workspace's Models setting says. `unknown` while the read is in
   * flight AND when there is no server to ask: nothing may claim a workspace
   * has no provider on the strength of an unanswered read.
   */
  llmProvider: LlmProviderState;
  /** Re-read it. Called once the Models tab saves one. */
  refreshLlmProvider: () => Promise<void>;
}

export type LlmProviderState = 'unknown' | 'configured' | 'missing';

const PreviewStateContext = createContext<PreviewStateValue | null>(null);

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const orgName = status === 'authed' ? user?.organizationName : undefined;
  const orgId = status === 'authed' ? user?.organizationId : undefined;
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProviderState>('unknown');

  const refreshRealRepos = useCallback(async () => {
    const found = await fetchRealRepos();
    setRepos(found);
    return found;
  }, []);

  // The registry, read once on mount. `fetchRealRepos` never rejects, so a
  // shell with no server behind it simply has no repositories.
  useEffect(() => {
    let live = true;
    void fetchRealRepos().then((found) => {
      if (!live) return;
      setRepos(found);
      setReposLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // The workspace's provider, read beside the registry. A refused or
  // unreachable read stays `unknown` — the needs-setup surfaces are a claim
  // about the workspace, not about this read. The read can outlive the shell
  // (the settings page refetches it after a save; a test tears the tree down
  // mid-flight), and its answer is dropped once the shell is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshLlmProvider = useCallback(async () => {
    let next: LlmProviderState;
    try {
      const { config, operator } = await fetchLlmConfig();
      next = config || operator ? 'configured' : 'missing';
    } catch {
      next = 'unknown';
    }
    if (mounted.current) setLlmProvider(next);
  }, []);

  useEffect(() => {
    void refreshLlmProvider();
  }, [refreshLlmProvider]);

  /**
   * The row goes optimistically and the refresh settles it either way — so a
   * refused disconnect (the server holds the repo while a scan it cannot stop
   * writes into it) has to SAY so, or the row simply reappears and reads as a
   * bug.
   */
  const unlinkRepo = useCallback(
    (id: string) => {
      setRepos((prev) => prev.filter((r) => r.id !== id));
      void disconnectRealRepo(id)
        .catch((e: unknown) => {
          toast.error('Could not disconnect', {
            description: e instanceof Error ? e.message : String(e),
          });
        })
        .then(refreshRealRepos);
    },
    [refreshRealRepos],
  );

  // The repositories' runs, followed live. Inert without a server.
  const realRuns = useRealRunStream(repos, reposLoaded);
  // The workspace's notification feed, read from the store and followed live.
  const feed = useNotifications();

  const value = useMemo<PreviewStateValue>(() => {
    const workspace: Workspace | null = orgName
      ? {
          id: orgId ?? orgName,
          name: orgName,
          initial: orgName.trim().charAt(0).toUpperCase(),
        }
      : null;
    // A repository's row tells the truth about its runs: the onboarding marker
    // while its first scan is up, and a settled run's own words after.
    const allRepos = repos.map((repo) => {
      const state = realRuns.repoState.get(repo.id);
      if (!state) return repo;
      return {
        ...repo,
        onboarding: state.onboarding,
        scanning: state.scanning,
        ...(state.lastCheck ? { lastCheck: state.lastCheck } : {}),
      };
    });
    return {
      workspace,
      repos: allRepos,
      unlinkRepo,
      refreshRealRepos,
      notifications: feed.notifications,
      unreadCount: feed.unreadCount,
      markRead: feed.markRead,
      markAllRead: feed.markAllRead,
      jobs: realRuns.jobs,
      jobsReady: realRuns.ready,
      runFailures: realRuns.failures,
      llmProvider,
      refreshLlmProvider,
    };
  }, [
    orgId,
    orgName,
    repos,
    realRuns,
    feed,
    llmProvider,
    refreshLlmProvider,
    unlinkRepo,
    refreshRealRepos,
  ]);

  return <PreviewStateContext.Provider value={value}>{children}</PreviewStateContext.Provider>;
}

export function usePreviewState(): PreviewStateValue {
  const value = useContext(PreviewStateContext);
  if (!value) throw new Error('usePreviewState must be used inside PreviewStateProvider');
  return value;
}
