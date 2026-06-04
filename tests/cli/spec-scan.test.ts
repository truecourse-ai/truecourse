import { describe, it, expect } from 'vitest';
import { decideScanOutcome, describeClaudePreflightFailure } from '../../tools/cli/src/commands/spec';
import type { ExtractionFailureReport } from '@truecourse/spec-consolidator';

/**
 * Policy for how `truecourse spec scan` ends (issue #474): a total extraction
 * wipeout must exit non-zero instead of reporting success, and the
 * `contracts generate` CTA must not appear when there's nothing to generate.
 * `decideScanOutcome` is pure, so the rules are pinned here directly without
 * mocking clack / process.exit / the pipeline.
 */
function report(over: Partial<ExtractionFailureReport> = {}): ExtractionFailureReport {
  return { total: 0, allFailed: false, likelyAuth: false, samples: [], ...over };
}

describe('decideScanOutcome', () => {
  it('exits 1 and aborts when every block failed', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 152,
      claims: 0,
      openConflicts: 0,
      failures: report({ total: 152, allFailed: true, likelyAuth: true }),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.outro).toBe('Aborted — all 152 blocks failed, no claims extracted.');
    expect(outcome.showAuthHint).toBe(true);
    expect(outcome.outro).not.toContain('contracts generate');
  });

  it('surfaces the auth hint on a total wipeout only when it looks like auth', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 10,
      claims: 0,
      openConflicts: 0,
      failures: report({ total: 10, allFailed: true, likelyAuth: false }),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.showAuthHint).toBe(false);
  });

  it('does not suggest contracts generate when zero claims were extracted', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 3,
      claims: 0,
      openConflicts: 0,
      failures: report(),
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.outro).toBe('No claims extracted — nothing to generate yet.');
    expect(outcome.outro).not.toContain('contracts generate');
  });

  it('suggests contracts generate on a clean scan with claims and no conflicts', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 10,
      claims: 9,
      openConflicts: 0,
      failures: report({ total: 1 }), // a straggler failure, not a wipeout
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.outro).toBe('No open conflicts — run `truecourse contracts generate`.');
  });

  it('reports the open-conflict count when conflicts remain', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 10,
      claims: 9,
      openConflicts: 4,
      failures: report(),
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.outro).toBe('4 open.');
  });

  it('propagates the auth hint on a partial (non-fatal) failure', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 10,
      claims: 5,
      openConflicts: 0,
      failures: report({ total: 5, likelyAuth: true }),
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.showAuthHint).toBe(true);
  });
});

/**
 * The up-front `claude` CLI preflight (before "Discovering docs") maps each
 * failure reason to an actionable headline + next step. Pure mapping, pinned
 * here without spawning or driving clack.
 */
describe('describeClaudePreflightFailure', () => {
  it('points at installation when the binary is missing', () => {
    const m = describeClaudePreflightFailure({ ok: false, reason: 'not-found' });
    expect(m.title).toContain('PATH');
    expect(m.hint).toContain('CLAUDE_CODE_BIN');
  });

  it('points at re-login when unauthenticated', () => {
    const m = describeClaudePreflightFailure({ ok: false, reason: 'unauthenticated' });
    expect(m.title.toLowerCase()).toContain('logged in');
    expect(m.hint).toContain('/login');
  });

  it('surfaces the detail for a generic error', () => {
    const m = describeClaudePreflightFailure({
      ok: false,
      reason: 'error',
      detail: 'error: unknown flag --frobnicate',
    });
    expect(m.hint).toContain('unknown flag --frobnicate');
  });

  it('handles a generic error with no detail', () => {
    const m = describeClaudePreflightFailure({ ok: false, reason: 'error' });
    expect(m.title).toContain('failed a test call');
    expect(m.hint).toContain('retry');
  });
});
