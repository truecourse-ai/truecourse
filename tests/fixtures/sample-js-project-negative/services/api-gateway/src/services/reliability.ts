// VIOLATION: architecture/deterministic/god-module
/**
 * Reliability patterns — error handling, promises, resource management.
 */

import { Request, Response, NextFunction } from 'express';

const app = { get: (...args: any[]) => {}, post: (...args: any[]) => {} };

// VIOLATION: reliability/deterministic/catch-without-error-type
export function catchUntyped() {
  try {
    throw new Error('test');
  } catch (e) {
    console.error(e);
  }
}

// VIOLATION: reliability/deterministic/unsafe-json-parse
export function parseInput(input: string) {
  const data = JSON.parse(input);
  return data;
}

// VIOLATION: reliability/deterministic/empty-reject
export function emptyReject() {
  return Promise.reject();
}

// NOTE: reliability/deterministic/floating-promise — skipped for sync caller of async function
export function callFetch() {
  fetchData();
}
async function fetchData() {
  return { data: 'test' };
}

// VIOLATION: reliability/deterministic/floating-promise
export async function fireAndForget() {
  fetchData();
}

// VIOLATION: reliability/deterministic/floating-promise
// `commit` does NOT match the old ASYNC_PREFIXES heuristic — the previous rule
// missed this. The TypeQueryService check now catches it via the real return type.
async function commit(): Promise<void> {}
export async function commitWithoutAwait() {
  commit();
}

// VIOLATION: reliability/deterministic/promise-all-no-error-handling
export async function fetchAll(urls: string[]) {
  const results = await Promise.all(urls.map((url) => fetch(url)));
  return results;
}

// VIOLATION: reliability/deterministic/missing-error-event-handler
export function createStream() {
  const fsMod = require('fs');
  const stream = fsMod.createReadStream('/tmp/data.txt');
  stream.on('data', (d: any) => console.log(d));
  return stream;
}

// VIOLATION: reliability/deterministic/http-call-no-timeout
export async function fetchExternal(url: string) {
  const response = await fetch(url);
  return response.json();
}

// VIOLATION: reliability/deterministic/process-exit-in-library
export function exitProcess(code: number) {
  process.exit(code);
}

// VIOLATION: reliability/deterministic/unchecked-array-access
export function getElement(arr: number[], index: number) {
  const value = arr[index].toFixed(2);
  return value;
}

// VIOLATION: reliability/deterministic/missing-null-check-after-find
export function findItem(items: Array<{ id: number; name: string }>) {
  return items.find((item) => item.id === 42).name;
}

// VIOLATION: reliability/deterministic/missing-finally-cleanup
export function queryWithoutCleanup() {
  const db = { createConnection: () => ({ query: () => 'data' }), close: () => {} };
  try {
    const conn = db.createConnection();
    return conn.query();
  } catch (e) {
    throw e;
  }
}

// VIOLATION: reliability/deterministic/catch-rethrow-no-context
export async function rethrowWithoutContext() {
  try {
    await fetch('/api/data');
  } catch (error) {
    throw error;
  }
}

// VIOLATION: reliability/deterministic/console-error-no-context
export function logError() {
  try {
    JSON.parse('invalid');
  } catch (error) {
    console.error(error);
  }
}

// VIOLATION: reliability/deterministic/unchecked-optional-chain-depth
export function deepChain(data: any) {
  return data?.config?.database?.connection?.host?.value;
}

// VIOLATION: reliability/deterministic/express-async-no-wrapper
app.get('/api/data/:id', async (req: Request, res: Response) => {
  const data = await fetchData();
  res.json(data);
});

// VIOLATION: reliability/deterministic/missing-next-on-error
export function missingNext(req: Request, res: Response, next: NextFunction) {
  try {
    const data = JSON.parse(req.body);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
