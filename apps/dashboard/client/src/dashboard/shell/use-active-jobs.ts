/**
 * The workspace's background jobs, and what is waiting behind what.
 *
 * `GET /api/jobs?active=1` is the whole read: every job of the workspace that
 * is `queued` or `running`. It is the ONLY place waiting work is visible. A job
 * writes its run record when its body starts, and the three heavy jobs share
 * one queue per workspace and run one at a time, so a repository's generation
 * can sit `queued` behind another repository's for as long as that one takes —
 * with no run record to list it by.
 *
 * It follows the page's one stream: a job ticking or settling is how the queue
 * moves, so either frame re-reads the list, debounced so a burst of progress
 * frames costs one request. A job enqueued while nothing else publishes appears
 * on the next frame of the job it waits behind.
 *
 * Degrades to nothing: with no server behind the page the read fails quietly
 * and the workspace has no jobs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobView } from '@truecourse/shared';
import { listActiveJobs } from '@/lib/api';
import { commandLabel } from '@/components/sessions/run-model';
import { subscribeToServerEvents } from './event-stream';

/** How long a frame waits for its neighbours before the list is re-read. */
const DEBOUNCE_MS = 500;

/**
 * The run command each job type runs. A type with none — a source sync — writes
 * no run record and is nobody's conversation.
 */
const JOB_COMMAND: Record<string, string> = {
  'repo.guard-setup': 'guard-setup',
  'repo.guard-generate': 'guard-generate',
  'repo.guard-run': 'guard-run',
  'repo.pr-check': 'pr-check',
  'context.scan': 'spec-scan',
};

/** The jobs that share the workspace's one heavy queue, one at a time. */
const HEAVY_TYPES = ['repo.guard-setup', 'repo.guard-generate', 'repo.guard-run', 'repo.pr-check'];

/** The command a job runs, or null for work that becomes no conversation. */
export const jobCommand = (job: JobView): string | null => JOB_COMMAND[job.type] ?? null;

/**
 * The repository a job runs for, read off its single-flight key
 * (`<type>:<owner/repo>`, the server's `jobKey`; a pull request check's key
 * carries `#<number>` after it). The workspace's own document scan names no
 * repository, and its key is the type alone.
 */
export function jobRepoFullName(job: JobView): string | null {
  const prefix = `${job.type}:`;
  if (job.key?.startsWith(prefix) !== true) return null;
  return job.key.slice(prefix.length).replace(/#\d+$/, '');
}

/** The pull request a check job is for, off the same key; null for every other job. */
export function jobPullRequest(job: JobView): number | null {
  const match = job.type === 'repo.pr-check' ? /#(\d+)$/.exec(job.key ?? '') : null;
  return match ? Number(match[1]) : null;
}

/**
 * What a waiting job is waiting for, in one line: the work holding its lane
 * when the workspace's jobs name one, and the queue itself when they do not.
 */
export function waitingFact(job: JobView, jobs: readonly JobView[]): string {
  const holder = HEAVY_TYPES.includes(job.type)
    ? jobs.find((j) => j.status === 'running' && HEAVY_TYPES.includes(j.type))
    : undefined;
  const command = holder ? jobCommand(holder) : null;
  if (!holder || !command) return 'waiting in the queue';
  const repo = jobRepoFullName(holder);
  return `waiting for ${commandLabel(command)}${repo ? ` on ${repo}` : ''}`;
}

export interface ActiveJobsState {
  /** The workspace's queued and running jobs. Empty until the read lands. */
  jobs: JobView[];
  /** The first read has settled, so an empty list means the workspace is idle. */
  ready: boolean;
}

export function useActiveJobs(): ActiveJobsState {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [ready, setReady] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const answer = await listActiveJobs();
      if (alive.current) setJobs(answer.jobs);
    } catch {
      // No server, or a workspace it will not answer for: what was read last
      // stands, since an unanswered read is not a workspace with nothing in it.
    } finally {
      if (alive.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(
    () =>
      subscribeToServerEvents((event) => {
        if (event.type !== 'job.progress' && event.type !== 'notification') return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          void read();
        }, DEBOUNCE_MS);
      }),
    [read],
  );

  return useMemo(() => ({ jobs, ready }), [jobs, ready]);
}
