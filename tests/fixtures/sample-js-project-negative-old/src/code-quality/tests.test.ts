/**
 * Test-related code quality violations.
 * File must have .test. in path for test-specific rules.
 */

// VIOLATION: code-quality/deterministic/test-exclusive
describe.only('exclusive suite', () => {
  it('should run', () => {
    expect(true).toBe(true);
  });
});

// VIOLATION: code-quality/deterministic/test-skipped
it.skip('skipped test', () => {
  expect(1).toBe(1);
});

// VIOLATION: code-quality/deterministic/test-missing-assertion
it('test without assertion', () => {
  const x = 1 + 2;
  console.log(x);
});

// VIOLATION: code-quality/deterministic/test-missing-exception-check
it('test missing exception check', () => {
  expect(() => {
    throw new Error('boom');
  }).toThrow();
});

// VIOLATION: code-quality/deterministic/test-incomplete-assertion
it('test incomplete assertion', () => {
  expect(42).toBe;
});

// VIOLATION: code-quality/deterministic/test-inverted-arguments
it('test inverted arguments', () => {
  const result = computeValue();
  assert.equal(42, result);
});

// VIOLATION: code-quality/deterministic/test-same-argument
it('test same argument', () => {
  const value = getValue();
  assert.equal(value, value);
});

// VIOLATION: code-quality/deterministic/test-code-after-done
it('test code after done', (done) => {
  done();
  console.log('this runs after done');
});

// VIOLATION: code-quality/deterministic/test-deterministic-assertion
it('test non-deterministic assertion', () => {
  const items = [1, 2, 3, 4, 5];
  expect(items[0]).to.satisfy((n: number) => n > 0);
});

// VIOLATION: code-quality/deterministic/flaky-test
it('flaky test with Math.random', () => {
  const val = Math.random();
  expect(val).toBeDefined();
});

// VIOLATION: code-quality/deterministic/disabled-test-timeout
it('test with disabled timeout', () => {
  expect(1).toBe(1);
}, 0);

// VIOLATION: code-quality/deterministic/test-with-hardcoded-timeout
it('test with hardcoded timeout', async () => {
  await setTimeout(() => {}, 2000);
  expect(true).toBe(true);
});

// Helper stubs to avoid TS errors
declare function computeValue(): number;
declare function getValue(): number;
declare function fetchData(cb: () => void): void;
declare const assert: { equal(a: any, b: any): void };
declare function describe(name: string, fn: () => void): void;
declare namespace describe {
  function only(name: string, fn: () => void): void;
}
declare function it(name: string, fn: ((done: (err?: any) => void) => void) | (() => void), timeout?: number): void;
declare namespace it {
  function skip(name: string, fn: () => void): void;
}
declare function expect(val: any): any;
