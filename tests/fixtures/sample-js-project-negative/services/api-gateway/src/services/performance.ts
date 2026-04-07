/**
 * Performance-sensitive service code — demonstrates various perf anti-patterns.
 */

import fs from 'fs';
import _ from 'lodash';

// VIOLATION: performance/deterministic/regex-in-loop
export function matchPatterns(items: string[]) {
  const results: boolean[] = [];
  for (const item of items) {
    const pattern = new RegExp('^test');
    results.push(pattern.test(item));
  }
  return results;
}

// VIOLATION: performance/deterministic/json-parse-in-loop
export function parseItems(items: string[]) {
  const results: any[] = [];
  for (const item of items) {
    results.push(JSON.parse(item));
  }
  return results;
}

// VIOLATION: performance/deterministic/spread-in-reduce
export function spreadReduce(items: Array<{ key: string; value: number }>) {
  return items.reduce((acc, item) => ({
    ...acc,
    [item.key]: item.value,
  }), {} as Record<string, number>);
}

// VIOLATION: performance/deterministic/unbounded-array-growth
export function leakyLogs() {
  const logs: string[] = [];
  setInterval(() => {
    logs.push(new Date().toISOString());
  }, 1000);
  return logs;
}

// VIOLATION: performance/deterministic/sync-fs-in-request-handler
export async function readConfigSync(filePath: string) {
  const data = fs.readFileSync(filePath, 'utf8');
  return data;
}

// VIOLATION: performance/deterministic/large-bundle-import
export function chunkArray(arr: number[]) {
  return _.chunk(arr, 2);
}

// VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
export function delayedLog() {
  setTimeout(() => {
    console.log('delayed');
  }, 5000);
}

// VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
export function pollingLoop() {
  setInterval(() => {
    console.log('polling');
  }, 10000);
}

// VIOLATION: performance/deterministic/sync-require-in-handler
export async function handleCsv(req: any, res: any) {
  const csv = require('csv-parser');
  return csv;
}

// VIOLATION: performance/deterministic/synchronous-crypto
export async function hashSync(password: string) {
  const crypto = require('crypto');
  const hash = crypto.pbkdf2Sync(password, 'salt', 100000, 64, 'sha512');
  return hash;
}
