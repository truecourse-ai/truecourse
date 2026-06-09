import { describe, it, expect } from 'vitest';
import {
  decideScanOutcome,
  summarizeExtractionFailures,
  type ExtractionFailureReport,
} from '../../tools/cli/src/commands/spec';
import { describeClaudePreflightFailure } from '../../tools/cli/src/lib/claude-preflight';

/**
 * Policy for how `truecourse spec scan` ends (issue #474): a total extraction
 * wipeout must exit non-zero instead of reporting success, and the
 * `contracts generate` CTA must not appear when there's nothing to generate.
 * `decideScanOutcome` is pure, so the rules are pinned here directly without
 * mocking clack / process.exit / the pipeline.
 */
function report(over: Partial<ExtractionFailureReport> = {}): ExtractionFailureReport {
  return { total: 0, allFailed: false, samples: [], ...over };
}

describe('decideScanOutcome', () => {
  it('exits 1 and aborts when every block failed', () => {
    const outcome = decideScanOutcome({
      blocksAttempted: 152,
      claims: 0,
      openConflicts: 0,
      failures: report({ total: 152, allFailed: true }),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.outro).toBe('Aborted — all 152 blocks failed, no claims extracted.');
    expect(outcome.outro).not.toContain('contracts generate');
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
});

/**
 * `summarizeExtractionFailures` collapses duplicate per-block errors into
 * counted samples and flags a total wipeout. It feeds `decideScanOutcome`, so
 * it lives in the CLI scan layer alongside it (not the shared extractor).
 */
describe('summarizeExtractionFailures', () => {
  const fail = (error: string, n = 1) => Array.from({ length: n }, () => ({ error }));

  it('reports nothing when there are no failures', () => {
    const r = summarizeExtractionFailures({ failures: [], blocksAttempted: 10 });
    expect(r).toEqual({ total: 0, allFailed: false, samples: [] });
  });

  it('flags allFailed only when every attempted block failed', () => {
    expect(
      summarizeExtractionFailures({ failures: fail('boom', 10), blocksAttempted: 10 }).allFailed,
    ).toBe(true);
    expect(
      summarizeExtractionFailures({ failures: fail('boom', 4), blocksAttempted: 10 }).allFailed,
    ).toBe(false);
  });

  it('never flags allFailed when no blocks were attempted', () => {
    const r = summarizeExtractionFailures({ failures: [], blocksAttempted: 0 });
    expect(r.allFailed).toBe(false);
  });

  it('collapses duplicate messages into samples with counts, most frequent first', () => {
    const r = summarizeExtractionFailures({
      failures: [...fail('A', 5), ...fail('B', 2), ...fail('C', 1)],
      blocksAttempted: 8,
    });
    expect(r.total).toBe(8);
    expect(r.samples).toEqual([
      { message: 'A', count: 5 },
      { message: 'B', count: 2 },
      { message: 'C', count: 1 },
    ]);
  });

  it('caps samples at the limit (default 3, overridable)', () => {
    const failures = [
      ...fail('A', 4),
      ...fail('B', 3),
      ...fail('C', 2),
      ...fail('D', 1),
    ];
    expect(summarizeExtractionFailures({ failures, blocksAttempted: 10 }).samples).toHaveLength(3);
    expect(
      summarizeExtractionFailures({ failures, blocksAttempted: 10 }, { sampleLimit: 2 }).samples,
    ).toHaveLength(2);
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
