// PREVIEW: the repository list is PART REAL (repos connected through the GitHub
// App come from the server); everything else is fake data.

/**
 * The preview's session state: the parts of the mock a user can actually move.
 * Connecting a provider flips it to connected, connecting repositories adds
 * rows and an onboarding chain, a policy toggle sticks, reading a notification
 * clears its dot, and the active job's counter climbs on a timer (a counter,
 * never a bar).
 *
 * The exceptions are the parts a signed-in user would catch lying. The ACTIVE
 * WORKSPACE wears the name of the organization the session is in (its initial
 * follows); the switcher's list, the plan and the repo counts are still
 * fixtures. And repositories connected through the GitHub App are REAL: they are read from
 * `GET /api/repos` on mount, listed ahead of the fixtures, and unlinking one
 * really disconnects it. With no session and no server behind the preview,
 * both reads yield nothing and the mock is exactly what it was.
 *
 * That exception now includes their WORK: `useRealRunStream` follows the agent
 * runs of the real repositories over the shell's one socket, so a real run is a
 * real job (a toast, an in-flight chain whose steps are the run's own phase
 * checklist), a real pair of notifications (started, settled), and the real
 * `onboarding` marker and last check on the repository's Home row. Real jobs and
 * notifications are merged AHEAD of the fixtures; the fixtures are untouched, so
 * a fixture repository's preview is exactly what it was.
 *
 * Nothing is persisted: no localStorage, and the socket only listens. A reload
 * is a fresh mock — the real notifications included — which is the point.
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
import {
  ACTIVE_WORKSPACE_ID,
  JOBS_IN_FLIGHT,
  NOTIFICATIONS,
  REPOS,
  WORKSPACES,
} from '@/preview/data';
import { disconnectRealRepo, fetchRealRepos } from '@/preview/data/real-repos';
import { fetchLlmConfig } from '@/preview/data/llm-config';
import { useAuth } from '@/ee/AuthContext';
import { useRealRunStream, type RunFailure } from './real-runs';
import type {
  JobChain,
  PreviewNotification,
  Repo,
  Workspace,
} from '@/preview/data/types';

interface PreviewStateValue {
  workspace: Workspace;
  workspaces: Workspace[];
  setWorkspaceId: (id: string) => void;
  /**
   * The repositories connected through the GitHub App first, then the
   * fixtures. A real row
   * carries what its runs say: onboarding while its first scan is up, and the
   * settled run's own words as its last check afterwards.
   */
  repos: Repo[];
  updateRepo: (id: string, patch: Partial<Repo>) => void;
  unlinkRepo: (id: string) => void;
  /**
   * Re-read the real registry, and ANSWER with what it holds now. Called once a
   * repository is linked through the GitHub App — the caller needs the fresh
   * rows (a newly linked repository's registry id) before the state it just set
   * has reached a render.
   */
  refreshRealRepos: () => Promise<Repo[]>;
  /** The real runs' notifications (newest first), then the fixture feed. */
  notifications: PreviewNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** The real runs in flight, then the fixture jobs. */
  jobs: JobChain[];
  /**
   * The initial reads behind `jobs` are in (real repo list + each repo's runs).
   * Until then `jobs` is provably incomplete, and "already in flight when the
   * page loaded" cannot be told apart from "just started" — the toast surface
   * waits on this before it snapshots what to stay silent about.
   */
  jobsReady: boolean;
  /** The real runs that ended badly, newest first. */
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

/** Advance any "N of M" counter by one, stopping at M. The only motion the preview has. */
function tickCounter(counter: string): string {
  return counter.replace(/(\d+) of (\d+)/, (whole, a: string, b: string) => {
    const next = Math.min(Number(a) + 1, Number(b));
    return `${next} of ${b}`;
  });
}

function tickJobs(jobs: JobChain[]): JobChain[] {
  return jobs.map((job) => ({
    ...job,
    steps: job.steps.map((s) => (s.counter ? { ...s, counter: tickCounter(s.counter) } : s)),
  }));
}

const slugOf = (fullName: string): string => fullName.split('/').slice(-1)[0] ?? fullName;

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const orgName = status === 'authed' ? user?.organizationName : undefined;
  const [workspaceId, setWorkspaceId] = useState(ACTIVE_WORKSPACE_ID);
  const [repos, setRepos] = useState<Repo[]>(REPOS);
  const [realRepos, setRealRepos] = useState<Repo[]>([]);
  const [realReposLoaded, setRealReposLoaded] = useState(false);
  const [notifications, setNotifications] = useState<PreviewNotification[]>(NOTIFICATIONS);
  const [jobs, setJobs] = useState<JobChain[]>(JOBS_IN_FLIGHT);
  const [llmProvider, setLlmProvider] = useState<LlmProviderState>('unknown');

  useEffect(() => {
    const timer = setInterval(() => setJobs((prev) => tickJobs(prev)), 4000);
    return () => clearInterval(timer);
  }, []);

  const refreshRealRepos = useCallback(async () => {
    const found = await fetchRealRepos();
    setRealRepos(found);
    return found;
  }, []);

  // The real registry, read once on mount. `fetchRealRepos` never rejects, so a
  // preview with no server behind it simply has no real repositories.
  useEffect(() => {
    let live = true;
    void fetchRealRepos().then((found) => {
      if (!live) return;
      setRealRepos(found);
      setRealReposLoaded(true);
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

  const updateRepo = useCallback((id: string, patch: Partial<Repo>) => {
    setRealRepos((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setRepos((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  /**
   * A fixture row just disappears; a real one is really disconnected. The row
   * goes optimistically and the refresh settles it either way — so a refused
   * disconnect (the server holds the repo while a scan it cannot stop writes
   * into it) has to SAY so, or the row simply reappears and reads as a bug.
   */
  const unlinkRepo = useCallback(
    (id: string) => {
      if (realRepos.some((r) => r.id === id)) {
        setRealRepos((prev) => prev.filter((r) => r.id !== id));
        void disconnectRealRepo(id)
          .catch((e: unknown) => {
            toast.error('Could not disconnect', {
              description: e instanceof Error ? e.message : String(e),
            });
          })
          .then(refreshRealRepos);
        return;
      }
      setRepos((prev) => prev.filter((r) => r.id !== id));
    },
    [realRepos, refreshRealRepos],
  );

  // The real repositories' runs, followed live. Inert without a server.
  const realRuns = useRealRunStream(realRepos, realReposLoaded);

  const markRead = useCallback(
    (id: string) => {
      realRuns.markRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    },
    [realRuns],
  );

  const markAllRead = useCallback(() => {
    realRuns.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [realRuns]);

  const value = useMemo<PreviewStateValue>(() => {
    const fixture = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0]!;
    // The workspace the user is in is theirs, so it wears their org's name.
    const workspace = orgName
      ? { ...fixture, name: orgName, initial: orgName.trim().charAt(0).toUpperCase() }
      : fixture;
    // A real repository's row tells the truth about its runs: the onboarding
    // marker while its first scan is up, and a settled run's own words after.
    const allRepos = [
      ...realRepos.map((repo) => {
        const state = realRuns.repoState.get(repo.id);
        if (!state) return repo;
        return {
          ...repo,
          onboarding: state.onboarding,
          scanning: state.scanning,
          ...(state.lastCheck ? { lastCheck: state.lastCheck } : {}),
        };
      }),
      ...repos,
    ];
    const allNotifications = [...realRuns.notifications, ...notifications];
    return {
      workspace,
      workspaces: WORKSPACES,
      setWorkspaceId,
      repos: allRepos,
      updateRepo,
      unlinkRepo,
      refreshRealRepos,
      notifications: allNotifications,
      unreadCount: allNotifications.filter((n) => !n.read).length,
      markRead,
      markAllRead,
      // Real jobs first: they are the ones actually happening.
      jobs: [...realRuns.jobs, ...jobs],
      jobsReady: realRuns.ready,
      runFailures: realRuns.failures,
      llmProvider,
      refreshLlmProvider,
    };
  }, [
    workspaceId,
    orgName,
    repos,
    realRepos,
    realRuns,
    notifications,
    jobs,
    llmProvider,
    refreshLlmProvider,
    updateRepo,
    unlinkRepo,
    refreshRealRepos,
    markRead,
    markAllRead,
  ]);

  return <PreviewStateContext.Provider value={value}>{children}</PreviewStateContext.Provider>;
}

export function usePreviewState(): PreviewStateValue {
  const value = useContext(PreviewStateContext);
  if (!value) throw new Error('usePreviewState must be used inside PreviewStateProvider');
  return value;
}
