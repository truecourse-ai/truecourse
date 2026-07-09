// A real test file (`.test.ts`) that blocks on a fixed wall-clock timeout to
// "wait" for async work to settle. This is fragile and slow; deterministic
// waiting (await, polling, waitFor) should be used instead.

export async function waitForQueueToDrain(): Promise<void> {
  // VIOLATION: code-quality/deterministic/test-with-hardcoded-timeout
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
}
