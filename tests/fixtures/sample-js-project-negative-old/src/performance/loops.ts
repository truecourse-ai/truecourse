/**
 * Performance violations related to loops.
 */

import fs from 'fs';

// VIOLATION: performance/deterministic/regex-in-loop
export function regexInLoop(items: string[]) {
  const results: boolean[] = [];
  for (const item of items) {
    const pattern = new RegExp('^test');
    results.push(pattern.test(item));
  }
  return results;
}

// VIOLATION: performance/deterministic/json-parse-in-loop
export function jsonParseInLoop(items: string[]) {
  const results: any[] = [];
  for (const item of items) {
    results.push(JSON.parse(item));
  }
  return results;
}

// VIOLATION: performance/deterministic/spread-in-reduce
export function spreadInReduce(items: Array<{ key: string; value: number }>) {
  return items.reduce((acc, item) => ({
    ...acc,
    [item.key]: item.value,
  }), {} as Record<string, number>);
}

// VIOLATION: performance/deterministic/unbounded-array-growth
export function unboundedArrayGrowth() {
  const logs: string[] = [];
  setInterval(() => {
    logs.push(new Date().toISOString());
  }, 1000);
  return logs;
}

// VIOLATION: performance/deterministic/sync-fs-in-request-handler
export async function syncFsInRequestHandler(filePath: string) {
  const data = fs.readFileSync(filePath, 'utf8');
  return data;
}

// VIOLATION: performance/deterministic/large-bundle-import
import _ from 'lodash';
export function largeBundleImport(arr: number[]) {
  return _.chunk(arr, 2);
}

// VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
export function setTimeoutNoClear() {
  setTimeout(() => {
    console.log('delayed');
  }, 5000);
}

// VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
export function setIntervalNoClear() {
  setInterval(() => {
    console.log('polling');
  }, 10000);
}

// VIOLATION: performance/deterministic/sync-require-in-handler
export async function syncRequireInHandler(req: any, res: any) {
  const csv = require('csv-parser');
  return csv;
}

// VIOLATION: performance/deterministic/synchronous-crypto
export async function synchronousCrypto(password: string) {
  const crypto = require('crypto');
  const hash = crypto.pbkdf2Sync(password, 'salt', 100000, 64, 'sha512');
  return hash;
}
