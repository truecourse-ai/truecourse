/**
 * Test file with quality issues.
 */

declare function describe(name: string, fn: () => void, timeout?: number): void;
declare function it(name: string, fn: (done?: () => void) => void, timeout?: number): void;
declare function expect(val: any): any;
declare function jest: any;

describe('FlakySuite', () => {
  // VIOLATION: code-quality/deterministic/disabled-test-timeout
  it('should have timeout disabled', () => {}, 0);

  // VIOLATION: code-quality/deterministic/flaky-test
  it('should pass randomly', () => {
    const random = Math.random();
    expect(random > 0.5).toBe(true);
  });

  // VIOLATION: code-quality/deterministic/test-code-after-done
  it('should complete first', (done) => {
    done();
    expect(true).toBe(true);
  });

  // VIOLATION: code-quality/deterministic/test-missing-exception-check
  it('should throw error', () => {
    expect(() => { throw new Error('expected'); }).toThrow();
  });
});
