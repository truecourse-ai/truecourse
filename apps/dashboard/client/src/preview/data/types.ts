/**
 * The shapes the shell draws from. They are NOT the wire types of the real
 * product: they are the smallest honest description of what the shell itself
 * holds — the workspace and the user of the session, the connected
 * repositories of the registry, and the runs of those repositories read as
 * jobs and notifications. Everything a PAGE shows is read from the server in
 * the server's own shapes; nothing here is invented.
 */

export type ProviderId = 'github' | 'gitlab' | 'azure';

/** A check's conclusion. An error is reported as a failure, never as neutral. */
export type CheckConclusion = 'success' | 'failure' | 'neutral';

/** The workspace of the session: the organization the signed-in user is in. */
export interface Workspace {
  id: string;
  name: string;
  /** The sidebar's avatar-less initial. */
  initial: string;
}

export interface PreviewUser {
  name: string;
  email: string;
  initial: string;
  /** Operators see the Admin entry. */
  isOperator: boolean;
}

/** A repository connected through a provider, as the registry reports it. */
export interface Repo {
  /** The registry id, which is the address of the repository console. */
  id: string;
  fullName: string;
  provider: ProviderId;
  defaultBranch: string;
  /** What this repository's last settled run said. */
  lastCheck: {
    conclusion: CheckConclusion;
    word: string;
    summary: string;
    at: string;
  };
  /** True while the repository's first scan is still running. */
  onboarding: boolean;
  /** A spec scan is running on it — its first, or a rescan. */
  scanning?: boolean;
}

export interface JobStep {
  key: string;
  label: string;
  state: 'done' | 'active' | 'pending';
  /** The moving counter text of the active step. Never a bar. */
  counter?: string;
}

export interface JobChain {
  id: string;
  title: string;
  repoFullName: string;
  steps: JobStep[];
  /** Where the job is watched: the run's own conversation. */
  href: string;
}

export interface PreviewNotification {
  id: string;
  level: 'success' | 'failure' | 'blocked' | 'neutral';
  title: string;
  body: string;
  at: string;
  read: boolean;
  /** Where the row opens: the run's own conversation. */
  href?: string;
}
