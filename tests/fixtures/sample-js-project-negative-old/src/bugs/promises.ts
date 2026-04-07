/**
 * Bug violations related to promise patterns.
 */

// VIOLATION: bugs/deterministic/async-promise-executor
export function asyncPromiseExecutor() {
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
export function promiseExecutorReturn() {
  return new Promise((resolve) => {
    return resolve(42);
  });
}

// VIOLATION: bugs/deterministic/promise-reject-non-error
export function promiseRejectNonError() {
  return Promise.reject('something went wrong');
}

// VIOLATION: bugs/deterministic/try-promise-catch
export function tryPromiseCatch() {
  try {
    fetch('/api').then((res) => res.json());
  } catch (e) {
    const x = 1;
  }
}

// VIOLATION: bugs/deterministic/missing-return-await
export async function missingReturnAwait() {
  try {
    return fetch('/api/data');
  } catch (e) {
    console.error(e);
    return null;
  }
}
