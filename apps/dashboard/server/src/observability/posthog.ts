/**
 * Product analytics from the SERVER: how the work someone started turned out.
 *
 * The client sends the `*_started` events, because starting is a click. Nobody
 * is clicking when a job finishes twenty minutes later, and the tab that
 * started it may be long closed — so the finish is sent from the one place
 * every job settles, the queue's settled seam (`JobRuntime.onSettled`).
 *
 * SAME PROJECT AS THE CLIENT, tagged `source: 'server'` instead of
 * `'dashboard'`, and attributed to the workspace GROUP the client already
 * attaches — with no person profile, since a job has no actor: it is the
 * workspace's work, and the org id is not a person.
 *
 * WHAT IS SENT: the event name, the outcome, how long it took, the job id and
 * the repository it was for. Never a payload, an error message, a key or a
 * token. `POSTHOG_DISABLED=1` and nothing is sent at all — no client is even
 * created.
 *
 * The one event here that IS a person's doing is `workspace_created`: it is
 * sent from the route that creates the organization, because the browser
 * reloads the moment the workspace exists and a capture sent from there races
 * the unload — the same event delivered twice. The server has no such race.
 */

import { PostHog } from 'posthog-node';
import type { JobSettledInfo } from '@truecourse/jobs';
import { log } from '@truecourse/core/lib/logger';

/**
 * The project the dashboard, the landing site and this server share. Project
 * API keys are write-only, so it is a default rather than required setup;
 * `POSTHOG_KEY` / `POSTHOG_HOST` point a deployment at another project.
 */
const DEFAULT_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';
const DEFAULT_HOST = 'https://us.i.posthog.com';

/** Which of the clients an event came from. */
const SOURCE = 'server';

/** The PostHog group a workspace's events are attributed to. */
const GROUP = 'workspace';

/**
 * The finish of a job someone asked for, named to pair with the `*_started`
 * event the client sends when the request was accepted. A job type that is
 * nobody's action — the scheduled `context.sync` — is absent on purpose.
 */
const FINISHED_EVENTS: Record<string, string> = {
  'context.scan': 'scan_finished',
  'repo.guard-setup': 'setup_finished',
  'repo.guard-generate': 'generate_finished',
  'repo.guard-run': 'run_finished',
};

let client: PostHog | null = null;
let resolved = false;

/** The deployment was told to send nothing. */
function disabled(): boolean {
  const flag = process.env.POSTHOG_DISABLED;
  return flag === '1' || flag === 'true';
}

/**
 * The process's one client, created on the first event worth sending — so a
 * disabled deployment, and one that never finishes a job, open nothing.
 */
function analytics(): PostHog | null {
  if (resolved) return client;
  resolved = true;
  if (disabled()) return null;
  client = new PostHog(process.env.POSTHOG_KEY || DEFAULT_KEY, {
    host: process.env.POSTHOG_HOST || DEFAULT_HOST,
  });
  return client;
}

/** One settled background job, as the finish of what someone started. */
export function captureJobFinished(info: JobSettledInfo): void {
  const event = FINISHED_EVENTS[info.type];
  if (!event) return;
  const posthog = analytics();
  if (!posthog) return;
  posthog.capture({
    distinctId: info.org,
    event,
    properties: {
      source: SOURCE,
      outcome: info.outcome,
      durationSeconds: Math.round(info.durationMs / 100) / 10,
      jobId: info.jobId,
      repo: info.meta?.repoFullName ?? undefined,
      commit: info.meta?.commitSha ?? undefined,
      // The distinct id is a workspace, not a person; naming it as one would
      // mint a person profile for every workspace.
      $process_person_profile: false,
    },
    groups: { [GROUP]: info.org },
  });
}

/** A new signup, as the server saw it: the person and the workspace they named. */
export interface WorkspaceCreatedInfo {
  userId: string;
  email: string;
  name?: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * A self-serve signup named their workspace: the one moment a new customer
 * appears. Sent as the person, under the same distinct id the client
 * identifies them by, with the email and name set on the person so the
 * destination reading it has them even before the browser's identify lands.
 */
export function captureWorkspaceCreated(info: WorkspaceCreatedInfo): void {
  const posthog = analytics();
  if (!posthog) return;
  posthog.capture({
    distinctId: info.userId,
    event: 'workspace_created',
    properties: {
      source: SOURCE,
      workspaceId: info.workspaceId,
      workspaceName: info.workspaceName,
      $set: { email: info.email, ...(info.name ? { name: info.name } : {}) },
    },
    groups: { [GROUP]: info.workspaceId },
  });
}

/** Let the batched events leave before a deployment stops Node. */
export async function shutdownServerAnalytics(): Promise<void> {
  const posthog = client;
  client = null;
  if (!posthog) return;
  try {
    await posthog.shutdown();
  } catch (err) {
    log.warn(`[analytics] could not flush on shutdown: ${(err as Error).message}`);
  }
}
