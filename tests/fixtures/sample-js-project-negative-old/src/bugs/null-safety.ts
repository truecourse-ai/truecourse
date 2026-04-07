/**
 * Bug violations related to null safety and optional chaining.
 */

// VIOLATION: bugs/deterministic/null-dereference
// Accessing property on null literal — always throws TypeError
export function nullDereference() {
  // @ts-ignore
  return null.toString();
}

// VIOLATION: bugs/deterministic/unsafe-optional-chaining
// Optional chaining inside parenthesized function call — can short-circuit to undefined
export function unsafeOptionalChaining(obj: { fn?: () => number } | null) {
  // @ts-ignore
  return (obj?.fn)();
}

// VIOLATION: bugs/deterministic/invisible-whitespace
// String contains a non-breaking space (U+00A0) which is invisible but different from regular space
export const invisibleWs = 'hello world';

// VIOLATION: bugs/deterministic/unexpected-multiline
// Bare return followed by expression on next line — returns undefined due to ASI
export function unexpectedMultiline() {
  return
  42;
}

// VIOLATION: bugs/deterministic/promise-executor-return
// Returning a value from Promise executor — return value is ignored
export function promiseExecutorReturn() {
  return new Promise((resolve) => {
    return 42;
  });
}
