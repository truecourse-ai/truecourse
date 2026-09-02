/**
 * THE SHARED SESSION CONTEXT of one `guard setup` run — the lazy holder every
 * setup session seam (recipe repair, dependency catalog; later seed and auth)
 * draws its driver and its sessions-store run from.
 *
 * LAZY on purpose, twice over:
 *  - the RUN RECORD is only created when a session is actually about to run.
 *    Setup's happy path spends zero sessions (the deterministic proposers and
 *    the skip-when-settled spine answer everything), and a run directory with
 *    an empty index for every bare re-run would be noise the boot sweep then
 *    has to reconcile;
 *  - the DRIVER is only built then too. In api mode construction reads (and
 *    can refuse) the provider config, and a fully-cached or fully-settled run
 *    must not pay — or fail — for a backend it never calls.
 *
 * A HOSTED run inverts both: it injects its own driver (built from the asking
 * workspace's provider config, never a process-wide one), keys the record by
 * repo identity rather than by the ephemeral clone it runs in, and opens it
 * EAGERLY — a run nobody can see is a run nobody can watch fail.
 *
 * ONE run record covers every session of the setup invocation, whatever seam
 * ran it — the sessions-store convention is one run per COMMAND invocation
 * (`sessions/guard-setup/<runId>/`), with each session's own transcript and
 * index row inside it.
 */

import path from 'node:path';
import type {
  RunError,
  SessionDriver,
  SessionFailure,
  SessionPersistence,
} from '@truecourse/agent-loop';
import { createSessionRun, type SessionRunStartedInfo, type SessionRunStore } from '../../lib/sessions-store.js';
import { resolveCommitSha } from '../../lib/repo-ref.js';
import { createConfiguredSessionDriver } from '../llm/session-driver.js';
import type { LlmTransportFlag, LlmTransportMode } from '../../config/global-config.js';
import type { StepTracker } from '../../progress.js';

export interface AcquiredSessionContext {
  runId: string;
  driver: SessionDriver;
  persistence: SessionPersistence;
}

export interface GuardSetupSessionContext {
  /** The run + driver, created on first use. Throws when the backend cannot be
   *  built (api mode without a usable provider config) — callers surface that
   *  as the seam's failure reason, never as a crashed setup. */
  acquire(): Promise<AcquiredSessionContext>;
  /** The run id, once a session has run under this context; else undefined. */
  runId(): string | undefined;
  /** Outcome accounting for the closing status — call once per session run. */
  note(status: 'completed' | 'failed'): void;
  /**
   * Fold one (or a pool of) session's spend into the run's usage totals — the
   * loop's own units (`BudgetSpent`), which have no input/output token split.
   * The adapter reads {@link usageTotals} into the report's `usage.sessions`
   * block. Cache hits spend zero and may simply not call this.
   */
  addSpend(sessions: number, spent: { turns: number; tokens: number; costUsd: number }): void;
  /** The accumulated session spend of this run; `null` when nothing ran. */
  usageTotals(): { count: number; turns: number; tokens: number; costUsd: number } | null;
  /**
   * Close the run record, when one was created. The status convention every
   * command adapter follows: `failed` only when EVERY session failed,
   * `interrupted` on abort, `completed` otherwise. An explicit `failure`
   * overrides that rule — the run itself did not hold, whatever its sessions
   * did — and lands in the record so a surface that never saw the process
   * still reads why.
   */
  finish(aborted: boolean, failure?: RunError): void;
}

/** One session failure as a reason a setup report row can carry. */
export function describeSessionFailure(failure: SessionFailure): string {
  switch (failure.kind) {
    case 'budget-exhausted':
      return `the session ran out of turns without reaching ${failure.notReached}`;
    case 'context-exhausted':
      return 'the session hit its context ceiling';
    case 'malformed':
      return `the session ended malformed: ${failure.detail}`;
    case 'transport':
      return `the provider failed (${failure.class}): ${failure.detail}`;
    case 'session-lost':
      return `the provider session ${failure.providerSessionId} is gone`;
  }
}

/** What every setup run states, whoever drives it. */
interface SessionContextBase {
  /** The WORKING TREE the sessions run in — cwd and provider state, always. */
  repoRoot: string;
  /**
   * Where the run record and transcripts are keyed. Defaults to `repoRoot`; a
   * hosted run passes the repo IDENTITY, because the tree it runs in is an
   * ephemeral clone deleted the moment the run settles.
   */
  sessionsKey?: string;
  /** A per-run `--llm-transport` flag; the saved selection answers otherwise.
   *  Ignored when a driver is injected — that caller already chose. */
  transport?: LlmTransportFlag;
  /**
   * Mirror the command's step checklist into the run record. The CLI renders
   * the tracker locally; a surface watching from elsewhere can only see what
   * run.json carries, and setup's steps are minutes of work each.
   */
  tracker?: StepTracker;
  /**
   * Create the run record at construction instead of on the first session. A
   * hosted run must be watchable from the moment it starts — including one
   * that dies before any session exists, or spends none at all.
   */
  eager?: boolean;
  /** The run record just came into being — on construction when `eager`, else
   *  on first acquire; never on a lazy run that spends no sessions. */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
}

/** The sessions run on the caller's own driver — and say so in the record. */
interface InjectedDriverOptions extends SessionContextBase {
  driver: SessionDriver;
  /** The mode that driver runs in; the record's attribution needs it and the
   *  driver itself does not carry one. */
  transportMode: LlmTransportMode;
}

/** The sessions run on the configured driver, built lazily from global config. */
interface ConfiguredDriverOptions extends SessionContextBase {
  driver?: undefined;
  transportMode?: undefined;
}

export type GuardSetupSessionContextOptions = InjectedDriverOptions | ConfiguredDriverOptions;

export function createGuardSetupSessionContext(
  opts: GuardSetupSessionContextOptions,
): GuardSetupSessionContext {
  let acquired: Promise<{ run: SessionRunStore; driver: SessionDriver }> | null = null;
  let run: SessionRunStore | null = null;
  let untap: (() => void) | null = null;
  let completed = 0;
  let failed = 0;
  const totals = { count: 0, turns: 0, tokens: 0, costUsd: 0 };

  const build = async (): Promise<{ run: SessionRunStore; driver: SessionDriver }> => {
    const gitRef = await resolveCommitSha(opts.repoRoot);
    const store = createSessionRun(opts.sessionsKey ?? opts.repoRoot, {
      command: 'guard-setup',
      gitRef,
    });
    const { driver, mode, attribution } = opts.driver
      ? { driver: opts.driver, mode: opts.transportMode, attribution: opts.driver.attribution }
      : createConfiguredSessionDriver({
          ...(opts.transport ? { transport: opts.transport } : {}),
          cwd: opts.repoRoot,
          providerStateDir: path.join(store.dir, 'provider'),
        });
    store.setLlm({
      mode,
      provider: attribution.provider,
      model: attribution.model,
      ...(attribution.fallbackModel ? { fallbackModel: attribution.fallbackModel } : {}),
    });
    run = store;
    untap =
      opts.tracker?.tap((progress) => {
        if (progress.steps) store.setChecklist(progress.steps);
      }) ?? null;
    opts.onRunStarted?.({ command: 'guard-setup', runId: store.runId, dir: store.dir });
    return { run: store, driver };
  };

  // A failed build is retried on the next acquire rather than memoized: the
  // first seam's config error must not poison a later one after a fix.
  const start = (): Promise<{ run: SessionRunStore; driver: SessionDriver }> =>
    (acquired ??= build().catch((e) => ((acquired = null), Promise.reject(e))));

  const close = (aborted: boolean, failure?: RunError): void => {
    if (!run) return;
    untap?.();
    untap = null;
    if (aborted) run.finish('interrupted');
    else if (failure) run.finish('failed', { error: failure });
    else run.finish(failed > 0 && completed === 0 ? 'failed' : 'completed');
    run = null;
  };

  // Eager: the record exists before the first step does. Its rejection is
  // swallowed here and re-raised at the acquire that actually needs a driver.
  if (opts.eager) void start().catch(() => {});

  return {
    async acquire() {
      const { run: store, driver } = await start();
      return { runId: store.runId, driver, persistence: store.persistence };
    },
    runId: () => run?.runId,
    note(status) {
      if (status === 'completed') completed++;
      else failed++;
    },
    addSpend(sessions, spent) {
      totals.count += sessions;
      totals.turns += spent.turns;
      totals.tokens += spent.tokens;
      totals.costUsd += spent.costUsd;
    },
    usageTotals: () => (totals.count > 0 ? { ...totals } : null),
    finish(aborted, failure) {
      if (run) return close(aborted, failure);
      // The record can still be coming into being (an eager run that ended
      // before its own creation settled) — close it the moment it exists. A
      // build that failed leaves nothing to close.
      const pending = acquired;
      if (pending) void pending.then(() => close(aborted, failure)).catch(() => {});
    },
  };
}
