/**
 * Positive fixture for code-quality/deterministic/no-void.
 *
 * `void <identifier>;` (or `void <obj.member>;`) as its own statement is
 * the idiomatic "mark as used" pattern in TypeScript:
 *
 *   - Pins a side-effect-only import so the binding isn't tree-shaken
 *     and the module-load side-effect runs.
 *   - Silences `noUnusedParameters` / unused-variable warnings without
 *     adding `_` prefixes that would change the public API.
 *
 * The value is never consumed, so it isn't a stand-in for `undefined`.
 */

declare const sideEffectModule: { ready: boolean };

export function bootstrapWorker(): void {
  // Pin the side-effect-only module so it isn't tree-shaken.
  void sideEffectModule;
}

interface LifecycleHooks {
  readonly onTeardown: (token: { id: string }) => void;
}

export const hooks: LifecycleHooks = {
  onTeardown(token): void {
    // Acknowledge the parameter — the contract requires it even though
    // this implementation does no teardown work.
    void token;
  },
};
