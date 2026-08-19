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
 * ONE run record covers every session of the setup invocation, whatever seam
 * ran it — the sessions-store convention is one run per COMMAND invocation
 * (`sessions/guard-setup/<runId>/`), with each session's own transcript and
 * index row inside it.
 */

import path from 'node:path';
import type { SessionDriver, SessionFailure, SessionPersistence } from '@truecourse/agent-loop';
import { createSessionRun, type SessionRunStore } from '../../lib/sessions-store.js';
import { resolveCommitSha } from '../../lib/repo-ref.js';
import { createConfiguredSessionDriver } from '../llm/session-driver.js';
import type { LlmTransportFlag } from '../../config/global-config.js';

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
   * `interrupted` on abort, `completed` otherwise.
   */
  finish(aborted: boolean): void;
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

export function createGuardSetupSessionContext(opts: {
  repoRoot: string;
  transport?: LlmTransportFlag;
}): GuardSetupSessionContext {
  let acquired: Promise<{ run: SessionRunStore; driver: SessionDriver }> | null = null;
  let run: SessionRunStore | null = null;
  let completed = 0;
  let failed = 0;
  const totals = { count: 0, turns: 0, tokens: 0, costUsd: 0 };

  const build = async (): Promise<{ run: SessionRunStore; driver: SessionDriver }> => {
    const gitRef = await resolveCommitSha(opts.repoRoot);
    const store = createSessionRun(opts.repoRoot, { command: 'guard-setup', gitRef });
    const { driver, mode, attribution } = createConfiguredSessionDriver({
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
    return { run: store, driver };
  };

  return {
    async acquire() {
      // A failed build is retried on the next acquire rather than memoized: the
      // first seam's config error must not poison a later one after a fix.
      if (!acquired) acquired = build().catch((e) => ((acquired = null), Promise.reject(e)));
      const { run: store, driver } = await acquired;
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
    finish(aborted) {
      if (!run) return;
      run.finish(aborted ? 'interrupted' : failed > 0 && completed === 0 ? 'failed' : 'completed');
      run = null;
    },
  };
}
