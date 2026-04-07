/**
 * Test file — demonstrates test-related code quality violations.
 */

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(val: any): any;
declare function beforeEach(fn: () => void): void;

// VIOLATION: code-quality/deterministic/test-exclusive
describe.only('NotificationProcessor', () => {
  // VIOLATION: code-quality/deterministic/test-modifying-global-state
  let globalConfig = { retries: 3 };

  beforeEach(() => {
    globalConfig.retries = 5;
  });

  // VIOLATION: code-quality/deterministic/test-missing-assertion
  it('should process notifications', () => {
    const processor = { process: () => true };
    processor.process();
  });

  // VIOLATION: code-quality/deterministic/test-inverted-arguments
  it('should return correct count', () => {
    const result = 42;
    expect(42).toEqual(result);
  });

  // VIOLATION: code-quality/deterministic/test-same-argument
  it('should not match itself', () => {
    const value = 'test';
    expect(value).toEqual(value);
  });

  // VIOLATION: code-quality/deterministic/test-deterministic-assertion
  it('should generate unique id', () => {
    const id = Math.random().toString(36);
    expect(id).toBeTruthy();
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
    expect(data);
  });
});

// VIOLATION: code-quality/deterministic/test-skipped
describe.skip('SkippedTests', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
