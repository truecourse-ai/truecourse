/**
 * Bug violations related to async patterns.
 */
import * as fs from 'fs';

// VIOLATION: bugs/deterministic/await-in-loop
export async function awaitInLoop(urls: string[]) {
  const results: any[] = [];
  for (const url of urls) {
    const response = await fetch(url);
    results.push(await response.json());
  }
  return results;
}

// VIOLATION: bugs/deterministic/race-condition-assignment
let sharedCounter = 0;
export async function raceConditionAssignment() {
  sharedCounter += await new Promise<number>((r) => setTimeout(() => r(1), 100));
  return sharedCounter;
}

// VIOLATION: bugs/deterministic/async-void-function
async function doFetch(): Promise<Response> {
  return fetch('/api');
}
export function asyncVoidFunction() {
  doFetch();
}

// VIOLATION: bugs/deterministic/error-swallowed-in-callback
export function errorSwallowedInCallback() {
  fs.readFile('/tmp/test.txt', (err: Error | null, data: Buffer) => {
    const text = data?.toString();
  });
}

// VIOLATION: bugs/deterministic/unthrown-error
export function unthrownError() {
  new Error('this error is never thrown');
}

// VIOLATION: bugs/deterministic/ignored-return-value
export function ignoredReturnValue(arr: number[]) {
  arr.filter((x) => x > 0);
  return arr;
}

// VIOLATION: bugs/deterministic/void-return-value-used
export function voidReturnValueUsed(arr: number[]) {
  const result = arr.forEach((x) => x * 2);
  return result;
}

// TODO: misleading-array-reverse — visitor not triggering, needs investigation
export function misleadingArrayReverse(arr: number[]) {
  const reversed = arr.reverse();
  return reversed;
}

// VIOLATION: bugs/deterministic/stateful-regex
const globalRegex = /test/g;
export function statefulRegex(input: string) {
  return globalRegex.test(input);
}

// VIOLATION: bugs/deterministic/invariant-return
export function invariantReturn(items: number[]) {
  if (items.length > 0) {
    return true;
  }
  return true;
}

// VIOLATION: bugs/deterministic/generic-error-message
export function genericErrorMessage() {
  throw new Error('Something went wrong');
}

// VIOLATION: bugs/deterministic/prototype-builtins-call
export function prototypeBuiltinsCall(obj: Record<string, any>) {
  return obj.hasOwnProperty('key');
}

// VIOLATION: bugs/deterministic/confusing-increment-decrement
export function confusingIncrementDecrement(a: number, b: number) {
  return a + b++;
}
