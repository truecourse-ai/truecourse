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
 * AND IT IS ALSO THE TILL. A workspace running on TrueCourse's own key spends a
 * granted balance, and this is the one place that sees every call and every
 * turn — so the check sits here too, rather than in a second accounting path
 * that would have to be kept in step with this one. The check is BEFORE (a call
 * that is about to be made, a turn that is about to be taken) and the debit is
 * after (one per flush, against the `llm_usage` row that flush landed on), so a
 * balance goes below zero by at most the one call in flight.
 *
 * Accounting must never break a run: every write here is caught and logged. The
 * CHECK is the one thing that does throw, and that is the point of it.
 */

import type {
  DriverResult,
  SessionDriver,
  SessionEventBody,
  SessionHandle,
  SessionStatus,
  TurnUsage,
} from '@truecourse/agent-loop';
import { log } from '@truecourse/core/lib/logger';
import { CreditsExhaustedError } from '@truecourse/core/lib/credits-store';
import { creditsOfUsd, CREDITS_PAUSE_FAILURE } from '@truecourse/shared';
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

/**
 * The balance a run spends from, and how a flush is taken off it. Built by the
 * credits service, which owns the ledger, the warnings and the analytics; the
 * meter holds only the number it must check against.
 */
export interface CreditsAccount {
  workspaceOrgId: string;
  /** What the workspace had when the run started. */
  balance: number;
  /** Take one flush off the balance, against the usage row it landed on. Answers what is left. */
  charge(credits: number, usageId: string): Promise<number>;
}

/** What a metered producer needs: somewhere to report, and the gate before spending. */
export interface RunMeter {
  /** Hand the meter one call's or one turn's spend. */
  observe: RunUsageObserver;
  /**
   * Whether this workspace may spend right now. Answering `false` TRIPS the
   * gate, so the job that met it pauses rather than reading as a failure — a
   * caller asks this only when it is about to spend.
   */
  spendable(): boolean;
  /** {@link spendable}, as the refusal a call site cannot ignore. */
  check(): void;
}

export interface UsageMeter extends RunMeter {
  /**
   * Name the run this job opened. Rows already written are named too, so a job
   * whose run record arrives after the first call still points at it.
   */
  setRunId(runId: string): void;
  /** Spend from here comes out of this account. */
  chargeTo(account: CreditsAccount): void;
  /** Whether the gate tripped at any point in this run. */
  exhausted(): boolean;
  /** Throws {@link CreditsExhaustedError} if the gate tripped — the job's pause. */
  assertCredits(): void;
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

/**
 * What one (job, subject) row has cost so far and what has been charged for it.
 * Charging works off the CUMULATIVE cost rather than each flush's own, so
 * rounding a flush to whole credits never drifts: the row is always charged
 * `round(total × 100)` in the end, whatever the flushes were.
 */
interface Charged {
  usageId: string;
  costUsd: number;
  credits: number;
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
  const charged = new Map<string, Charged>();
  let runId: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let account: CreditsAccount | null = null;
  let balance = 0;
  let tripped = false;

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

  /**
   * Charge this row up to what it has now cost. The difference between the
   * credits its total is worth and the credits already taken for it is what
   * this flush owes, so a run of sub-cent flushes still pays exactly what the
   * usage row says it spent.
   */
  const chargeRow = async (key: string, usageId: string, costUsd: number): Promise<void> => {
    if (!account) return;
    const held = charged.get(key) ?? { usageId, costUsd: 0, credits: 0 };
    held.usageId = usageId;
    held.costUsd += costUsd;
    const owed = creditsOfUsd(held.costUsd) - held.credits;
    charged.set(key, held);
    if (owed <= 0) return;
    held.credits += owed;
    balance = await account.charge(owed, usageId);
    if (balance <= 0) tripped = true;
  };

  const flushNow = async (): Promise<void> => {
    if (buffer.size === 0) return;
    const taken = [...buffer.entries()];
    buffer.clear();
    for (const [key, pending] of taken) {
      try {
        const usageId = await recordUsage({
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
        // The debit follows the row it charges, so a ledger line and a usage
        // line are the same money. A debit that could not be taken is logged
        // and not retried: double-charging a run is worse than under-charging it.
        try {
          await chargeRow(key, usageId, pending.costUsd);
        } catch (err) {
          log.warn(
            `[credits] could not charge ${subject.jobType} spend to ${subject.workspaceOrgId}: ${(err as Error).message}`,
          );
        }
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

  const spendable = (): boolean => {
    if (!account || balance > 0) return true;
    tripped = true;
    return false;
  };

  const check = (): void => {
    if (spendable()) return;
    throw new CreditsExhaustedError(account!.workspaceOrgId, balance);
  };

  return {
    observe,
    spendable,
    check,
    exhausted: () => tripped,
    chargeTo(next) {
      account = next;
      balance = next.balance;
    },
    assertCredits() {
      if (!tripped || !account) return;
      throw new CreditsExhaustedError(account.workspaceOrgId, balance);
    },
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
 * Run a job body under the gate. An engine whose every call met an empty
 * balance reports that as its own kind of failure — a stage that lost every
 * call, a session that never opened — and it is the balance that is the truth
 * of it, so the gate is asked on BOTH paths and its answer replaces whatever
 * the body said. Used by the two jobs that own no run record; the two that do
 * hand the same gate to `dashboardActivity`, which settles the record with it.
 */
export async function withCredits<T>(meter: UsageMeter, run: () => Promise<T>): Promise<T> {
  try {
    const value = await run();
    meter.assertCredits();
    return value;
  } catch (err) {
    meter.assertCredits();
    throw err;
  }
}

/**
 * The same driver, reporting what its sessions spend and refusing to spend what
 * is not there. Every `assistant-turn` the driver emits carries the turn's four
 * token buckets and its cost, so the wrapper reads the transcript the session
 * writes anyway and reports one spend per turn, under the session's KIND — a
 * pool of thirty flow workers is one subject, not thirty.
 *
 * The gate sits at the two turn boundaries the wrapper can see: before the
 * session opens at all, and after each turn is paid for. A session that meets
 * an empty balance mid-way is interrupted at the end of the turn in flight and
 * parks — unless that turn landed a valid outcome, in which case the work is
 * done and completion wins, exactly as it does against the turn budget.
 */
export function meterDriver(
  driver: SessionDriver,
  meter: RunMeter,
  provider = driver.attribution.provider,
): SessionDriver {
  return {
    capabilities: driver.capabilities,
    // The run says what it RAN ON, which for a credits workspace is TrueCourse
    // and not the provider behind it: the platform's arrangement is the
    // platform's, and the run record is read by the people paying in credits.
    attribution: { ...driver.attribution, provider },
    runSession(input) {
      if (!meter.spendable()) return parkedHandle();
      let inner: SessionHandle | null = null;
      let stopped = false;
      inner = driver.runSession({
        ...input,
        onEvent(event) {
          if (event.type === 'assistant-turn') {
            meter.observe({
              subjectKind: 'session',
              subject: input.def.kind,
              provider,
              model: turnModel(event, driver),
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheCreateTokens: event.usage.cacheCreateTokens,
              costUsd: event.usage.costUsd,
            });
            // The debit lands on a later flush, so the balance the gate reads is
            // the one the last flush left. A turn taken on credit is the
            // overshoot the check-before-debit-after rule allows.
            if (!meter.spendable()) {
              stopped = true;
              void inner?.interrupt();
            }
          }
          input.onEvent(event);
        },
      });
      const handle = inner;
      return {
        status: () => handle.status(),
        steer: (message) => handle.steer(message),
        interrupt: () => handle.interrupt(),
        done: handle.done.then((result) =>
          stopped && result.kind === 'failure'
            ? { kind: 'failure', failure: CREDITS_PAUSE_FAILURE, resumeCursor: result.resumeCursor }
            : result,
        ),
      };
    },
  };
}

/** A session that never opened, already parked: there was nothing to spend. */
function parkedHandle(): SessionHandle {
  const done: DriverResult = { kind: 'failure', failure: CREDITS_PAUSE_FAILURE };
  return {
    done: Promise.resolve(done),
    status: (): SessionStatus => 'parked',
    steer: () => undefined,
    interrupt: async () => undefined,
  };
}

/** What served the turn: what the response said, else what the driver declared. */
function turnModel(
  event: SessionEventBody & { type: 'assistant-turn'; usage: TurnUsage },
  driver: SessionDriver,
): string {
  return event.model || driver.attribution.model;
}
