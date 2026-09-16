/**
 * THE METER a job spends through: every call and every turn of one job, folded
 * by subject and written to the usage store while the job is still running.
 *
 * A job creates one at the top of its body and closes it in a `finally`, so
 * what it spent is on record however it ended — finished, failed, cancelled or
 * killed with the process. Spend is BUFFERED and flushed on a short timer
 * rather than written per call: a generate makes thousands of calls, and one
 * row per (job, subject) grown in place is what the page reads.
 *
 * Two things report into it, because the two halves of a run reach the model
 * differently. A one-shot stage reports through the transport's own `onUsage`,
 * threaded in where the transport is built (there is nothing to read usage off
 * a transport from outside: it answers with text). An agent session reports
 * through {@link meterDriver}, which wraps the driver's `runSession` and reads
 * the `assistant-turn` events it already emits — so a session is metered by
 * watching the transcript it writes anyway, with no second accounting path.
 *
 * Accounting must never break a run: every write here is caught and logged.
 */

import type { SessionDriver, SessionEventBody, TurnUsage } from '@truecourse/agent-loop';
import { log } from '@truecourse/core/lib/logger';
import {
  attachUsageRun,
  recordUsage,
  usageStoreInstalled,
  type UsageSubjectKind,
} from '@truecourse/core/lib/usage-store';

/** One call's or one turn's spend, as its producer reports it. */
export interface LlmSpend {
  subjectKind: UsageSubjectKind;
  /** The stage name, or the session kind. */
  subject: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
}

/** Where a run reports what it spent. Never throws. */
export type RunUsageObserver = (spend: LlmSpend) => void;

/** What every row of this meter's job carries. */
export interface UsageMeterSubject {
  workspaceOrgId: string;
  /** `owner/repo`; null for the work the workspace itself does. */
  repoFullName: string | null;
  jobType: string;
  jobId: string;
}

export interface UsageMeter {
  /** Hand the meter one call's or one turn's spend. */
  observe: RunUsageObserver;
  /**
   * Name the run this job opened. Rows already written are named too, so a job
   * whose run record arrives after the first call still points at it.
   */
  setRunId(runId: string): void;
  /** Write what is buffered now. */
  flush(): Promise<void>;
  /** Stop the timer and write the last of it. */
  close(): Promise<void>;
}

/** How long spend sits in memory before it is written. */
const FLUSH_MS = 5_000;

interface Pending {
  subjectKind: UsageSubjectKind;
  subject: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  calls: number;
  costUsd: number;
  startedAt: string;
  finishedAt: string;
}

export interface UsageMeterOptions {
  /** The flush interval; tests shorten it. */
  flushMs?: number;
  now?: () => Date;
}

export function createUsageMeter(
  subject: UsageMeterSubject,
  opts: UsageMeterOptions = {},
): UsageMeter {
  const flushMs = opts.flushMs ?? FLUSH_MS;
  const now = opts.now ?? (() => new Date());
  const buffer = new Map<string, Pending>();
  let runId: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const arm = (): void => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushMs);
    timer.unref?.();
  };

  /** One row of the job: a kind of subject, spelled once. */
  const keyOf = (subjectKind: UsageSubjectKind, subject: string): string =>
    JSON.stringify([subjectKind, subject]);

  /** Fold `pending` back in front of whatever arrived since, so a failed write retries. */
  const restore = (key: string, pending: Pending): void => {
    const held = buffer.get(key);
    if (!held) {
      buffer.set(key, pending);
      return;
    }
    held.inputTokens += pending.inputTokens;
    held.outputTokens += pending.outputTokens;
    held.cacheReadTokens += pending.cacheReadTokens;
    held.cacheCreateTokens += pending.cacheCreateTokens;
    held.calls += pending.calls;
    held.costUsd += pending.costUsd;
    if (pending.startedAt < held.startedAt) held.startedAt = pending.startedAt;
    if (pending.finishedAt > held.finishedAt) held.finishedAt = pending.finishedAt;
  };

  const flushNow = async (): Promise<void> => {
    if (buffer.size === 0) return;
    const taken = [...buffer.entries()];
    buffer.clear();
    for (const [key, pending] of taken) {
      try {
        await recordUsage({
          workspaceOrgId: subject.workspaceOrgId,
          repoFullName: subject.repoFullName,
          jobType: subject.jobType,
          jobId: subject.jobId,
          runId,
          subjectKind: pending.subjectKind,
          subject: pending.subject,
          provider: pending.provider,
          model: pending.model,
          inputTokens: pending.inputTokens,
          outputTokens: pending.outputTokens,
          cacheReadTokens: pending.cacheReadTokens,
          cacheCreateTokens: pending.cacheCreateTokens,
          calls: pending.calls,
          costUsd: pending.costUsd,
          startedAt: pending.startedAt,
          finishedAt: pending.finishedAt,
        });
      } catch (err) {
        restore(key, pending);
        log.warn(`[usage] could not record ${subject.jobType} spend: ${(err as Error).message}`);
      }
    }
  };

  // Writes run one at a time, in the order they were asked for: the timer and
  // `close()` must never take the same buffer, and closing must not return
  // while an earlier flush is still writing.
  let writing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    writing = writing.then(flushNow);
    return writing;
  };

  const observe: RunUsageObserver = (spend) => {
    // A process with no store installed has nowhere to put this; a run must not
    // grow a buffer nobody will ever drain.
    if (!usageStoreInstalled()) return;
    const at = now().toISOString();
    const key = keyOf(spend.subjectKind, spend.subject);
    const held = buffer.get(key);
    if (!held) {
      buffer.set(key, {
        subjectKind: spend.subjectKind,
        subject: spend.subject,
        provider: spend.provider,
        model: spend.model,
        inputTokens: spend.inputTokens,
        outputTokens: spend.outputTokens,
        cacheReadTokens: spend.cacheReadTokens,
        cacheCreateTokens: spend.cacheCreateTokens,
        calls: 1,
        costUsd: spend.costUsd,
        startedAt: at,
        finishedAt: at,
      });
    } else {
      held.inputTokens += spend.inputTokens;
      held.outputTokens += spend.outputTokens;
      held.cacheReadTokens += spend.cacheReadTokens;
      held.cacheCreateTokens += spend.cacheCreateTokens;
      held.calls += 1;
      held.costUsd += spend.costUsd;
      held.finishedAt = at;
      // The model a fallback swapped to is the one this row now names.
      if (spend.model) held.model = spend.model;
    }
    arm();
  };

  return {
    observe,
    setRunId(next) {
      if (runId === next) return;
      runId = next;
      if (!usageStoreInstalled()) return;
      // Rows already written carry no run id; this is what names them.
      void Promise.resolve()
        .then(() => attachUsageRun(subject.jobId, next))
        .catch((err: unknown) => {
          log.warn(`[usage] could not name run ${next}: ${(err as Error).message}`);
        });
    },
    flush,
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}

/**
 * The same driver, reporting what its sessions spend. Every `assistant-turn`
 * the driver emits carries the turn's four token buckets and its cost, so the
 * wrapper reads the transcript the session writes anyway and reports one spend
 * per turn, under the session's KIND — a pool of thirty flow workers is one
 * subject, not thirty.
 */
export function meterDriver(driver: SessionDriver, observe: RunUsageObserver): SessionDriver {
  return {
    capabilities: driver.capabilities,
    attribution: driver.attribution,
    runSession(input) {
      return driver.runSession({
        ...input,
        onEvent(event) {
          if (event.type === 'assistant-turn') {
            observe({
              subjectKind: 'session',
              subject: input.def.kind,
              provider: driver.attribution.provider,
              model: turnModel(event, driver),
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheCreateTokens: event.usage.cacheCreateTokens,
              costUsd: event.usage.costUsd,
            });
          }
          input.onEvent(event);
        },
      });
    },
  };
}

/** What served the turn: what the response said, else what the driver declared. */
function turnModel(
  event: SessionEventBody & { type: 'assistant-turn'; usage: TurnUsage },
  driver: SessionDriver,
): string {
  return event.model || driver.attribution.model;
}
