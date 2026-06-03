// A non-async function that builds and returns `new Promise` only to
// immediately resolve a synchronously-available value is the actual bug —
// the function should just be marked `async` and return the value directly.

// VIOLATION: code-quality/deterministic/async-promise-function
export function wrapSync(value: number): Promise<number> {
  return new Promise((resolve) => {
    resolve(value * 2);
  });
}
