/**
 * Test file — demonstrates test-related code quality violations.
 */

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(val: any): any;
declare function beforeEach(fn: () => void): void;
declare const assert: any;

let globalConfig = { retries: 3 };

// VIOLATION: code-quality/deterministic/test-exclusive
describe.only('NotificationProcessor', () => {
    beforeEach(() => {
    // VIOLATION: code-quality/deterministic/test-modifying-global-state
    globalConfig = { retries: 5 };
  });

  // VIOLATION: code-quality/deterministic/test-missing-assertion
  it('should process notifications', () => {
    const processor = { process: () => true };
    processor.process();
  });

  // VIOLATION: code-quality/deterministic/test-inverted-arguments
  it('should return correct count', () => {
    const result = 42;
    assert.strictEqual(42, result);
  });

  // VIOLATION: code-quality/deterministic/test-same-argument
  it('should not match itself', () => {
    const value = 'test';
    assert.deepEqual(value, value);
  });

  // VIOLATION: code-quality/deterministic/test-deterministic-assertion
  it('should generate unique id', () => {
    const id = Math.random().toString(36);
    expect(id).to.satisfy((v: string) => v.length > 0);
  });

  // VIOLATION: code-quality/deterministic/test-with-hardcoded-timeout
  it('should complete within timeout', () => {
    setTimeout(() => {
      expect(true).toBe(true);
    }, 5000);
  });

  // VIOLATION: code-quality/deterministic/test-incomplete-assertion
  it('should validate data', () => {
    const data = { name: 'test' };
    expect(data).toBeTruthy;
  });
});

// VIOLATION: code-quality/deterministic/test-skipped
describe.skip('SkippedTests', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
