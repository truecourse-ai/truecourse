/**
 * `context.scan` — the workspace DOCUMENT SCAN, as a background job.
 *
 * One per workspace, single-flight per workspace, and COALESCING: a trigger
 * that lands while a scan runs does not queue a second job and is not dropped
 * either — the workspace's own staleness stamp (`changedAt`, moved by every
 * sync that reconciled something, every link made or dropped, every source
 * removed) IS the pending buffer, so when the scan settles it compares that
 * stamp against the moment it started reading and queues exactly ONE more run
 * if the context moved under it.
 *
 * The scan clones nothing: the context store's documents are materialized into
 * a scratch tree and curated there (`@truecourse/core/commands/context-scan`).
 * What comes out is the workspace spec set — the corpus, the decisions the run
 * settled, and the documents as it read them.
 *
 * The job posts ONE notification. What the corpus change means for the
 * repositories is the RIPPLE (`../context-ripple.js`), run from the settle hook
 * so the single-flight key is already free.
 */

import { log } from '@truecourse/core/lib/logger';
import { CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { StepTracker } from '@truecourse/core/progress';
import { contextChangedAt } from '@truecourse/core/lib/context-store';
import { workspaceContextScanInProcess } from '@truecourse/core/commands/context-scan';
import { openConflicts } from '@truecourse/shared';
import type { JobContext, JobDefinition, JobPayload } from '@truecourse/jobs';
import {
  LlmProbeFailedError,
  startWorkspaceLlm,
  type WorkspaceLlm,
} from '../../services/workspace-llm.service.js';
import { recordFailedWorkspaceScanRun } from '../../services/context-scan.service.js';
import { emitContextChanged } from '../../services/context.service.js';
import {
  rippleContextScan,
  type ContextRippleDeps,
  type ContextRippleInput,
} from '../context-ripple.js';

export const CONTEXT_SCAN_TASK = 'context.scan';

/** What asked for this scan. Carried for the log line and the row's payload. */
export type ContextScanSource = 'manual' | 'sync' | 'link' | 'connect' | 'rescan';

/** What an enqueue is asked for — the payload minus the row the queue creates. */
export interface ContextScanJobRequest {
  workspaceOrgId: string;
  source: ContextScanSource;
}

export type ContextScanJobPayload = ContextScanJobRequest & JobPayload;

export interface ContextScanJobResult {
  documents: number;
  areas: number;
  openConflicts: number;
  corpusChanged: boolean;
  /** When the scan began reading — the coalesce comparison's other side. */
  startedAt: string;
}

export interface ContextScanTaskDeps {
  startLlm?: (orgId: string) => Promise<WorkspaceLlm>;
  runScan?: typeof workspaceContextScanInProcess;
  /** The ripple's collaborators, built by the mount (they need the enqueues). */
  ripple?: (org: string) => ContextRippleDeps;
  /** Queue the one coalesced follow-up run. */
  rescan?: (request: ContextScanJobRequest) => Promise<void>;
  now?: () => Date;
}

export function createContextScanTask(
  deps: ContextScanTaskDeps = {},
): JobDefinition<ContextScanJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runScan = deps.runScan ?? workspaceContextScanInProcess;
  const now = deps.now ?? (() => new Date());
  // What the settle hook needs and the row cannot carry: the two corpora the
  // ripple compares. Keyed by job id, and cleared however the job settles.
  const rippleInputs = new Map<string, ContextRippleInput>();
  // The session run the scan opened, so the failure notification can carry its
  // address too: `onError` is handed the payload alone. Same lifetime.
  const runIds = new Map<string, string>();

  return {
    type: CONTEXT_SCAN_TASK,
    title: 'Scanning documents',
    steps: [...CURATE_STEPS],
    org: (payload) => payload.workspaceOrgId,

    async run(ctx) {
      const org = ctx.payload.workspaceOrgId;
      // Stamped BEFORE anything is read, so a sync that lands mid-scan is
      // seen by the coalesce check even though the corpus it produced is older.
      const startedAt = now().toISOString();
      let llm: WorkspaceLlm;
      try {
        llm = await startLlm(org);
      } catch (err) {
        // The probe died before the scan could open a run — create one carrying
        // the reason, so the Agent page shows a failed scan instead of nothing.
        if (err instanceof LlmProbeFailedError) {
          const runId = await recordFailedWorkspaceScanRun(org, {
            message: err.message,
            kind: 'llm-probe',
          });
          if (runId) runIds.set(ctx.jobId, runId);
        }
        throw err;
      }

      const result = await runScan({
        workspaceOrgId: org,
        repositories: await repositoriesOf(deps, org),
        tracker: checklistTracker(ctx),
        source: 'dashboard',
        driver: llm.driver(),
        transportMode: llm.mode,
        onRunStarted: (info) => {
          runIds.set(ctx.jobId, info.runId);
          void ctx.notify({ level: 'started', title: 'Document scan started', data: { runId: info.runId } });
        },
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      const conflicts = openConflicts(result.corpus, result.decisions).length;
      await emitContextChanged(org, { change: 'documents' });
      rippleInputs.set(ctx.jobId, {
        previousCorpus: result.previousCorpus,
        corpus: result.corpus,
        corpusChanged: result.corpusChanged,
        openConflicts: conflicts,
      });

      const jobResult: ContextScanJobResult = {
        documents: result.documents,
        areas: result.corpus.areas.length,
        openConflicts: conflicts,
        corpusChanged: result.corpusChanged,
        startedAt,
      };
      const runId = runIds.get(ctx.jobId);
      return {
        result: jobResult,
        notification:
          conflicts > 0
            ? {
                level: 'warning',
                title: 'Documents scanned, conflicts to resolve',
                body: `${result.corpus.docs.length} document${result.corpus.docs.length === 1 ? '' : 's'} curated, but ${conflicts} open conflict${conflicts === 1 ? '' : 's'} must be resolved before tests are regenerated.`,
                data: { openConflicts: conflicts, ...(runId ? { runId } : {}) },
              }
            : {
                level: 'success',
                title: 'Documents scanned',
                body: `${result.corpus.docs.length} document${result.corpus.docs.length === 1 ? '' : 's'} in ${result.corpus.areas.length} area${result.corpus.areas.length === 1 ? '' : 's'}.`,
                data: { documents: result.corpus.docs.length, ...(runId ? { runId } : {}) },
              },
      };
    },

    onError: (err, payload) => {
      const runId = runIds.get(payload.jobId);
      return {
        level: 'error',
        title: 'Document scan failed',
        body: err.message,
        data: { workspaceOrgId: payload.workspaceOrgId, ...(runId ? { runId } : {}) },
      };
    },

    async onSettled(ctx, outcome, result) {
      const org = ctx.payload.workspaceOrgId;
      const input = rippleInputs.get(ctx.jobId);
      rippleInputs.delete(ctx.jobId);
      runIds.delete(ctx.jobId);
      if (outcome !== 'succeeded') return;
      const scan = result as ContextScanJobResult | undefined;
      if (!scan) return;
      // The ripple runs here, not in the body: the single-flight key is free,
      // so a repository's own job can be enqueued without fighting this one.
      // It settles AFTER the row did, so what it started is logged rather than
      // written back onto a result nobody would re-read.
      if (deps.ripple && input) {
        const started = await rippleContextScan(deps.ripple(org), input);
        if (started.length > 0) {
          log.info(
            `[context] ${org} rippled to ${started
              .map((s) => `${s.repoFullName} (${s.job})`)
              .join(', ')}`,
          );
        }
      }
      await coalesceFollowUp(deps, org, scan.startedAt);
    },
  };
}

/**
 * Did the context move while the scan was reading it? The workspace's staleness
 * stamp says so, and one follow-up run — never N — is queued to see it.
 */
async function coalesceFollowUp(
  deps: ContextScanTaskDeps,
  org: string,
  startedAt: string,
): Promise<void> {
  if (!deps.rescan) return;
  try {
    const changedAt = await contextChangedAt(org);
    if (!changedAt || changedAt <= startedAt) return;
    log.info(`[context] ${org} changed while scanning — queueing one follow-up scan`);
    await deps.rescan({ workspaceOrgId: org, source: 'rescan' });
  } catch (err) {
    log.warn(`[context] could not queue the follow-up scan for ${org}: ${(err as Error).message}`);
  }
}

/** The connected repositories of the workspace, for the identity block. */
async function repositoriesOf(deps: ContextScanTaskDeps, org: string): Promise<string[]> {
  if (!deps.ripple) return [];
  try {
    return (await deps.ripple(org).listRepos()).map((repo) => repo.repoFullName);
  } catch (err) {
    log.warn(`[context] could not list ${org}'s repositories: ${(err as Error).message}`);
    return [];
  }
}

/**
 * The scan's phases ARE this job's checklist (there is no repository socket
 * room for a workspace surface — Context follows the job's own SSE stream).
 */
function checklistTracker(ctx: JobContext<ContextScanJobPayload>): StepTracker {
  let active = '';
  return new StepTracker((payload) => {
    const step = payload.steps?.find((s) => s.status === 'active');
    if (!step) return;
    if (step.key === active) {
      if (step.detail) void ctx.detail(step.key, step.detail);
    } else {
      active = step.key;
      void ctx.phase(step.key, step.detail);
    }
  }, CURATE_STEPS.map((s) => ({ ...s })));
}

/** The single-flight key: one active scan per workspace. */
export const contextScanJobKey = (): string => CONTEXT_SCAN_TASK;
