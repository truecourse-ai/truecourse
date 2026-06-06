import { describe, expect, it } from 'vitest';
import {
  representativeExtractionFailures,
  scanSuccessOutro,
  totalExtractionFailure,
} from '../../tools/cli/src/commands/spec';

describe('spec scan extraction failures', () => {
  it('treats all-block extraction failure as fatal', () => {
    expect(totalExtractionFailure({
      blocksAttempted: 2,
      claims: [],
      failures: [
        { block: { filePath: 'docs/a.md', headingPath: ['A'] }, error: 'claude exited 1: login expired' },
        { block: { filePath: 'docs/b.md', headingPath: ['B'] }, error: 'claude exited 1: login expired' },
      ],
    })).toBe(true);
  });

  it('does not treat partial extraction failure as fatal', () => {
    expect(totalExtractionFailure({
      blocksAttempted: 2,
      claims: [{ subject: 'GET /health' }],
      failures: [
        { block: { filePath: 'docs/a.md', headingPath: ['A'] }, error: 'timeout' },
      ],
    })).toBe(false);
  });

  it('does not suggest contract generation when no claims were extracted', () => {
    expect(scanSuccessOutro(0, 0)).toBe('No claims extracted.');
    expect(scanSuccessOutro(1, 0)).toBe('No open conflicts — run `truecourse contracts generate`.');
    expect(scanSuccessOutro(1, 2)).toBe('2 open.');
  });

  it('formats representative extraction failures with location and error', () => {
    expect(representativeExtractionFailures([
      { block: { filePath: 'docs/a.md', headingPath: ['API', 'Auth'] }, error: 'claude exited 1: login expired' },
    ])).toEqual([
      'docs/a.md :: API → Auth\n    → claude exited 1: login expired',
    ]);
  });
});
