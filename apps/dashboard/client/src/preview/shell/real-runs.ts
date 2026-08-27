// PREVIEW: the REAL seam, widened — the agent-session runs of the URL-connected
// repositories, read from the server and followed live over the one socket the
// shell holds.

/**
 * Real runs, streaming into every page.
 *
 * §3.5: "Jobs and sessions stream live into every page through the one event
 * connection the shell already holds." This is that connection for the real
 * repositories. The shell joins each real repo's room once; every write to that
 * repo's `run.json` — a phase ticking over, a session appearing, the run
 * finishing — arrives as `session:runs-changed` and re-reads that repo's run
 * list, with the room's `spec:progress` as a second prompt for the same read
 * (see the subscription below for why). No polling, and no per-page
 * subscription: a job ticks on Home, on Settings, on another repository's
 * Coverage, because the subscription is the shell's, not a page's.
 *
 * The run records are then read three ways, which is everything the shell shows:
 *   - as JOB CHAINS (the toast and the in-flight list), one per running run,
 *     whose steps are the run record's own phase checklist;
 *   - as NOTIFICATIONS, one when a run starts and one when it settles;
 *   - as REPO STATE: the `onboarding` marker while a repository's first scan
 *     runs, and an honest "last check" once something has settled.
 *
 * NOTIFICATIONS ARE DERIVED, NOT STORED. There is no server-side notification
 * store and this does not invent one: the feed is what this session watched
 * happen, so a reload starts it over, and read state is session-local — exactly
 * like the rest of the preview.
 *
 * Degrades to nothing. With no server to ask (a static preview, a jsdom test)
 * the reads fail quietly, no run is known, and the shell has its fixtures only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSessionRuns, type PublicSessionRun } from '@/lib/api';
import { connectSocket, joinRepoRoom, leaveRepoRoom } from '@/lib/socket';
import { runChecklist } from '@/components/sessions/run-model';
import type { JobChain, JobStep, PreviewNotification, Repo } from '@/preview/data/types';
import { PREVIEW_BASE } from './base';

/** All the shell needs of a repository to describe its runs. */
export interface RunRepoRef {
  id: string;
  fullName: string;
}

/** The commands whose runs the shell announces, in the words the product uses. */
const COMMAND_NOUN: Record<string, string> = {
  'spec-scan': 'Spec scan',
  'guard-setup': 'Guard setup',
  'guard-generate': 'Scenario generation',
  'guard-interfaces': 'Interface authoring',
  'guard-adjudicate': 'Run adjudication',
};

const nounFor = (command: string): string => COMMAND_NOUN[command] ?? command;

const isSettled = (run: PublicSessionRun): boolean => run.status !== 'running';

/** The run-record phase checklist as job steps. `error` is not a job state: a
 *  run whose step errored is settled, and a settled run leaves the job list. */
const STEP_STATE: Record<string, JobStep['state']> = {
  done: 'done',
  active: 'active',
  pending: 'pending',
  error: 'pending',
};

/** "4 minutes ago" from an ISO stamp — the preview's time idiom, no library. */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return 'just now';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'just now';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Where a real run is watched: the preview's own Activity address. */
export const activityHref = (repoId: string): string => `${PREVIEW_BASE}/repos/${repoId}/activity`;

/**
 * One running run as a job chain. The title says ONBOARDING for a repository's
 * first spec scan and names the command for every later run: one job surface,
 * but a first scan IS the onboarding chain and a re-scan is not.
 */
export function toJobChain(repo: RunRepoRef, run: PublicSessionRun, first: boolean): JobChain {
  const steps: JobStep[] = runChecklist(run).map((p) => ({
    key: p.key,
    label: p.label,
    state: STEP_STATE[p.status] ?? 'pending',
    ...(p.detail ? { counter: p.detail } : {}),
  }));
  return {
    id: `real-${repo.id}-${run.runId}`,
    title:
      first && run.command === 'spec-scan'
        ? `Onboarding ${repo.fullName}`
        : `${nounFor(run.command)} ${repo.fullName}`,
    repoFullName: repo.fullName,
    href: activityHref(repo.id),
    // A run that has not published its checklist yet still has one honest step.
    steps: steps.length > 0 ? steps : [{ key: 'start', label: 'Starting', state: 'active' }],
  };
}

/** A notification plus the stamp it sorts on (the feed itself shows words). */
type TimedNotification = PreviewNotification & { sortAt: string };

/** The two notifications a run produces over its life: it started, it settled. */
export function toNotifications(
  repo: RunRepoRef,
  run: PublicSessionRun,
  now: number,
): TimedNotification[] {
  const noun = nounFor(run.command);
  const href = activityHref(repo.id);
  const rows: TimedNotification[] = [
    {
      id: `real-${repo.id}-${run.runId}-started`,
      level: 'neutral',
      title: `${noun} started on ${repo.fullName}`,
      body: "Watch it in the repository's Activity.",
      at: relativeTime(run.startedAt, now),
      read: false,
      href,
      sortAt: run.startedAt,
    },
  ];
  if (isSettled(run)) {
    const failed = run.status !== 'completed';
    rows.push({
      id: `real-${repo.id}-${run.runId}-settled`,
      level: failed ? 'failure' : 'success',
      title: `${noun} ${run.status} on ${repo.fullName}`,
      body: failed
        ? `The run ended ${run.status}. Its sessions and their transcripts are in Activity.`
        : `${run.sessions.length} session${run.sessions.length === 1 ? '' : 's'} ran.`,
      at: relativeTime(run.finishedAt ?? run.startedAt, now),
      read: false,
      href,
      sortAt: run.finishedAt ?? run.startedAt,
    });
  }
  return rows;
}

/** What a repository's runs say about the repository row itself. */
export interface RealRepoRunState {
  /** The repository's first scan is still running. */
  onboarding: boolean;
  /** Present once something has settled: the row's honest "last check". */
  lastCheck?: Repo['lastCheck'];
}

/** The oldest spec scan — the onboarding run, if the repo has ever had one. */
function firstScan(runs: PublicSessionRun[]): PublicSessionRun | undefined {
  return runs
    .filter((r) => r.command === 'spec-scan')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
}

export function repoRunState(runs: PublicSessionRun[], now: number): RealRepoRunState {
  const first = firstScan(runs);
  if (first && !isSettled(first)) return { onboarding: true };

  const settled = runs
    .filter(isSettled)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!settled) return { onboarding: false };
  return {
    onboarding: false,
    lastCheck: {
      conclusion: 'neutral',
      word: 'Neutral',
      summary: `${nounFor(settled.command)} ${settled.status}`,
      at: relativeTime(settled.finishedAt ?? settled.startedAt, now),
    },
  };
}

export interface RealRunStream {
  /** The in-flight jobs of the real repositories, newest run first. */
  jobs: JobChain[];
  /** Every start and settle this session watched, newest first. */
  notifications: PreviewNotification[];
  /** Per repo id: the onboarding marker and the honest last check. */
  repoState: ReadonlyMap<string, RealRepoRunState>;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/**
 * Follow the runs of every real repository. Re-subscribes when the real repo
 * list changes (a connect adds a row) and never throws: the reads are guarded
 * and the socket calls are inert when there is nothing to connect to.
 */
export function useRealRunStream(repos: Repo[]): RealRunStream {
  const [runsByRepo, setRunsByRepo] = useState<ReadonlyMap<string, PublicSessionRun[]>>(
    () => new Map(),
  );
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  // A clock, not an animation: re-read the wording every 30s so "just now"
  // becomes "4 minutes ago" without a socket event to prompt it.
  const [now, setNow] = useState(() => Date.now());

  // The repositories as a STRING, so every derivation below is stable while the
  // real list is unchanged — `repos` is a fresh array on every shell render.
  const repoKey = repos
    .filter((r) => r.real)
    .map((r) => `${r.id} ${r.fullName}`)
    .join('|');

  const repoRefs = useMemo<RunRepoRef[]>(
    () =>
      repoKey === ''
        ? []
        : repoKey.split('|').map((entry) => {
            const [id = '', fullName = ''] = entry.split(' ');
            return { id, fullName };
          }),
    [repoKey],
  );

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (repoRefs.length === 0) return;
    const repoIds = repoRefs.map((r) => r.id);
    let stopped = false;

    const read = async (repoId: string): Promise<void> => {
      try {
        const { runs } = await listSessionRuns(repoId);
        if (stopped || !alive.current) return;
        setRunsByRepo((prev) => new Map(prev).set(repoId, runs));
      } catch {
        // No server, or a repository it no longer knows: nothing to show.
      }
    };

    const join = (): void => {
      for (const repoId of repoIds) joinRepoRoom(repoId);
    };
    const onChanged = (payload: { repoId: string }): void => {
      if (repoIds.includes(payload.repoId)) void read(payload.repoId);
    };

    let socket: ReturnType<typeof connectSocket> | null = null;
    try {
      socket = connectSocket();
      socket.on('session:runs-changed', onChanged);
      // The store watcher is what normally drives the re-read, but it is armed
      // when the room is joined and a repository connected a moment ago may not
      // have a `sessions/` tree yet. The scan's own progress rides the SAME room
      // and is emitted after its run record exists, so listening to it too
      // closes that window — a re-read is one cheap GET either way.
      socket.on('spec:progress', onChanged);
      socket.on('spec:complete', onChanged);
      // The room is what makes the server watch the store at all, and joining
      // is a no-op until the socket is up — so join on every (re)connect too.
      socket.on('connect', join);
      join();
    } catch {
      socket = null; // no socket transport here; the reads below still stand
    }

    for (const repoId of repoIds) void read(repoId);

    return () => {
      stopped = true;
      for (const repoId of repoIds) leaveRepoRoom(repoId);
      socket?.off('session:runs-changed', onChanged);
      socket?.off('spec:progress', onChanged);
      socket?.off('spec:complete', onChanged);
      socket?.off('connect', join);
    };
  }, [repoRefs]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const derived = useMemo(() => {
    const jobs: { run: PublicSessionRun; chain: JobChain }[] = [];
    const notifications: TimedNotification[] = [];
    const repoState = new Map<string, RealRepoRunState>();

    for (const repo of repoRefs) {
      const runs = runsByRepo.get(repo.id);
      if (!runs || runs.length === 0) continue;
      repoState.set(repo.id, repoRunState(runs, now));
      const onboardingRunId = firstScan(runs)?.runId;
      for (const run of runs) {
        if (!isSettled(run)) {
          jobs.push({ run, chain: toJobChain(repo, run, run.runId === onboardingRunId) });
        }
        notifications.push(...toNotifications(repo, run, now));
      }
    }

    jobs.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
    notifications.sort((a, b) => b.sortAt.localeCompare(a.sortAt));
    return { jobs: jobs.map((j) => j.chain), notifications, repoState };
  }, [repoRefs, runsByRepo, now]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((prev) => new Set([...prev, ...derived.notifications.map((n) => n.id)]));
  }, [derived.notifications]);

  return useMemo(
    () => ({
      jobs: derived.jobs,
      notifications: derived.notifications.map(
        ({ sortAt: _sortAt, ...n }): PreviewNotification => ({ ...n, read: readIds.has(n.id) }),
      ),
      repoState: derived.repoState,
      markRead,
      markAllRead,
    }),
    [derived, readIds, markRead, markAllRead],
  );
}
