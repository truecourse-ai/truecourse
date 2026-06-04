// `return await promise` where the awaited expression is a bare identifier
// (a variable already holding a Promise) is the truly redundant shape — the
// async function would return the same Promise without the extra await.

// VIOLATION: code-quality/deterministic/no-return-await
export async function passThroughPromise(promise: Promise<number>) {
  return await promise;
}
