// VIOLATION: architecture/deterministic/god-module
/**
 * Error handling patterns — contains various error/catch bug patterns.
 */

// NOTE: empty-catch now skipped for JSON.parse try/catch pattern
export function silentParseError() {
  try {
    JSON.parse('invalid');
  } catch (e) {
  }
}

// VIOLATION: bugs/deterministic/empty-catch
export function silentFail() {
  try { throw new Error('fail'); } catch (e) {}
}

// VIOLATION: bugs/deterministic/unsafe-finally
export function unsafeFinally() {
  try {
    return 1;
  } catch (e) {
    return 2;
  } finally {
    return 3;
  }
}

// VIOLATION: bugs/deterministic/exception-reassignment
export function replaceError() {
  try {
    throw new Error('original');
  } catch (err) {
    err = new Error('replaced');
    throw err;
  }
}

// VIOLATION: bugs/deterministic/lost-error-context
export function lostContext() {
  try {
    throw new Error('original');
  } catch (e) {
    throw new Error('something went wrong');
  }
}

// VIOLATION: bugs/deterministic/nested-try-catch
export function nestedTryCatch() {
  try {
    JSON.parse('{}');
  } catch (outer) {
    try {
      JSON.parse('fallback');
    } catch (inner) {
      const x = 1;
    }
  }
}

// VIOLATION: bugs/deterministic/error-type-any
export function anyErrorType() {
  try {
    throw new Error('test');
  } catch (e: any) {
    console.error(e.message);
  }
}

// VIOLATION: bugs/deterministic/null-dereference
export function nullDeref() {
  // @ts-ignore
  return null.toString();
}

// VIOLATION: bugs/deterministic/unsafe-optional-chaining
export function unsafeChain(obj: { fn?: () => number } | null) {
  // @ts-ignore
  return (obj?.fn)();
}

// NOTE: unexpected-multiline — tree-sitter may not separate return\n42 as two statements
export function asileftReturn() {
  return
  42;
}

// VIOLATION: bugs/deterministic/promise-executor-return
export function executorReturn() {
  return new Promise((resolve) => {
    return 42;
  });
}

// VIOLATION: bugs/deterministic/async-promise-executor
export function asyncExecutor() {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await fetch('/api');
      resolve(data);
    } catch (e) {
      reject(e);
    }
  });
}

// VIOLATION: bugs/deterministic/no-promise-executor-return
export function executorResolveReturn() {
  return new Promise((resolve) => {
    return resolve(42);
  });
}

// VIOLATION: bugs/deterministic/promise-reject-non-error
export function rejectString() {
  return Promise.reject('something went wrong');
}

// VIOLATION: bugs/deterministic/try-promise-catch
export function syncCatchAsync() {
  try {
    fetch('/api').then((res) => res.json());
  } catch (e) {
    const x = 1;
  }
}

// VIOLATION: bugs/deterministic/missing-return-await
export async function missingAwait() {
  try {
    return fetch('/api/data');
  } catch (e) {
    console.error(e);
    return null;
  }
}
