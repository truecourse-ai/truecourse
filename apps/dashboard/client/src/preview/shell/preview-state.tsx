// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The preview's session state: the parts of the mock a user can actually move.
 * Connecting a provider flips it to connected, connecting repositories adds
 * rows and an onboarding chain, a policy toggle sticks, reading a notification
 * clears its dot, and the active job's counter climbs on a timer (a counter,
 * never a bar).
 *
 * Nothing here is persisted: no localStorage, no server call, no socket. A
 * reload is a fresh mock, which is the point.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ACTIVE_WORKSPACE_ID,
  CONNECTABLE_REPOS,
  NEW_CONNECTION,
  NEW_CONNECTION_REPOS,
  JOBS_IN_FLIGHT,
  NOTIFICATIONS,
  PROVIDER_CONNECTIONS,
  PRIVATE_REPO_ALLOWANCE,
  REPOS,
  WORKSPACES,
} from '@/preview/data';
import type {
  ConnectableRepo,
  JobChain,
  PreviewNotification,
  ProviderConnection,
  ProviderId,
  Repo,
  Workspace,
} from '@/preview/data/types';

interface PreviewStateValue {
  workspace: Workspace;
  workspaces: Workspace[];
  setWorkspaceId: (id: string) => void;
  repos: Repo[];
  updateRepo: (id: string, patch: Partial<Repo>) => void;
  unlinkRepo: (id: string) => void;
  connections: ProviderConnection[];
  /** Repositories the picker can offer: the seeded ones plus those of added connections. */
  connectableRepos: ConnectableRepo[];
  addConnection: (provider: ProviderId) => ProviderConnection;
  revokeConnection: (id: string) => void;
  connectRepositories: (fullNames: string[]) => void;
  privateReposUsed: number;
  privateRepoLimit: number;
  notifications: PreviewNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  jobs: JobChain[];
  /** Coverage versions regenerated in this session (a PR version that got its scenarios). */
  generatedVersions: ReadonlySet<string>;
  regenerateVersion: (repo: Repo, versionId: string, label: string) => void;
}

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
  const [workspaceId, setWorkspaceId] = useState(ACTIVE_WORKSPACE_ID);
  const [repos, setRepos] = useState<Repo[]>(REPOS);
  const [connections, setConnections] = useState<ProviderConnection[]>(PROVIDER_CONNECTIONS);
  const [notifications, setNotifications] = useState<PreviewNotification[]>(NOTIFICATIONS);
  const [jobs, setJobs] = useState<JobChain[]>(JOBS_IN_FLIGHT);
  const [generatedVersions, setGeneratedVersions] = useState<ReadonlySet<string>>(() => new Set());

  const regenerateVersion = useCallback((repo: Repo, versionId: string, label: string) => {
    setGeneratedVersions((prev) => new Set([...prev, versionId]));
    setJobs((prev) => [
      ...prev,
      {
        id: `job-regen-${versionId}`,
        title: `Regenerating ${repo.fullName} ${label}`,
        repoFullName: repo.fullName,
        steps: [
          { key: 'scan', label: 'Scan the changed documents', state: 'done' },
          { key: 'generate', label: 'Generate scenarios', state: 'active', counter: 'generating 2 of 9 flows' },
          { key: 'gate', label: 'Re-gate the pull request', state: 'pending' },
        ],
      },
    ]);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setJobs((prev) => tickJobs(prev)), 4000);
    return () => clearInterval(timer);
  }, []);

  const updateRepo = useCallback((id: string, patch: Partial<Repo>) => {
    setRepos((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const unlinkRepo = useCallback((id: string) => {
    setRepos((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const [connectableRepos, setConnectableRepos] = useState<ConnectableRepo[]>(CONNECTABLE_REPOS);

  const addConnection = useCallback((provider: ProviderId): ProviderConnection => {
    const seed = NEW_CONNECTION[provider];
    const id = `${provider}-${seed.account}`;
    const connection: ProviderConnection = { ...seed, id, connectedAt: 'just now' };
    setConnections((prev) => [...prev, connection]);
    setConnectableRepos((prev) => [
      ...prev,
      ...NEW_CONNECTION_REPOS[provider].map((r) => ({ ...r, connectionId: id })),
    ]);
    return connection;
  }, []);

  const revokeConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setConnectableRepos((prev) => prev.filter((r) => r.connectionId !== id));
  }, []);

  const connectRepositories = useCallback((fullNames: string[]) => {
    const picked = connectableRepos.filter((c) => fullNames.includes(c.fullName));
    if (picked.length === 0) return;
    setRepos((prev) => [
      ...prev,
      ...picked
        .filter((c) => !prev.some((r) => r.fullName === c.fullName))
        .map(
          (c): Repo => ({
            id: slugOf(c.fullName),
            fullName: c.fullName,
            provider: c.provider,
            visibility: c.visibility,
            defaultBranch: c.defaultBranch,
            policy: 'blocking',
            baselineSha: 'no baseline yet',
            baselineAt: 'no baseline yet',
            notifyEmails: [],
            lastCheck: {
              conclusion: 'neutral',
              word: 'Neutral',
              summary: 'Baseline not established, onboarding just started',
              at: 'just now',
            },
            onboarding: true,
          }),
        ),
    ]);
    setJobs((prev) => [
      ...prev,
      ...picked.map(
        (c): JobChain => ({
          id: `job-onboard-${slugOf(c.fullName)}`,
          title: `Onboarding ${c.fullName}`,
          repoFullName: c.fullName,
          steps: [
            { key: 'clone', label: 'Clone and index', state: 'active', counter: 'indexing 3 of 412 files' },
            { key: 'scan', label: 'Scan the spec corpus', state: 'pending' },
            { key: 'setup', label: 'Guard setup', state: 'pending' },
            { key: 'generate', label: 'Generate scenarios', state: 'pending' },
            { key: 'baseline', label: 'Baseline run', state: 'pending' },
          ],
        }),
      ),
    ]);
  }, [connectableRepos]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const value = useMemo<PreviewStateValue>(() => {
    const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0]!;
    return {
      workspace,
      workspaces: WORKSPACES,
      setWorkspaceId,
      repos,
      updateRepo,
      unlinkRepo,
      connections,
      connectableRepos,
      addConnection,
      revokeConnection,
      connectRepositories,
      privateReposUsed: repos.filter((r) => r.visibility === 'private').length,
      privateRepoLimit: PRIVATE_REPO_ALLOWANCE.limit,
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      markRead,
      markAllRead,
      jobs,
      generatedVersions,
      regenerateVersion,
    };
  }, [
    workspaceId,
    repos,
    connections,
    notifications,
    jobs,
    generatedVersions,
    regenerateVersion,
    generatedVersions,
    regenerateVersion,
    updateRepo,
    unlinkRepo,
    connectableRepos,
    addConnection,
    revokeConnection,
    connectRepositories,
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
