/**
 * Reliability violations related to error handling.
 */

// VIOLATION: reliability/deterministic/catch-without-error-type
export function catchWithoutErrorType() {
  try {
    throw new Error('test');
  } catch (e) {
    console.error(e);
  }
}

// VIOLATION: reliability/deterministic/unsafe-json-parse
export function unsafeJsonParse(input: string) {
  const data = JSON.parse(input);
  return data;
}

// VIOLATION: reliability/deterministic/empty-reject
export function emptyReject() {
  return Promise.reject();
}

// VIOLATION: reliability/deterministic/floating-promise
export function floatingPromise() {
  fetchData();
}

async function fetchData() {
  return { data: 'test' };
}

// VIOLATION: reliability/deterministic/promise-all-no-error-handling
export async function promiseAllNoErrorHandling(urls: string[]) {
  const results = await Promise.all(urls.map((url) => fetch(url)));
  return results;
}

// VIOLATION: reliability/deterministic/missing-error-event-handler
export function missingErrorEventHandler() {
  const fs = require('fs');
  const stream = fs.createReadStream('/tmp/data.txt');
  stream.on('data', (d: any) => console.log(d));
  return stream;
}

// VIOLATION: reliability/deterministic/http-call-no-timeout
export async function httpCallNoTimeout(url: string) {
  const response = await fetch(url);
  return response.json();
}

// VIOLATION: reliability/deterministic/process-exit-in-library
export function processExitInLibrary(code: number) {
  process.exit(code);
}

// VIOLATION: reliability/deterministic/unchecked-array-access
export function uncheckedArrayAccess(arr: number[], index: number) {
  const value = arr[index].toFixed(2);
  return value;
}

// VIOLATION: reliability/deterministic/missing-null-check-after-find
export function missingNullCheckAfterFind(items: Array<{ id: number; name: string }>) {
  return items.find((item) => item.id === 42).name;
}

// VIOLATION: reliability/deterministic/missing-finally-cleanup
export function missingFinallyCleanup() {
  const db = { createConnection: () => ({ query: () => 'data' }), close: () => {} };
  try {
    const conn = db.createConnection();
    return conn.query();
  } catch (e) {
    throw e;
  }
}

// VIOLATION: reliability/deterministic/catch-rethrow-no-context
export async function catchRethrowNoContext() {
  try {
    await fetch('/api/data');
  } catch (error) {
    throw error;
  }
}

// VIOLATION: reliability/deterministic/console-error-no-context
export function consoleErrorNoContext() {
  try {
    JSON.parse('invalid');
  } catch (error) {
    console.error(error);
  }
}

// VIOLATION: reliability/deterministic/unchecked-optional-chain-depth
export function uncheckedOptionalChainDepth(data: any) {
  return data?.config?.database?.connection?.host?.value;
}
