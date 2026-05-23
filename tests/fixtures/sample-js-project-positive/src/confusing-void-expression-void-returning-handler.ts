/**
 * Positive fixture for code-quality/deterministic/confusing-void-expression.
 *
 * `return voidFn()` is the idiomatic shorthand for framework handlers
 * whose own signature already returns `void` / `Promise<void>` — tRPC
 * mutation handlers, Express middleware, etc. Matches
 * `@typescript-eslint/no-confusing-void-expression`'s
 * `ignoreVoidReturningFunctions` option: the outer void return means no
 * "looks like the value matters" confusion is possible.
 *
 * The `return await voidFn()` shape from the upstream samples triggers
 * `no-return-await` (a separate rule) outside a `try`, so the async
 * branch wraps the call in `try` to exercise just this rule.
 */

function recordAuditEvent(): void {
  // no-op
}

async function flushTaskQueue(): Promise<void> {
  await Promise.resolve();
}

// Sync arrow returning `void` — `return voidFn()` is the shorthand.
export const runAuditHandler: () => void = () => {
  return recordAuditEvent();
};

// Async arrow returning `Promise<void>` — `return await voidFn()` inside
// `try` is the production pattern.
export const runFlushHandler: () => Promise<void> = async () => {
  try {
    return await flushTaskQueue();
  } catch {
    return;
  }
};
