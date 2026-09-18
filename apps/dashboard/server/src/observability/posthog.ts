/**
 * Product analytics from the SERVER: every product action the server can
 * establish, which is all of them except what only a browser sees.
 *
 * WHY HERE AND NOT IN THE BROWSER. The server is where a fact becomes true: the
 * row is written, the job is claimed, the provider answered its probe. A
 * capture sent from the tab that asked races the navigation that follows it,
 * misses every path no tab took (a webhook, a chained job, the scheduler), and
 * cannot be trusted by an ad blocker. So the browser keeps only what is
 * browser-only — pageviews, autocapture, the identify call, the Discord click —
 * and everything else leaves from here.
 *
 * SAME PROJECT AS THE CLIENT, tagged `source: 'server'` instead of
 * `'dashboard'`. An action a signed-in person took is sent as that person,
 * under the same distinct id the browser identifies them by; one no person
 * asked for is sent as the workspace, with NO person profile, since the org id
 * is not a person. Either way the workspace GROUP is attached.
 *
 * WHAT IS SENT: the event name, identifiers and kinds — a repository's full
 * name, a job id, a provider, a verdict. Never a payload, an error message, a
 * document, a key, a token or an invite URL. `POSTHOG_DISABLED=1` and nothing
 * is sent at all: no client is even created.
 */

import { PostHog } from 'posthog-node';
import type { Request } from 'express';
import type { JobSettledInfo, JobStartedInfo } from '@truecourse/jobs';
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
 * The named events this server sends, one per product action. The names are
 * here rather than at the call sites so the catalogue is readable in one place
 * and a name cannot drift between the place that fires it and the place that
 * reads it.
 */
export const EVENTS = {
  /** A repository row was written, whichever provider and path wrote it. */
  repoConnected: 'repo_connected',
  /** A repository row went: a disconnect, an uninstall, a revoked grant. */
  repoDisconnected: 'repo_disconnected',
  /** The workspace document scan was claimed and began. */
  scanStarted: 'scan_started',
  /** A repository's guard setup began. */
  setupStarted: 'setup_started',
  /** A repository's flow generation began. */
  generateStarted: 'generate_started',
  /** A repository's flow run began. */
  runStarted: 'run_started',
  /** The workspace document scan settled. */
  scanFinished: 'scan_finished',
  /** A repository's guard setup settled. */
  setupFinished: 'setup_finished',
  /** A repository's flow generation settled. */
  generateFinished: 'generate_finished',
  /** A repository's flow run settled. */
  runFinished: 'run_finished',
  /** A context source was stored (a repository's markdown, a documentation site). */
  contextSourceAdded: 'context_source_added',
  /** A documentation conflict was ruled on: a side picked, or dismissed. */
  conflictResolved: 'conflict_resolved',
  /** A flow or a claim was ruled out of testing. */
  findingDismissed: 'finding_dismissed',
  /** The workspace's LLM provider was saved on the Models page. */
  llmProviderSaved: 'llm_provider_saved',
  /** An invite link was minted on the Members page. */
  inviteLinkCreated: 'invite_link_created',
  /** A self-serve signup named their workspace. */
  workspaceCreated: 'workspace_created',
  /** An operator handed a workspace credits. */
  creditsGranted: 'credits_granted',
  /** A workspace ran out of credits — mid-run, or at a start it was refused. */
  creditsExhausted: 'credits_exhausted',
  /** A job stopped part-way with nothing wrong. */
  runPaused: 'run_paused',
  /** A paused job was carried on. */
  runResumed: 'run_resumed',
} as const;

export type ServerAnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * The start of a job someone asked for, named to pair with the `*_finished`
 * event below. A job type that is nobody's action — the scheduled
 * `context.sync` — is absent on purpose.
 */
const STARTED_EVENTS: Record<string, ServerAnalyticsEvent> = {
  'context.scan': EVENTS.scanStarted,
  'repo.guard-setup': EVENTS.setupStarted,
  'repo.guard-generate': EVENTS.generateStarted,
  'repo.guard-run': EVENTS.runStarted,
};

/** The finish of the same four, from the queue's settled seam. */
const FINISHED_EVENTS: Record<string, ServerAnalyticsEvent> = {
  'context.scan': EVENTS.scanFinished,
  'repo.guard-setup': EVENTS.setupFinished,
  'repo.guard-generate': EVENTS.generateFinished,
  'repo.guard-run': EVENTS.runFinished,
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
 * disabled deployment, and one that never does anything, open nothing.
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

/** Who an action belongs to, and what is worth saying about it. */
export interface ActionContext {
  /** The signed-in person behind it, when a request carried one. */
  userId?: string;
  /** The workspace it happened in — always known, always the group. */
  workspaceId: string;
  /** Identifiers and kinds only. */
  properties?: Record<string, unknown>;
}

/**
 * Who a route's action belongs to: the signed-in person, in their workspace.
 * Null when the session names no person or no workspace — an action nobody can
 * be attributed is not sent half-attributed.
 */
export function actorOf(req: Request): Pick<ActionContext, 'userId' | 'workspaceId'> | null {
  const user = req.user;
  if (!user?.id || !user.organizationId) return null;
  return { userId: user.id, workspaceId: user.organizationId };
}

/** One product action, as the server established it. */
export function captureAction(event: ServerAnalyticsEvent, ctx: ActionContext): void {
  const posthog = analytics();
  if (!posthog) return;
  posthog.capture({
    distinctId: ctx.userId ?? ctx.workspaceId,
    event,
    properties: {
      source: SOURCE,
      ...ctx.properties,
      // With no person on the path the distinct id is a workspace; naming it as
      // a person would mint a person profile for every workspace.
      ...(ctx.userId ? {} : { $process_person_profile: false }),
    },
    groups: { [GROUP]: ctx.workspaceId },
  });
}

/** One claimed background job, as the start of what someone asked for. */
export function captureJobStarted(info: JobStartedInfo): void {
  const event = STARTED_EVENTS[info.type];
  if (!event) return;
  captureAction(event, {
    ...(info.requestedBy ? { userId: info.requestedBy } : {}),
    workspaceId: info.org,
    properties: {
      jobId: info.jobId,
      repo: info.meta?.repoFullName ?? undefined,
      commit: info.meta?.commitSha ?? undefined,
      // Nobody asked for this one directly: a chain, a webhook or the clock.
      chained: !info.requestedBy,
    },
  });
}

/**
 * One settled background job. Always the workspace's, never a person's: nobody
 * is watching when a job finishes twenty minutes later, and the tab that asked
 * for it may be long closed.
 */
export function captureJobFinished(info: JobSettledInfo): void {
  // A pause is not a finish: the work is unfinished and nothing went wrong, so
  // it is its own event — and for every job type, not just the four that pair.
  if (info.outcome === 'paused') {
    captureAction(EVENTS.runPaused, {
      workspaceId: info.org,
      properties: {
        jobType: info.type,
        jobId: info.jobId,
        reason: 'credits',
        repo: info.meta?.repoFullName ?? undefined,
      },
    });
    return;
  }
  const event = FINISHED_EVENTS[info.type];
  if (!event) return;
  captureAction(event, {
    workspaceId: info.org,
    properties: {
      outcome: info.outcome,
      durationSeconds: Math.round(info.durationMs / 100) / 10,
      jobId: info.jobId,
      repo: info.meta?.repoFullName ?? undefined,
      commit: info.meta?.commitSha ?? undefined,
    },
  });
}

/** A paused job carried on — by a grant, by a key, or by somebody pressing Resume. */
export function captureRunResumed(org: string, jobType: string, jobId: string): void {
  captureAction(EVENTS.runResumed, {
    workspaceId: org,
    properties: { jobType, jobId, reason: 'credits' },
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
 * appears. Sent with the email and name set on the person so the destination
 * reading it has them even before the browser's identify lands.
 */
export function captureWorkspaceCreated(info: WorkspaceCreatedInfo): void {
  captureAction(EVENTS.workspaceCreated, {
    userId: info.userId,
    workspaceId: info.workspaceId,
    properties: {
      workspaceId: info.workspaceId,
      workspaceName: info.workspaceName,
      $set: { email: info.email, ...(info.name ? { name: info.name } : {}) },
    },
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
