/**
 * Test state modification violation.
 * File must have .test. in path for test-specific rules.
 */

// VIOLATION: code-quality/deterministic/test-modifying-global-state
// (needsDataFlow — test assigns to module-level variable)
let sharedCounter = 0;

it('test modifying global state', () => {
  sharedCounter = sharedCounter + 1;
  expect(sharedCounter).toBe(1);
});

declare function it(name: string, fn: () => void): void;
declare function expect(val: any): any;
