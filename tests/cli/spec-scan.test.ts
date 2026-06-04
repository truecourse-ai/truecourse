import { describe, it, expect } from 'vitest';
import { decideScanOutcome } from '../../tools/cli/src/commands/spec';
import { describeClaudePreflightFailure } from '../../tools/cli/src/lib/claude-preflight';
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
 * The up-front `claude` CLI preflight (before "Discovering docs"). For a missing
 * binary it points at installation; for a failed call it surfaces claude's own
 * output verbatim rather than guessing the cause. Pure mapping, pinned here
 * without spawning or driving clack.
 */
describe('describeClaudePreflightFailure', () => {
  it('points at installation when the binary is missing', () => {
    const m = describeClaudePreflightFailure({ ok: false, reason: 'not-found' });
    expect(m.title).toContain('PATH');
    expect(m.hint).toContain('CLAUDE_CODE_BIN');
  });

  it("shows claude's raw output verbatim, with the exit code, for a failed call", () => {
    const m = describeClaudePreflightFailure({
      ok: false,
      reason: 'failed',
      code: 1,
      output: 'Invalid API key · Please run /login',
    });
    expect(m.title).toContain('exit 1');
    // Verbatim — not collapsed, not reworded, not classified.
    expect(m.hint).toBe('Invalid API key · Please run /login');
  });

  it('preserves a multi-line raw answer without rewording it', () => {
    const raw = 'line one\nline two\nline three';
    const m = describeClaudePreflightFailure({ ok: false, reason: 'failed', code: 2, output: raw });
    expect(m.hint).toBe(raw);
  });

  it('falls back to a placeholder when the failed call produced no output', () => {
    const m = describeClaudePreflightFailure({ ok: false, reason: 'failed', code: null, output: '' });
    expect(m.title).toContain('exit null');
    expect(m.hint).toBe('(no output)');
  });
});
