/**
 * The runs of the connected repositories, streaming into every page.
 *
 * §3.5: "Jobs and sessions stream live into every page through the one event
 * connection the shell already holds." This is that connection. The shell joins
 * each repo's room once; every write to that
 * repo's `run.json` — a phase ticking over, a session appearing, the run
 * finishing — arrives as `session:runs-changed` and re-reads that repo's run
 * list, with the room's `spec:progress` as a second prompt for the same read
 * (see the subscription below for why). No polling, and no per-page
 * subscription: a job ticks on Home, on Settings, on another repository's
 * Coverage, because the subscription is the shell's, not a page's.
 *
 * The run records are then read three ways, which is everything the shell shows:
 *   - as JOB CHAINS (the toast and the in-flight list), one per running run,
 *     whose steps are the run record's own phase checklist, opening the run's
 *     own conversation rather than a list it would have to be found in;
 *   - as FAILURES, one announcement per run that ended badly;
 *   - as REPO STATE: the `onboarding` marker while a repository's first scan
 *     runs, and an honest "last check" once something has settled.
 *
 * The notification feed is not here: it is the SERVER's store, read by
 * `use-notifications.ts`.
 *
 * Degrades to nothing. With no server to ask (a static page, a jsdom test)
 * the reads fail quietly and no run is known.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { listSessionRuns, listWorkspaceRuns, type PublicSessionRun } from '@/lib/api';
import { getServerUrl } from '@/lib/server-url';
import { connectSocket, joinRepoRoom, leaveRepoRoom } from '@/lib/socket';
import { commandLabel, runChecklist } from '@/components/sessions/run-model';
import type { JobChain, JobStep, Repo } from '@/preview/data/types';
import { PREVIEW_BASE } from './base';

/** All the shell needs of a repository to describe its runs. */
export interface RunRepoRef {
  id: string;
  fullName: string;
}

/** A run's kind, in the words the Agent page uses for it. */
const nounFor = commandLabel;

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

/** Where a repository's work is watched: the Agent page, narrowed to it. */
export const activityHref = (repoId: string): string =>
  `${PREVIEW_BASE}/agent?repo=${encodeURIComponent(repoId)}`;

/** One piece of work as its own conversation. */
export const conversationHref = (runId: string): string =>
  `${PREVIEW_BASE}/agent/${encodeURIComponent(runId)}`;

/**
 * One running run as a job chain. The title says ONBOARDING for a repository's
 * first spec scan and names the command for every later run: one job surface,
 * but a first scan IS the onboarding chain and a re-scan is not.
 */
export function toJobChain(repo: RunRepoRef | null, run: PublicSessionRun, first: boolean): JobChain {
  const steps: JobStep[] = runChecklist(run).map((p) => ({
    key: p.key,
    label: p.label,
    state: STEP_STATE[p.status] ?? 'pending',
    ...(p.detail ? { counter: p.detail } : {}),
  }));
  return {
    id: `real-${repo?.id ?? 'workspace'}-${run.runId}`,
    title: !repo
      ? nounFor(run.command)
      : first && run.command === 'spec-scan'
        ? `Onboarding ${repo.fullName}`
        : `${nounFor(run.command)} ${repo.fullName}`,
    repoFullName: repo?.fullName ?? '',
    href: conversationHref(run.runId),
    // A run that has not published its checklist yet still has one honest step.
    steps: steps.length > 0 ? steps : [{ key: 'start', label: 'Starting', state: 'active' }],
  };
}

/**
 * A run that ended badly, as the shell announces it: once, when it lands.
 * The address is the conversation itself — a failure is worth opening, not just
 * hearing about.
 */
export interface RunFailure {
  /** One per run, so the announcement can't repeat on a re-read. */
  id: string;
  title: string;
  body: string;
  href: string;
}

export function toFailure(repo: RunRepoRef | null, run: PublicSessionRun): RunFailure | null {
  if (run.status !== 'failed') return null;
  return {
    id: `real-${repo?.id ?? 'workspace'}-${run.runId}`,
    title: repo ? `${nounFor(run.command)} failed on ${repo.fullName}` : `${nounFor(run.command)} failed`,
    body: run.error?.message ?? 'It ended failed.',
    href: conversationHref(run.runId),
  };
}

/** What a repository's runs say about the repository row itself. */
export interface RealRepoRunState {
  /** The repository's first scan is still running. */
  onboarding: boolean;
  /** Any spec scan is still running — the first one, or a rescan. */
  scanning: boolean;
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
  const scanning = runs.some((r) => r.command === 'spec-scan' && !isSettled(r));
  const first = firstScan(runs);
  if (first && !isSettled(first)) return { onboarding: true, scanning };

  const settled = runs
    .filter(isSettled)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!settled) return { onboarding: false, scanning };
  return {
    onboarding: false,
    scanning,
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
  /** The runs that ended badly, newest first — one entry per failed run. */
  failures: RunFailure[];
  /** Per repo id: the onboarding marker and the honest last check. */
  repoState: ReadonlyMap<string, RealRepoRunState>;
  /**
   * The initial reads are in: the repo list arrived AND every listed repo's
   * runs have been read once. What `jobs` holds at this moment was already in
   * flight on arrival — the distinction the toast surface needs, since it must
   * stay silent for those and announce only what starts later.
   */
  ready: boolean;
}

/**
 * Follow the runs of every connected repository. Re-subscribes when the repo
 * list changes (a connect adds a row) and never throws: the reads are guarded
 * and the socket calls are inert when there is nothing to connect to.
 *
 * `reposLoaded` says the CALLER's repo fetch has settled — `repos` being empty
 * is ambiguous on its own (not fetched yet vs. genuinely none), and `ready`
 * must not report an empty world as a loaded one.
 */
export function useRealRunStream(repos: Repo[], reposLoaded = true): RealRunStream {
  const [runsByRepo, setRunsByRepo] = useState<ReadonlyMap<string, PublicSessionRun[]>>(
    () => new Map(),
  );
  // Repo ids whose runs have been read at least once (success or failure) —
  // with `reposLoaded`, the two halves of `ready`.
  const [readRepoIds, setReadRepoIds] = useState<ReadonlySet<string>>(() => new Set());
  // The workspace's OWN runs (the Document scan), which belong to no repository
  // and no room: read from the workspace listing, re-read on the job stream.
  const [workspaceRuns, setWorkspaceRuns] = useState<PublicSessionRun[] | null>(null);
  // A clock, not an animation: re-read the wording every 30s so "just now"
  // becomes "4 minutes ago" without a socket event to prompt it.
  const [now, setNow] = useState(() => Date.now());

  // The repositories as a STRING, so every derivation below is stable while the
  // real list is unchanged — `repos` is a fresh array on every shell render.
  const repoKey = repos
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
      } finally {
        // Read once, however it went — a failed read is still an answered one
        // for readiness (there is nothing more to wait for).
        if (alive.current) {
          setReadRepoIds((prev) => (prev.has(repoId) ? prev : new Set(prev).add(repoId)));
        }
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

  useEffect(() => {
    let stopped = false;
    const read = async (): Promise<void> => {
      try {
        const { runs } = await listWorkspaceRuns({ limit: 50 });
        if (stopped || !alive.current) return;
        setWorkspaceRuns(runs.filter((run) => run.repo === null));
      } catch {
        if (!stopped && alive.current) setWorkspaceRuns((prev) => prev ?? []);
      }
    };
    void read();
    if (typeof EventSource === 'undefined') return () => { stopped = true; };
    let source: EventSource | null = null;
    try {
      source = new EventSource(`${getServerUrl()}/api/events`, { withCredentials: true });
    } catch {
      return () => { stopped = true; };
    }
    // A scan's progress and its settlement ride the job stream; either is a
    // reason to re-read what the workspace is running.
    const onMessage = (e: MessageEvent<string>): void => {
      try {
        const event = JSON.parse(e.data) as { type?: string };
        if (event.type === 'job.progress' || event.type === 'notification') void read();
      } catch {
        // A frame this client has no reading of changes nothing.
      }
    };
    source.addEventListener('message', onMessage);
    const stream = source;
    return () => {
      stopped = true;
      stream.removeEventListener('message', onMessage);
      stream.close();
    };
  }, []);

  const derived = useMemo(() => {
    const jobs: { run: PublicSessionRun; chain: JobChain }[] = [];
    const failures: { at: string; failure: RunFailure }[] = [];
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
        const failure = toFailure(repo, run);
        if (failure) failures.push({ at: run.finishedAt ?? run.startedAt, failure });
      }
    }
    for (const run of workspaceRuns ?? []) {
      if (!isSettled(run)) jobs.push({ run, chain: toJobChain(null, run, false) });
      const failure = toFailure(null, run);
      if (failure) failures.push({ at: run.finishedAt ?? run.startedAt, failure });
    }

    jobs.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
    failures.sort((a, b) => b.at.localeCompare(a.at));
    return {
      jobs: jobs.map((j) => j.chain),
      failures: failures.map((f) => f.failure),
      repoState,
    };
  }, [repoRefs, runsByRepo, workspaceRuns, now]);

  const ready = reposLoaded && workspaceRuns !== null && repoRefs.every((r) => readRepoIds.has(r.id));

  return useMemo(
    () => ({
      jobs: derived.jobs,
      failures: derived.failures,
      repoState: derived.repoState,
      ready,
    }),
    [derived, ready],
  );
}
