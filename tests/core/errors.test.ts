/** Exception summaries keep useful reasons without exposing database parameters. */
import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { createAppError, summarizeError } from '../../packages/core/src/lib/errors';

describe('summarizeError', () => {
  it('summarizes wrapped driver errors without SQL, parameters or driver context', () => {
    const cause = Object.assign(new Error('unsupported Unicode escape sequence'), {
      code: '22P05', severity: 'ERROR', detail: 'secret detail', where: 'secret PDF output',
    });
    const error = new DrizzleQueryError('insert into guard_results values ($1)', ['secret PDF output'], cause);
    expect(summarizeError(error)).toBe('Database error (22P05): unsupported Unicode escape sequence');
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('secret PDF output');
  });

  it('handles a driver error without a wrapper', () => {
    const error = Object.assign(new Error('connection limit exceeded'), { code: '53300', severity: 'FATAL' });
    expect(summarizeError(error)).toBe('Database error (53300): connection limit exceeded');
  });

  it('omits a query wrapper with no recognizable driver cause', () => {
    expect(summarizeError(new DrizzleQueryError('secret SQL', ['secret'], new Error('secret context')))).toBe('Database query failed.');
  });

  it('retains ordinary application messages instead of following an unrelated cause', () => {
    const error = new Error('Cannot resume: saved results are missing.', { cause: new Error('internal detail') });
    expect(summarizeError(error)).toBe(error.message);
    expect(summarizeError(createAppError('Credits exhausted.', 402))).toBe('Credits exhausted.');
    expect(summarizeError(Object.assign(new Error('provider error'), { code: 'ABCDE' }))).toBe('provider error');
  });

  it('bounds long messages including the truncation marker', () => {
    const error = new Error('x'.repeat(3_000));
    expect(summarizeError(error)).toHaveLength(2_000);
    expect(summarizeError(error)).toBe('x'.repeat(1_997) + '...');
    expect(summarizeError(Object.assign(error, { code: '22P05', severity: 'ERROR' }))).toHaveLength(2_000);
  });

  it('handles cycles and non-Error throws', () => {
    const error = new Error('ordinary error');
    Object.assign(error, { cause: error });
    expect(summarizeError(error)).toBe('ordinary error');
    expect(summarizeError('string reason')).toBe('string reason');
    expect(summarizeError(null)).toBe('null');
  });
});
